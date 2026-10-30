/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiButton,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiCallOut,
  EuiFilterButton,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingContent,
  EuiPopover,
  EuiSelect,
  EuiSelectable,
  EuiSelectableOption,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { EMPTY_RUN_EVENTS, EvalOutcome, EvalResult, RunEvents } from './eval_data';
import {
  CaseComparison,
  ChangeKind,
  RunCaseRow,
  RunSummary,
  aggregateEvaluator,
} from './eval_aggregations';
import {
  CaseFilter,
  CaseSort,
  Comparability,
  GridCase,
  GridRun,
  buildCompareGrid,
  comparabilityOf,
  durationChange,
  evaluatorVs,
  filterCases,
  formatAggregateDelta,
  formatDurationDelta,
  formatPointsDelta,
  passRateChange,
  sortCases,
} from './eval_compare';
import { VerdictBadge } from './eval_chips';
import {
  QueryErrorCallout,
  formatAggregate,
  formatDuration,
  formatEvalTime,
  formatPercent,
  shortId,
} from './eval_components';
import { MAX_COMPARE_RUNS } from './eval_url_state';
import { CaseCompareFlyout, CaseStatusView } from './case_compare_flyout';
import { TraceCompareFlyout } from './trace_compare_flyout';

/**
 * Per-run colors of the compare grid: blues, purples and neutrals that carry no verdict
 * (never green, red, amber or pink), so a run's letter never reads as pass or fail.
 */
export const RUN_COLORS = ['#6092C0', '#9170B8', '#B9A888', '#3F6E9A', '#8D9BAD'];
export const runColor = (index: number) => RUN_COLORS[index % RUN_COLORS.length];

const CHANGE_TEXT: Record<ChangeKind, string> = {
  improved: i18n.translate('agentTraces.evalsPage.changeImproved', { defaultMessage: 'Improved' }),
  regressed: i18n.translate('agentTraces.evalsPage.changeRegressed', {
    defaultMessage: 'Regressed',
  }),
  unchanged: i18n.translate('agentTraces.evalsPage.changeUnchanged', {
    defaultMessage: 'Unchanged',
  }),
  new: i18n.translate('agentTraces.evalsPage.changeNew', { defaultMessage: 'New' }),
  missing: i18n.translate('agentTraces.evalsPage.changeMissing', { defaultMessage: 'Missing' }),
};

/** Text color of a delta: better green, worse red, the same (or no direction) gray. */
const CHANGE_COLOR: Partial<Record<ChangeKind, string>> = {
  improved: 'success',
  regressed: 'danger',
};

/** A signed delta colored by whether the change is better or worse, never by its sign. */
export const ChangeDelta: React.FC<{
  text?: string;
  change?: ChangeKind;
  'data-test-subj'?: string;
}> = ({ text, change, ...rest }) => {
  if (!text) return null;
  const color = (change && CHANGE_COLOR[change]) ?? 'subdued';
  return (
    <EuiText
      size="xs"
      color={color}
      className="agtEvlNum agtEvlDelta"
      data-test-subj={rest['data-test-subj'] ?? 'agtEvlChangeDelta'}
      data-change={change ?? 'none'}
      title={change ? CHANGE_TEXT[change] : undefined}
    >
      {text}
    </EuiText>
  );
};

/** OUI has no anchor icon: a small one for the baseline. */
const AnchorIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden {...props}>
    <path
      d="M8 1.5a1.75 1.75 0 0 0-.5 3.43V6H6v1h1.5v6.45A5 5 0 0 1 3.05 9.5H4.5l-2-2.5-2 2.5h1.53A6 6 0 0 0 14 9.5h1.5l-2-2.5-2 2.5h1.45A5 5 0 0 1 8.5 13.45V7H10V6H8.5V4.93A1.75 1.75 0 0 0 8 1.5Zm0 1a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z"
      fill="currentColor"
    />
  </svg>
);

const BASELINE_TEXT = i18n.translate('agentTraces.evalsPage.baseline', {
  defaultMessage: 'Baseline',
});

export const BaselinePill: React.FC = () => (
  <EuiBadge color="hollow" className="agtEvlBaselinePill" data-test-subj="agtEvlBaselinePill">
    <EuiIcon type={AnchorIcon} size="s" /> {BASELINE_TEXT}
  </EuiBadge>
);

/** The run's letter in its color. */
export const RunLetter: React.FC<{ run: Pick<GridRun, 'letter'>; index: number }> = ({
  run,
  index,
}) => (
  <span
    className="agtEvlRunLetter"
    style={{ color: runColor(index), borderColor: runColor(index) }}
    data-test-subj="agtEvlRunLetter"
  >
    {run.letter}
  </span>
);

/** Agent version and model from the run metadata, when the producer attached them. */
export const agentVersionOf = (s?: Pick<RunSummary, 'metadata'>) =>
  s?.metadata?.['agent.version'] ?? s?.metadata?.version;
export const agentModelOf = (s?: Pick<RunSummary, 'metadata'>) =>
  s?.metadata?.['agent.model'] ?? s?.metadata?.model ?? s?.metadata?.['llm.model'];

/** A model id without its region prefix and date suffix: `claude-haiku-4-5`. */
export const shortModel = (model?: string) =>
  model
    ?.replace(/^(global|us|eu|apac)\./, '')
    .replace(/^[a-z]+\./, '')
    .replace(/-\d{8}(-v\d+(:\d+)?)?$/, '');

/** Time to center a trace link on: the case's time, else the run start. */
const timeOf = (row: RunCaseRow | undefined, run?: RunSummary): number => {
  if (row && Number.isFinite(row.timeMs)) return row.timeMs;
  const t = run?.started;
  return t !== undefined && Number.isFinite(t) ? t : Date.now();
};

const RunIdentity: React.FC<{ run: GridRun; index: number; dense?: boolean }> = ({
  run,
  index,
  dense,
}) => {
  const version = agentVersionOf(run.summary);
  const model = agentModelOf(run.summary);
  const detail = [
    version,
    shortModel(model),
    run.summary && formatEvalTime(run.summary.started, 'MMM D, HH:mm'),
  ].filter(Boolean);
  return (
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap={false}>
      <EuiFlexItem grow={false}>
        <RunLetter run={run} index={index} />
      </EuiFlexItem>
      <EuiFlexItem style={{ minWidth: 0 }}>
        <EuiToolTip content={[run.runId, model].filter(Boolean).join(' · ')}>
          <EuiText size="xs" className="agtEvlMono eui-textTruncate">
            <strong>{shortId(run.runId, dense ? 24 : 32)}</strong>
          </EuiText>
        </EuiToolTip>
        {detail.length > 0 && (
          <EuiText size="xs" color="subdued" className="eui-textTruncate">
            {detail.join(' · ')}
          </EuiText>
        )}
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

/** `↓2 ↑7 of 12` with a red / green / gray bar of regressed, improved and unchanged cases. */
export const ChangesCell: React.FC<{ run: GridRun }> = ({ run }) => {
  if (run.isBaseline || !run.changes) {
    return (
      <EuiText size="xs" color="subdued" data-test-subj="agtEvlChangesReference">
        {i18n.translate('agentTraces.evalsPage.reference', { defaultMessage: 'Reference' })}
      </EuiText>
    );
  }
  const { regressed, improved, unchanged, shared } = run.changes;
  const total = Math.max(1, shared);
  return (
    <EuiToolTip
      content={i18n.translate('agentTraces.evalsPage.changesTip', {
        defaultMessage:
          'Of {shared} test cases in both this run and the baseline: {regressed} regressed, {improved} improved, {unchanged} unchanged',
        values: { shared, regressed, improved, unchanged },
      })}
    >
      <div data-test-subj="agtEvlChanges">
        <EuiText size="xs" className="agtEvlNum">
          <span className="agtEvlChanges__down">↓{regressed}</span>{' '}
          <span className="agtEvlChanges__up">↑{improved}</span>{' '}
          <span className="agtEvlChanges__of">
            {i18n.translate('agentTraces.evalsPage.changesOf', {
              defaultMessage: 'of {shared}',
              values: { shared },
            })}
          </span>
        </EuiText>
        <div className="agtEvlChanges__bar" aria-hidden>
          <span
            className="agtEvlChanges__seg agtEvlChanges__seg--down"
            style={{ width: `${(regressed / total) * 100}%` }}
          />
          <span
            className="agtEvlChanges__seg agtEvlChanges__seg--up"
            style={{ width: `${(improved / total) * 100}%` }}
          />
          <span
            className="agtEvlChanges__seg agtEvlChanges__seg--same"
            style={{ width: `${(unchanged / total) * 100}%` }}
          />
        </div>
      </div>
    </EuiToolTip>
  );
};

/** The verdict of a cell's results for one evaluation: the worst one wins. */
const worstOutcome = (results: EvalResult[]): EvalOutcome => {
  const order: EvalOutcome[] = ['fail', 'error', 'pass', 'neutral'];
  return order.find((o) => results.some((r) => r.outcome === o)) ?? 'neutral';
};

/** One evaluation in a cell: value chip colored by verdict, and the delta vs the baseline. */
const CellValue: React.FC<{
  name: string;
  row: RunCaseRow;
  vs?: CaseComparison;
}> = ({ name, row, vs }) => {
  const grades = row.grades[name];
  if (!grades?.length) return null;
  const agg = row.evaluators[name] ?? aggregateEvaluator(name, grades);
  const chip =
    grades.length === 1
      ? grades[0]
      : {
          outcome: worstOutcome(grades),
          value: agg.mean,
          label: agg.mean === undefined ? agg.topLabel : undefined,
        };
  const v = vs?.evaluators[name];
  return (
    <div className="agtEvlCell__line" data-test-subj="agtEvlCellValue">
      <span className="agtEvlCell__name" title={name}>
        {name}
      </span>
      <VerdictBadge result={chip} data-test-subj="agtEvlCellChip" />
      {v && (
        <ChangeDelta
          text={formatAggregateDelta(v.baseline, v.candidate)}
          change={v.change}
          data-test-subj="agtEvlCellDelta"
        />
      )}
    </div>
  );
};

/** One test case in one run. */
const CaseCell: React.FC<{
  row?: RunCaseRow;
  vs?: CaseComparison;
  baselineRow?: RunCaseRow;
  evaluatorNames: string[];
  run: GridRun;
  onOpenTrace: () => void;
  onOpenCase?: () => void;
  onCompareTraces?: () => void;
}> = ({ row, vs, baselineRow, evaluatorNames, run, onOpenTrace, onOpenCase, onCompareTraces }) => {
  if (!row) {
    return (
      <EuiText size="xs" color="subdued" data-test-subj="agtEvlCellMissing">
        {i18n.translate('agentTraces.evalsPage.cellMissing', {
          defaultMessage: 'Not in this run',
        })}
      </EuiText>
    );
  }
  const durationDelta =
    !run.isBaseline && row.durationMs !== undefined && baselineRow?.durationMs !== undefined
      ? row.durationMs - baselineRow.durationMs
      : undefined;
  return (
    <div className="agtEvlCell" data-test-subj="agtEvlCaseCell">
      {evaluatorNames.map((name) => (
        <CellValue key={name} name={name} row={row} vs={run.isBaseline ? undefined : vs} />
      ))}
      {Object.keys(row.grades).length === 0 && row.status !== 'error' && (
        <CaseStatusView status={row.status} compact />
      )}
      <div className="agtEvlCell__foot">
        <EuiText size="xs" color="subdued" className="agtEvlNum">
          <EuiIcon type="clock" size="s" /> {formatDuration(row.durationMs)}
        </EuiText>
        {durationDelta !== undefined && (
          <ChangeDelta
            text={formatDurationDelta(durationDelta)}
            change={durationChange(baselineRow?.durationMs, row.durationMs)}
            data-test-subj="agtEvlCellDurationDelta"
          />
        )}
        {row.status === 'error' && (
          <CaseStatusView status="error" errorType={row.errorType} compact />
        )}
        <span className="agtEvlCell__actions">
          {row.traceId && (
            <EuiToolTip
              content={i18n.translate('agentTraces.evalsPage.openTraceTip', {
                defaultMessage: 'Open the agent trace',
              })}
            >
              <EuiButtonIcon
                iconType="apmTrace"
                size="xs"
                aria-label={i18n.translate('agentTraces.evalsPage.openTrace', {
                  defaultMessage: 'Open trace',
                })}
                onClick={onOpenTrace}
                data-test-subj="agtEvlCellTrace"
              />
            </EuiToolTip>
          )}
          {onCompareTraces && (
            <EuiToolTip
              content={i18n.translate('agentTraces.evalsPage.compareTracesCellTip', {
                defaultMessage: 'This case in the baseline and in this run, step by step',
              })}
            >
              <EuiButtonIcon
                iconType="merge"
                size="xs"
                aria-label={i18n.translate('agentTraces.evalsPage.compareTracesShort', {
                  defaultMessage: 'Compare',
                })}
                onClick={onCompareTraces}
                data-test-subj="agtEvlCellCompareTraces"
              />
            </EuiToolTip>
          )}
          {onOpenCase && (
            <EuiToolTip
              content={i18n.translate('agentTraces.evalsPage.openCaseTip', {
                defaultMessage: 'Input, expected, outputs and scores against the baseline',
              })}
            >
              <EuiButtonIcon
                iconType="inspect"
                size="xs"
                aria-label={i18n.translate('agentTraces.evalsPage.openCase', {
                  defaultMessage: 'Open test case',
                })}
                onClick={onOpenCase}
                data-test-subj="agtEvlCellOpenCase"
              />
            </EuiToolTip>
          )}
        </span>
      </div>
    </div>
  );
};

/** "2 evaluations regressed · 1 improved" under a case name. */
const CaseChangeLine: React.FC<{ c: GridCase }> = ({ c }) => {
  const parts: React.ReactNode[] = [];
  if (c.regressedEvaluations.length) {
    parts.push(
      <span key="r" className="agtEvlChanges__down" title={c.regressedEvaluations.join(', ')}>
        {i18n.translate('agentTraces.evalsPage.caseRegressed', {
          defaultMessage: '{count, plural, one {# evaluation} other {# evaluations}} regressed',
          values: { count: c.regressedEvaluations.length },
        })}
      </span>
    );
  }
  if (c.improvedEvaluations.length) {
    parts.push(
      <span key="i" className="agtEvlChanges__up" title={c.improvedEvaluations.join(', ')}>
        {i18n.translate('agentTraces.evalsPage.caseImproved', {
          defaultMessage: '{count} improved',
          values: { count: c.improvedEvaluations.length },
        })}
      </span>
    );
  }
  // A status flip (pass to fail or error) with no evaluation moving, e.g. an errored case.
  if (!parts.length && c.kinds.has('regressed')) {
    parts.push(
      <span key="sr" className="agtEvlChanges__down">
        {CHANGE_TEXT.regressed}
      </span>
    );
  }
  if (!parts.length && c.kinds.has('improved')) {
    parts.push(
      <span key="si" className="agtEvlChanges__up">
        {CHANGE_TEXT.improved}
      </span>
    );
  }
  if (c.kinds.has('new')) parts.push(<span key="n">{CHANGE_TEXT.new}</span>);
  if (c.kinds.has('missing')) parts.push(<span key="m">{CHANGE_TEXT.missing}</span>);
  if (!parts.length) return null;
  return (
    <EuiText size="xs" data-test-subj="agtEvlCaseChangeLine">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' · '}
          {p}
        </React.Fragment>
      ))}
    </EuiText>
  );
};

/** "Add run": runs of the same suite from the runs list, not yet compared. */
const AddRunPicker: React.FC<{
  candidates: RunSummary[];
  disabled: boolean;
  onAdd: (runId: string) => void;
}> = ({ candidates, disabled, onAdd }) => {
  const [open, setOpen] = useState(false);
  const options: EuiSelectableOption[] = candidates.map((r) => ({
    label: r.runId,
    key: r.runId,
    append: (
      <EuiText size="xs" color="subdued">
        {[agentVersionOf(r), formatEvalTime(r.started, 'MMM D, HH:mm')].filter(Boolean).join(' · ')}
      </EuiText>
    ),
    'data-test-subj': 'agtEvlAddRunOption',
  }));
  return (
    <EuiPopover
      isOpen={open}
      closePopover={() => setOpen(false)}
      panelPaddingSize="s"
      anchorPosition="downRight"
      button={
        <EuiToolTip
          content={
            disabled
              ? i18n.translate('agentTraces.evalsPage.addRunMax', {
                  defaultMessage: 'Compare up to {max} runs.',
                  values: { max: MAX_COMPARE_RUNS },
                })
              : candidates.length === 0
                ? i18n.translate('agentTraces.evalsPage.addRunNone', {
                    defaultMessage:
                      'No other run of this suite in the runs time range. Widen it on the runs list.',
                  })
                : undefined
          }
        >
          <EuiButton
            size="s"
            iconType="plusInCircle"
            isDisabled={disabled || candidates.length === 0}
            onClick={() => setOpen(!open)}
            data-test-subj="agtEvlAddRun"
          >
            {i18n.translate('agentTraces.evalsPage.addRun', { defaultMessage: 'Add run' })}
          </EuiButton>
        </EuiToolTip>
      }
    >
      <div style={{ width: 420 }}>
        <EuiSelectable
          searchable
          singleSelection
          options={options}
          onChange={(next) => {
            const picked = next.find((o) => o.checked === 'on');
            if (picked?.key) {
              setOpen(false);
              onAdd(picked.key);
            }
          }}
          listProps={{ bordered: true }}
          data-test-subj="agtEvlAddRunList"
        >
          {(list, search) => (
            <>
              {search}
              <EuiSpacer size="xs" />
              {list}
            </>
          )}
        </EuiSelectable>
      </div>
    </EuiPopover>
  );
};

const NOT_RECORDED = i18n.translate('agentTraces.evalsPage.notRecorded', {
  defaultMessage: 'not recorded',
});

/** `v1 → v2` for two runs; `A v1 · B v2 · C v2` for more. */
const changeText = (values: Array<{ letter: string; value?: string }>) =>
  values.length === 2
    ? values.map((v) => v.value ?? NOT_RECORDED).join(' → ')
    : values.map((v) => `${v.letter} ${v.value ?? NOT_RECORDED}`).join(' · ');

const perRunText = (values: Array<{ letter: string; value?: string }>) =>
  values.map((v) => `${v.value ?? NOT_RECORDED} (${v.letter})`).join(' → ');

/**
 * Says when the runs are not comparable as is (different test cases, evaluator versions or
 * judge models, missing pass rules), and, neutrally, what changed in the agent.
 */
export const ComparabilityNotice: React.FC<{ comparability: Comparability }> = ({
  comparability: c,
}) => {
  const items: Array<{ id: string; text: string }> = [];
  if (c.coverage) {
    const parts = [
      i18n.translate('agentTraces.evalsPage.coverageShared', {
        defaultMessage: '{count} shared',
        values: { count: c.coverage.shared },
      }),
      ...c.coverage.onlyIn.map(({ letter, count }) =>
        i18n.translate('agentTraces.evalsPage.coverageOnly', {
          defaultMessage: '{count} only in {letter}',
          values: { count, letter },
        })
      ),
      ...c.coverage.missingFrom.map(({ letter, count }) =>
        i18n.translate('agentTraces.evalsPage.coverageMissing', {
          defaultMessage: '{count} missing from {letter}',
          values: { count, letter },
        })
      ),
    ];
    items.push({
      id: 'coverage',
      text: i18n.translate('agentTraces.evalsPage.coverage', {
        defaultMessage: 'The runs cover different test cases: {parts}. Changes count shared cases.',
        values: { parts: parts.join(' · ') },
      }),
    });
  }
  c.evaluators.forEach((e) => {
    const what =
      e.what === 'version'
        ? i18n.translate('agentTraces.evalsPage.diffVersion', {
            defaultMessage: 'evaluator version',
          })
        : e.what === 'judge'
          ? i18n.translate('agentTraces.evalsPage.diffJudge', { defaultMessage: 'judge model' })
          : i18n.translate('agentTraces.evalsPage.diffEvaluator', {
              defaultMessage: 'scored by',
            });
    items.push({ id: `${e.name}|${e.what}`, text: `${e.name}: ${what} ${perRunText(e.values)}` });
  });
  c.missingRules.forEach((m) =>
    items.push({
      id: `rule|${m.letter}`,
      text: i18n.translate('agentTraces.evalsPage.missingRule', {
        defaultMessage: 'Run {letter} has no pass rules for {names}; its verdicts show as Scored.',
        values: { letter: m.letter, names: m.names.join(', ') },
      }),
    })
  );
  const changes = c.changes.map((ch) => ({
    id: ch.what,
    text:
      ch.what === 'agentVersion'
        ? i18n.translate('agentTraces.evalsPage.changeAgentVersion', {
            defaultMessage: 'Agent version: {change}',
            values: { change: changeText(ch.values) },
          })
        : i18n.translate('agentTraces.evalsPage.changeModel', {
            defaultMessage: 'Model: {change}',
            values: { change: changeText(ch.values) },
          }),
  }));
  if (!items.length && !changes.length) return null;
  return (
    <>
      <EuiCallOut
        size="s"
        color={c.hasWarnings ? 'warning' : 'primary'}
        iconType={c.hasWarnings ? 'alert' : 'iInCircle'}
        data-test-subj="agtEvlComparability"
        title={
          c.hasWarnings
            ? i18n.translate('agentTraces.evalsPage.notComparable', {
                defaultMessage: 'Read the deltas with care: the runs differ in more than the agent',
              })
            : i18n.translate('agentTraces.evalsPage.whatChanged', {
                defaultMessage: 'What changed between the runs',
              })
        }
      >
        <ul className="agtEvlComparability">
          {items.map((i) => (
            <li key={i.id} data-test-subj="agtEvlComparabilityItem">
              {i.text}
            </li>
          ))}
          {changes.map((i) => (
            <li key={i.id} data-test-subj="agtEvlComparabilityChange">
              {i.text}
            </li>
          ))}
        </ul>
      </EuiCallOut>
      <EuiSpacer size="m" />
    </>
  );
};

const SORT_OPTIONS: Array<{ value: CaseSort; text: string }> = [
  {
    value: 'regression',
    text: i18n.translate('agentTraces.evalsPage.sortRegression', {
      defaultMessage: 'Biggest regression',
    }),
  },
  {
    value: 'improvement',
    text: i18n.translate('agentTraces.evalsPage.sortImprovement', {
      defaultMessage: 'Most improved',
    }),
  },
  {
    value: 'name',
    text: i18n.translate('agentTraces.evalsPage.sortName', { defaultMessage: 'Test case name' }),
  },
];

export interface CompareRunsProps {
  /** Compared runs in column order, 2 to `MAX_COMPARE_RUNS`. */
  runIds: string[];
  baselineId: string;
  /** Grades and events of the compared runs (whatever their time). */
  results: EvalResult[];
  events?: RunEvents;
  loading?: boolean;
  error?: string;
  /** Compared runs without any event. */
  missing?: string[];
  /** Runs in the runs time range: "Add run" offers those of the same suite. */
  available: RunSummary[];
  onChange: (runIds: string[], baselineId: string) => void;
  onBack: () => void;
  /** Back link text; the runs list by default. */
  backLabel?: string;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}

export const CompareRuns: React.FC<CompareRunsProps> = ({
  runIds,
  baselineId,
  results,
  events = EMPTY_RUN_EVENTS,
  loading,
  error,
  missing = [],
  available,
  onChange,
  onBack,
  backLabel,
  onOpenTrace,
}) => {
  const grid = useMemo(
    () => buildCompareGrid(results, events, runIds, baselineId),
    [results, events, runIds, baselineId]
  );
  const comparability = useMemo(
    () =>
      comparabilityOf(grid, results, (summary) => ({
        agentVersion: agentVersionOf(summary),
        model: agentModelOf(summary),
      })),
    [grid, results]
  );
  const [filter, setFilter] = useState<CaseFilter>('all');
  const [sort, setSort] = useState<CaseSort>('regression');
  const [open, setOpen] = useState<{ caseId: string; runId: string; traces: boolean }>();
  const baseline = grid.runs.find((r) => r.isBaseline);
  const suiteName = grid.runs.map((r) => r.summary?.suiteName).find((s) => !!s);
  const indexOf = (runId: string) => runIds.indexOf(runId);
  const cases = useMemo(
    () => sortCases(filterCases(grid.cases, filter), sort),
    [grid, filter, sort]
  );
  const candidates = useMemo(
    () =>
      available
        .filter((r) => !runIds.includes(r.runId) && (r.suiteName ?? '') === (suiteName ?? ''))
        .sort((a, b) => b.started - a.started),
    [available, runIds, suiteName]
  );

  const setBaseline = (runId: string) => onChange(runIds, runId);
  const remove = (runId: string) => {
    const next = runIds.filter((id) => id !== runId);
    onChange(next, runId === baselineId ? next[0] : baselineId);
  };

  const runColumns: Array<EuiBasicTableColumn<GridRun>> = [
    {
      name: i18n.translate('agentTraces.evalsPage.colRun', { defaultMessage: 'Run' }),
      width: '24%',
      render: (run: GridRun) => <RunIdentity run={run} index={indexOf(run.runId)} />,
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colPassRate', { defaultMessage: 'Pass rate' }),
      render: (run: GridRun) =>
        run.summary ? (
          <div data-test-subj="agtEvlRunPassRate">
            <EuiFlexGroup gutterSize="xs" alignItems="baseline" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiText size="s" className="agtEvlNum">
                  <strong>{formatPercent(run.passRate)}</strong>
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <ChangeDelta
                  text={
                    run.passRateDelta !== undefined
                      ? formatPointsDelta(run.passRateDelta)
                      : undefined
                  }
                  change={passRateChange(run.passRateDelta)}
                  data-test-subj="agtEvlRunPassRateDelta"
                />
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiText size="xs" color="subdued" className="agtEvlNum">
              {i18n.translate('agentTraces.evalsPage.passedOf', {
                defaultMessage: '{passed} of {cases} passed',
                values: { passed: run.summary.casesPassed, cases: run.summary.cases },
              })}
            </EuiText>
          </div>
        ) : (
          <EuiText size="xs" color="subdued">
            -
          </EuiText>
        ),
    },
    ...grid.evaluatorNames.map((name): EuiBasicTableColumn<GridRun> => ({
      name: (
        <EuiToolTip
          content={i18n.translate('agentTraces.evalsPage.colEvaluatorMeanTip', {
            defaultMessage: '{name}: mean score, or pass rate for labels',
            values: { name },
          })}
        >
          <span className="eui-textTruncate">{name}</span>
        </EuiToolTip>
      ),
      render: (run: GridRun) => {
        const agg = run.summary?.evaluators[name];
        const v = evaluatorVs(run, name);
        return (
          <div data-test-subj="agtEvlRunMean">
            <EuiText size="s" className="agtEvlNum">
              {formatAggregate(agg)}
            </EuiText>
            {v && (
              <ChangeDelta
                text={formatAggregateDelta(v.baseline, v.candidate)}
                change={v.change}
                data-test-subj="agtEvlRunMeanDelta"
              />
            )}
          </div>
        );
      },
    })),
    {
      name: i18n.translate('agentTraces.evalsPage.colDuration', { defaultMessage: 'Duration' }),
      render: (run: GridRun) => {
        const d = run.summary?.durationMs;
        const b = baseline?.summary?.durationMs;
        return (
          <div>
            <EuiText size="s" className="agtEvlNum">
              {formatDuration(d)}
            </EuiText>
            {!run.isBaseline && d !== undefined && b !== undefined && (
              <ChangeDelta
                text={formatDurationDelta(d - b)}
                change={durationChange(b, d)}
                data-test-subj="agtEvlRunDurationDelta"
              />
            )}
          </div>
        );
      },
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colChanges', { defaultMessage: 'Changes' }),
      width: '130px',
      render: (run: GridRun) => <ChangesCell run={run} />,
    },
    {
      name: '',
      width: '150px',
      align: 'right',
      render: (run: GridRun) => (
        <EuiFlexGroup
          gutterSize="xs"
          alignItems="center"
          justifyContent="flexEnd"
          responsive={false}
        >
          <EuiFlexItem grow={false}>
            {run.isBaseline ? (
              <BaselinePill />
            ) : (
              <EuiButtonEmpty
                size="xs"
                onClick={() => setBaseline(run.runId)}
                data-test-subj="agtEvlSetBaseline"
              >
                {i18n.translate('agentTraces.evalsPage.setBaseline', {
                  defaultMessage: 'Set baseline',
                })}
              </EuiButtonEmpty>
            )}
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiToolTip
              content={
                runIds.length <= 2
                  ? i18n.translate('agentTraces.evalsPage.removeRunMin', {
                      defaultMessage: 'A comparison needs two runs.',
                    })
                  : i18n.translate('agentTraces.evalsPage.removeRun', {
                      defaultMessage: 'Remove from the comparison',
                    })
              }
            >
              <EuiButtonIcon
                iconType="cross"
                size="xs"
                color="text"
                isDisabled={runIds.length <= 2}
                aria-label={i18n.translate('agentTraces.evalsPage.removeRunAria', {
                  defaultMessage: 'Remove run {letter}',
                  values: { letter: run.letter },
                })}
                onClick={() => remove(run.runId)}
                data-test-subj="agtEvlRemoveRun"
              />
            </EuiToolTip>
          </EuiFlexItem>
        </EuiFlexGroup>
      ),
    },
  ];

  const openTraceOf = (row: RunCaseRow | undefined, run: GridRun) => () =>
    row?.traceId && onOpenTrace(row.traceId, timeOf(row, run.summary));

  const caseColumns: Array<EuiBasicTableColumn<GridCase>> = [
    {
      name: i18n.translate('agentTraces.evalsPage.colCase', { defaultMessage: 'Test case' }),
      width: '200px',
      render: (c: GridCase) => {
        const firstOther = grid.runs.find((r) => !r.isBaseline && c.vs[r.runId]);
        return (
          <div>
            <EuiText size="xs">
              {firstOther ? (
                <EuiLink
                  onClick={() =>
                    setOpen({ caseId: c.caseId, runId: firstOther.runId, traces: false })
                  }
                  data-test-subj="agtEvlCompareCaseOpen"
                >
                  <strong>{c.caseName ?? c.caseId}</strong>
                </EuiLink>
              ) : (
                <strong>{c.caseName ?? c.caseId}</strong>
              )}
            </EuiText>
            {c.caseName && (
              <EuiText size="xs" color="subdued" className="agtEvlMono">
                {shortId(c.caseId, 24)}
              </EuiText>
            )}
            <CaseChangeLine c={c} />
          </div>
        );
      },
    },
    ...grid.runs.map((run, i): EuiBasicTableColumn<GridCase> => ({
      name: (
        <div className="agtEvlGridHead">
          <RunIdentity run={run} index={i} dense />
          {run.isBaseline && <BaselinePill />}
        </div>
      ),
      render: (c: GridCase) => {
        const row = c.cells[run.runId];
        const baselineRow = c.cells[grid.baselineId];
        const vs = c.vs[run.runId];
        const pair = !run.isBaseline && !!vs && !!row && !!baselineRow;
        return (
          <CaseCell
            row={row}
            vs={vs}
            baselineRow={baselineRow}
            evaluatorNames={grid.evaluatorNames}
            run={run}
            onOpenTrace={openTraceOf(row, run)}
            onOpenCase={
              pair
                ? () => setOpen({ caseId: c.caseId, runId: run.runId, traces: false })
                : undefined
            }
            onCompareTraces={
              pair && row?.traceId && baselineRow?.traceId
                ? () => setOpen({ caseId: c.caseId, runId: run.runId, traces: true })
                : undefined
            }
          />
        );
      },
    })),
  ];

  const filters: Array<{ id: CaseFilter; label: string }> = [
    {
      id: 'all',
      label: i18n.translate('agentTraces.evalsPage.filterAll', { defaultMessage: 'All' }),
    },
    { id: 'improved', label: CHANGE_TEXT.improved },
    { id: 'regressed', label: CHANGE_TEXT.regressed },
    { id: 'new', label: CHANGE_TEXT.new },
    { id: 'missing', label: CHANGE_TEXT.missing },
  ];

  const openRun = open ? grid.runs.find((r) => r.runId === open.runId) : undefined;
  const openCase = open ? grid.cases.find((c) => c.caseId === open.caseId) : undefined;
  const openVs = open && openCase ? openCase.vs[open.runId] : undefined;
  const openBaselineRow = openCase?.cells[grid.baselineId];
  const openRow = open && openCase ? openCase.cells[open.runId] : undefined;

  return (
    <div data-test-subj="agtEvlCompare">
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            iconType="arrowLeft"
            size="s"
            flush="left"
            onClick={onBack}
            data-test-subj="agtEvlCompareBack"
          >
            {backLabel ??
              i18n.translate('agentTraces.evalsPage.backToRuns', {
                defaultMessage: 'Test suites',
              })}
          </EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiTitle size="s">
            <h2>
              <FormattedMessage
                id="agentTraces.evalsPage.compareTitle"
                defaultMessage="Compare runs{suite}"
                values={{ suite: suiteName ? `: ${suiteName}` : '' }}
              />
            </h2>
          </EuiTitle>
          <EuiText size="xs" color="subdued">
            <FormattedMessage
              id="agentTraces.evalsPage.compareSubtitle"
              defaultMessage="{count} runs side by side. Changes are measured against the baseline."
              values={{ count: runIds.length }}
            />
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {error && (
        <>
          <QueryErrorCallout message={error} />
          <EuiSpacer size="s" />
        </>
      )}
      {missing.length > 0 && (
        <>
          <EuiCallOut
            size="s"
            color="warning"
            iconType="alert"
            data-test-subj="agtEvlCompareMissing"
            title={i18n.translate('agentTraces.evalsPage.compareMissingRuns', {
              defaultMessage:
                'No results for {runs}. Remove it from the comparison or check the id.',
              values: { runs: missing.join(', ') },
            })}
          />
          <EuiSpacer size="s" />
        </>
      )}
      {loading && results.length === 0 ? (
        <EuiLoadingContent lines={8} />
      ) : (
        <>
          <EuiFlexGroup alignItems="center" responsive={false} gutterSize="s">
            <EuiFlexItem>
              <EuiTitle size="xs">
                <h3>
                  <FormattedMessage
                    id="agentTraces.evalsPage.runsOfMax"
                    defaultMessage="Runs {count} of {max}"
                    values={{
                      count: runIds.length,
                      max: MAX_COMPARE_RUNS,
                    }}
                  />
                </h3>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <AddRunPicker
                candidates={candidates}
                disabled={runIds.length >= MAX_COMPARE_RUNS}
                onAdd={(runId) => onChange([...runIds, runId], baselineId)}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiBasicTable<GridRun>
            compressed
            className="agtEvlDenseTable agtEvlRunsSummary"
            items={grid.runs}
            itemId="runId"
            columns={runColumns}
            rowProps={(run) => ({
              className: run.isBaseline ? 'agtEvlRunsSummary__baseline' : undefined,
              'data-test-subj': `agtEvlRunSummary-${run.letter}`,
            })}
            data-test-subj="agtEvlRunsSummary"
          />
          <EuiSpacer size="m" />
          <ComparabilityNotice comparability={comparability} />
          <EuiFlexGroup alignItems="center" responsive={false} gutterSize="s" wrap>
            <EuiFlexItem grow={false}>
              <EuiTitle size="xs">
                <h3 data-test-subj="agtEvlCasesTitle">
                  <FormattedMessage
                    id="agentTraces.evalsPage.casesShared"
                    defaultMessage="Test cases · {shared, plural, one {# test case} other {# test cases}} shared by all runs"
                    values={{ shared: grid.shared }}
                  />
                </h3>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem />
            <EuiFlexItem grow={false}>
              <EuiFilterGroup>
                {filters.map((f) => (
                  <EuiFilterButton
                    key={f.id}
                    hasActiveFilters={filter === f.id}
                    numFilters={grid.counts[f.id]}
                    onClick={() => setFilter(f.id)}
                    data-test-subj={`agtEvlCaseFilter-${f.id}`}
                  >
                    {f.label}
                  </EuiFilterButton>
                ))}
              </EuiFilterGroup>
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ width: 200 }}>
              <EuiSelect
                compressed
                prepend={<EuiIcon type="sortable" />}
                options={SORT_OPTIONS}
                value={sort}
                onChange={(e) => setSort(e.target.value as CaseSort)}
                aria-label={i18n.translate('agentTraces.evalsPage.sortCases', {
                  defaultMessage: 'Sort test cases',
                })}
                data-test-subj="agtEvlCaseSort"
              />
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiInMemoryTable<GridCase>
            compressed
            className="agtEvlDenseTable agtEvlCaseGrid"
            items={cases}
            itemId="caseId"
            columns={caseColumns}
            pagination={{ initialPageSize: 25, pageSizeOptions: [25, 50, 100] }}
            message={i18n.translate('agentTraces.evalsPage.noCases', {
              defaultMessage: 'No test cases in this group.',
            })}
            data-test-subj="agtEvlCompareCases"
          />
        </>
      )}
      {open && openVs && openRun && open.traces && openBaselineRow?.traceId && openRow?.traceId && (
        <TraceCompareFlyout
          caseName={openCase?.caseName ?? open.caseId}
          baseline={{
            label: grid.baselineId,
            traceId: openBaselineRow.traceId,
            aroundMs: timeOf(openBaselineRow, baseline?.summary),
          }}
          candidate={{
            label: openRun.runId,
            traceId: openRow.traceId,
            aroundMs: timeOf(openRow, openRun.summary),
          }}
          onBack={() => setOpen({ ...open, traces: false })}
          onClose={() => setOpen(undefined)}
          onOpenTrace={onOpenTrace}
        />
      )}
      {open && openVs && openRun && !open.traces && (
        <CaseCompareFlyout
          comparison={openVs}
          baselineStartedMs={baseline?.summary?.started ?? Date.now()}
          candidateStartedMs={openRun.summary?.started ?? Date.now()}
          onClose={() => setOpen(undefined)}
          onOpenTrace={onOpenTrace}
          onCompareTraces={() => setOpen({ ...open, traces: true })}
        />
      )}
    </div>
  );
};
