/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiButton,
  EuiButtonEmpty,
  EuiCopy,
  EuiEmptyPrompt,
  EuiFlexGrid,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiPopover,
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiSpacer,
  EuiText,
  EuiTextColor,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { EvalResult, RunEvents } from './eval_data';
import {
  EvaluatorAggregate,
  RunCaseRow,
  RunSummary,
  isRegression,
  runCases,
  suiteTrend,
  summarizeRuns,
} from './eval_aggregations';
import { CaseScoresChart, SuiteTrendChart } from './eval_charts';
import {
  CASE_STATUS_COLOR,
  OutcomeBadge,
  QueryErrorCallout,
  formatAggregate,
  formatCount,
  formatDuration,
  formatEvalTime,
  formatPercent,
  formatValue,
  shortId,
} from './eval_components';
import { CaseStatusView, STATUS_TEXT } from './case_compare_flyout';
import { unwrapJsonString } from './eval_target';
import { TraceCompareFlyout } from './trace_compare_flyout';
import { EvaluatorDrilldownFlyout } from './evaluator_drilldown';

const PREVIEW = 90;

const previewText = (value?: string): string | undefined => {
  if (value === undefined) return undefined;
  const unwrapped = unwrapJsonString(value);
  const text = (typeof unwrapped === 'string' ? unwrapped : JSON.stringify(unwrapped))
    .replace(/\s+/g, ' ')
    .trim();
  return text;
};

const Clamp: React.FC<{ label: string; value?: string; testSubj: string }> = ({
  label,
  value,
  testSubj,
}) => {
  const text = previewText(value);
  if (!text) return null;
  return (
    <EuiText size="xs" className="agtEvlClamp" data-test-subj={testSubj}>
      <span className="agtEvlClamp__label">{label}</span>{' '}
      <span title={text}>{text.length > PREVIEW ? `${text.slice(0, PREVIEW - 3)}...` : text}</span>
    </EuiText>
  );
};

/** Pass, fail and errored test cases as one bar with counts, colored like the badges. */
export const CaseSplit: React.FC<{ run: RunSummary }> = ({ run }) => {
  const other = Math.max(0, run.cases - run.casesPassed - run.casesFailed - run.casesErrored);
  const parts = [
    { id: 'pass', count: run.casesPassed, color: CASE_STATUS_COLOR.pass, text: STATUS_TEXT.pass },
    { id: 'fail', count: run.casesFailed, color: CASE_STATUS_COLOR.fail, text: STATUS_TEXT.fail },
    {
      id: 'error',
      count: run.casesErrored,
      color: CASE_STATUS_COLOR.error,
      text: STATUS_TEXT.error,
    },
    { id: 'unknown', count: other, color: CASE_STATUS_COLOR.unknown, text: STATUS_TEXT.unknown },
  ].filter((p) => p.count > 0);
  const total = Math.max(1, run.cases);
  return (
    <div data-test-subj="agtEvlCaseSplit">
      <div className="agtEvlSplit" aria-hidden>
        {parts.map((p) => (
          <span
            key={p.id}
            className="agtEvlSplit__seg"
            style={{ width: `${(p.count / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <EuiFlexGroup gutterSize="m" responsive={false} wrap>
        {parts.map((p) => (
          <EuiFlexItem grow={false} key={p.id}>
            <EuiText size="xs" data-test-subj={`agtEvlCaseSplit-${p.id}`}>
              <span className="agtEvlLabels__dot" style={{ background: p.color }} />
              {p.text} <strong>{p.count}</strong>
            </EuiText>
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    </div>
  );
};

/** Score card of one evaluation in a run: mean (with direction), pass rate and worst score. */
export const RunScoreCard: React.FC<{
  agg: EvaluatorAggregate;
  previous?: EvaluatorAggregate;
  onSelect: (name: string) => void;
}> = ({ agg, previous, onSelect }) => {
  const minimize = agg.direction === 'minimize';
  const worst = minimize ? agg.max : agg.min;
  const delta =
    agg.normalizedMean !== undefined && previous?.normalizedMean !== undefined
      ? agg.normalizedMean - previous.normalizedMean
      : undefined;
  return (
    <EuiPanel
      hasBorder
      paddingSize="s"
      className="agtEvlStatCard agtEvlCard"
      onClick={() => onSelect(agg.name)}
      data-test-subj="agtEvlRunScoreCard"
      aria-label={i18n.translate('agentTraces.evalsPage.runCardAria', {
        defaultMessage: 'Where {name} fails in this run',
        values: { name: agg.name },
      })}
    >
      <EuiText size="xs" className="eui-textTruncate">
        <strong title={agg.name}>{agg.name}</strong>
      </EuiText>
      <EuiFlexGroup gutterSize="m" responsive={false} alignItems="flexEnd">
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            <EuiToolTip
              content={
                minimize
                  ? i18n.translate('agentTraces.evalsPage.lowerBetter', {
                      defaultMessage: 'lower is better',
                    })
                  : i18n.translate('agentTraces.evalsPage.higherBetter', {
                      defaultMessage: 'higher is better',
                    })
              }
            >
              <span>
                {agg.mean !== undefined
                  ? i18n.translate('agentTraces.evalsPage.cardMean', { defaultMessage: 'Mean' })
                  : i18n.translate('agentTraces.evalsPage.topLabel', {
                      defaultMessage: 'Label',
                    })}{' '}
                <EuiIcon type={minimize ? 'sortDown' : 'sortUp'} size="s" />
              </span>
            </EuiToolTip>
          </EuiText>
          <EuiTitle size="s">
            <p data-test-subj="agtEvlRunScoreMean">
              {agg.mean !== undefined ? formatValue(agg.mean) : (agg.topLabel ?? '-')}
            </p>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.cardPassRate', { defaultMessage: 'Pass rate' })}
          </EuiText>
          <EuiText size="s">
            <strong data-test-subj="agtEvlRunScorePassRate">{formatPercent(agg.passRate)}</strong>
          </EuiText>
        </EuiFlexItem>
        {worst !== undefined && (
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {minimize
                ? i18n.translate('agentTraces.evalsPage.max', { defaultMessage: 'Max' })
                : i18n.translate('agentTraces.evalsPage.min', { defaultMessage: 'Min' })}
            </EuiText>
            <EuiText size="s">
              <strong data-test-subj="agtEvlRunScoreWorst">{formatValue(worst)}</strong>
            </EuiText>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
      <EuiText
        size="xs"
        color={
          delta === undefined || Math.abs(delta) < 0.005
            ? 'subdued'
            : delta > 0
              ? 'success'
              : 'danger'
        }
      >
        {delta === undefined
          ? i18n.translate('agentTraces.evalsPage.runCardResults', {
              defaultMessage: '{count, plural, one {# result} other {# results}}',
              values: { count: agg.count },
            })
          : i18n.translate('agentTraces.evalsPage.runCardDelta', {
              defaultMessage: '{delta} vs previous run',
              values: {
                delta: `${delta >= 0 ? '+' : '-'}${Math.abs(delta * 100).toFixed(0)} pts`,
              },
            })}
      </EuiText>
    </EuiPanel>
  );
};

/** One evaluation's grade(s) on a test case: the badge when there is one, else the mean. */
const GradeCell: React.FC<{ grades?: EvalResult[]; agg?: EvaluatorAggregate }> = ({
  grades,
  agg,
}) => {
  if (!grades || grades.length === 0) {
    return (
      <EuiText size="xs" color="subdued">
        -
      </EuiText>
    );
  }
  if (grades.length === 1) {
    const [r] = grades;
    return r.explanation ? (
      <EuiToolTip content={r.explanation}>
        <OutcomeBadge result={r} />
      </EuiToolTip>
    ) : (
      <OutcomeBadge result={r} />
    );
  }
  return <EuiText size="xs">{formatAggregate(agg)}</EuiText>;
};

const SectionTitle: React.FC<{ title: string; help?: string }> = ({ title, help }) => (
  <>
    <EuiTitle size="xxs">
      <h3>{title}</h3>
    </EuiTitle>
    {help && (
      <EuiText size="xs" color="subdued">
        {help}
      </EuiText>
    )}
    <EuiSpacer size="s" />
  </>
);

const CompareWithPicker: React.FC<{
  run: RunSummary;
  others: RunSummary[];
  onPick: (runId: string) => void;
}> = ({ run, others, onPick }) => {
  const [open, setOpen] = useState(false);
  return (
    <EuiPopover
      isOpen={open}
      closePopover={() => setOpen(false)}
      panelPaddingSize="none"
      anchorPosition="downRight"
      button={
        <EuiButton
          size="s"
          iconType="arrowDown"
          iconSide="right"
          isDisabled={others.length === 0}
          onClick={() => setOpen((o) => !o)}
          data-test-subj="agtEvlCompareWith"
        >
          {i18n.translate('agentTraces.evalsPage.compareWith', {
            defaultMessage: 'Compare with...',
          })}
        </EuiButton>
      }
    >
      <EuiContextMenuPanel
        title={i18n.translate('agentTraces.evalsPage.compareWithTitle', {
          defaultMessage: 'Runs of {suite}',
          values: { suite: run.suiteName ?? '-' },
        })}
        className="agtEvlCompareWith"
        data-test-subj="agtEvlCompareWithList"
        items={others.map((r) => (
          <EuiContextMenuItem
            key={r.runId}
            onClick={() => {
              setOpen(false);
              onPick(r.runId);
            }}
            data-test-subj="agtEvlCompareWithItem"
          >
            <span className="agtEvlMono">{shortId(r.runId, 32)}</span>
            <EuiText size="xs" color="subdued">
              {formatEvalTime(r.started, 'MMM D, HH:mm')} ·{' '}
              {i18n.translate('agentTraces.evalsPage.compareWithPassed', {
                defaultMessage: '{passed} of {cases} passed',
                values: { passed: r.casesPassed, cases: r.cases },
              })}
            </EuiText>
          </EuiContextMenuItem>
        ))}
      />
    </EuiPopover>
  );
};

interface TraceComparePair {
  caseName: string;
  baseline: { runId: string; traceId: string; aroundMs: number };
  candidate: { runId: string; traceId: string; aroundMs: number };
}

/**
 * The page of one evaluation run: what ran, how it scored per evaluation, its test cases and
 * how it compares with the suite's other runs.
 */
export const RunDetailPage: React.FC<{
  runId: string;
  /** Grades and events of this run and of the suite's other runs in the time range. */
  results: EvalResult[];
  events: RunEvents;
  loading: boolean;
  error?: string;
  onBack: () => void;
  onOpenRun: (runId: string) => void;
  onCompare: (compare: [string, string]) => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}> = ({ runId, results, events, loading, error, onBack, onOpenRun, onCompare, onOpenTrace }) => {
  const runs = useMemo(() => summarizeRuns(results, events), [results, events]);
  const run = runs.find((r) => r.runId === runId);
  const suiteRuns = useMemo(
    () =>
      run
        ? runs
            .filter((r) => r.runId !== run.runId && (r.suiteName ?? '') === (run.suiteName ?? ''))
            .sort((a, b) => b.started - a.started)
        : [],
    [runs, run]
  );
  const previous = run?.previousRunId ? runs.find((r) => r.runId === run.previousRunId) : undefined;
  const cases = useMemo(() => runCases(results, events, runId), [results, events, runId]);
  const previousCases = useMemo(
    () =>
      previous
        ? new Map(runCases(results, events, previous.runId).map((c) => [c.caseId, c]))
        : new Map<string, RunCaseRow>(),
    [results, events, previous]
  );
  const trend = useMemo(() => (run ? suiteTrend(runs, run.suiteName) : []), [runs, run]);
  const evaluatorNames = useMemo(() => (run ? Object.keys(run.evaluators).sort() : []), [run]);
  const [drilldown, setDrilldown] = useState<string | undefined>();
  const [tracePair, setTracePair] = useState<TraceComparePair | undefined>();

  const compareWith = (otherId: string) => {
    if (!run) return;
    const other = runs.find((r) => r.runId === otherId);
    const otherFirst = other ? other.started <= run.started : true;
    onCompare(otherFirst ? [otherId, run.runId] : [run.runId, otherId]);
  };

  const back = (
    <EuiButtonEmpty
      iconType="arrowLeft"
      size="s"
      flush="left"
      onClick={onBack}
      data-test-subj="agtEvlRunBack"
    >
      {i18n.translate('agentTraces.evalsPage.backToRuns', { defaultMessage: 'Evaluation runs' })}
    </EuiButtonEmpty>
  );

  if (error) {
    return (
      <>
        {back}
        <QueryErrorCallout message={error} />
      </>
    );
  }
  if (!run) {
    if (loading) {
      return (
        <>
          {back}
          <EuiLoadingContent lines={8} />
        </>
      );
    }
    return (
      <>
        {back}
        <EuiEmptyPrompt
          iconType="beaker"
          data-test-subj="agtEvlRunNotFound"
          title={
            <h3>
              <FormattedMessage
                id="agentTraces.evalsPage.runNotFound"
                defaultMessage="Run not found"
              />
            </h3>
          }
          body={
            <EuiText size="s">
              <FormattedMessage
                id="agentTraces.evalsPage.runNotFoundBody"
                defaultMessage="No evaluation events carry the run id {runId}."
                values={{ runId: <code>{runId}</code> }}
              />
            </EuiText>
          }
        />
      </>
    );
  }

  const caseColumns: Array<EuiBasicTableColumn<RunCaseRow>> = [
    {
      field: 'caseName',
      name: i18n.translate('agentTraces.evalsPage.colCase', { defaultMessage: 'Test case' }),
      sortable: (c: RunCaseRow) => c.caseName ?? c.caseId,
      render: (_n: string | undefined, c: RunCaseRow) => (
        <div>
          <EuiText size="xs">
            <strong>{c.caseName ?? c.caseId}</strong>
          </EuiText>
          {c.caseName && (
            <EuiText size="xs" color="subdued" className="agtEvlMono">
              {shortId(c.caseId, 24)}
            </EuiText>
          )}
        </div>
      ),
    },
    {
      field: 'status',
      name: i18n.translate('agentTraces.evalsPage.colCaseStatus', { defaultMessage: 'Status' }),
      width: '120px',
      sortable: true,
      render: (_s: string, c: RunCaseRow) => (
        <CaseStatusView status={c.status} errorType={c.errorType} />
      ),
    },
    ...evaluatorNames.map((name): EuiBasicTableColumn<RunCaseRow> => ({
      name: (
        <EuiLink onClick={() => setDrilldown(name)} data-test-subj="agtEvlRunColumnDrilldown">
          {name}
        </EuiLink>
      ),
      render: (c: RunCaseRow) => <GradeCell grades={c.grades[name]} agg={c.evaluators[name]} />,
    })),
    {
      field: 'durationMs',
      name: i18n.translate('agentTraces.evalsPage.colDuration', { defaultMessage: 'Duration' }),
      width: '90px',
      sortable: true,
      render: (ms?: number) => formatDuration(ms),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colContent', {
        defaultMessage: 'Input, expected, output',
      }),
      width: '28%',
      render: (c: RunCaseRow) =>
        c.event?.input || c.event?.expected || c.event?.output ? (
          <div className="agtEvlClampGroup">
            <Clamp
              label={i18n.translate('agentTraces.evalsPage.inShort', { defaultMessage: 'In' })}
              value={c.event?.input}
              testSubj="agtEvlRunCaseInput"
            />
            <Clamp
              label={i18n.translate('agentTraces.evalsPage.expectedShort', {
                defaultMessage: 'Expected',
              })}
              value={c.event?.expected}
              testSubj="agtEvlRunCaseExpected"
            />
            <Clamp
              label={i18n.translate('agentTraces.evalsPage.outShort', { defaultMessage: 'Out' })}
              value={c.event?.output}
              testSubj="agtEvlRunCaseOutput"
            />
          </div>
        ) : (
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.caseNotRecorded', {
              defaultMessage: 'Not recorded',
            })}
          </EuiText>
        ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colTrace', { defaultMessage: 'Agent trace' }),
      width: '170px',
      render: (c: RunCaseRow) => {
        const before = previousCases.get(c.caseId);
        return (
          <div>
            {c.traceId && (
              <EuiLink
                onClick={() =>
                  onOpenTrace(
                    c.traceId as string,
                    Number.isFinite(c.timeMs) ? c.timeMs : run.started
                  )
                }
                data-test-subj="agtEvlRunCaseTrace"
              >
                <EuiText size="xs">
                  {i18n.translate('agentTraces.evalsPage.runCaseOpenTrace', {
                    defaultMessage: 'Open trace',
                  })}
                </EuiText>
              </EuiLink>
            )}
            {c.traceId && before?.traceId && previous && (
              <EuiToolTip
                content={i18n.translate('agentTraces.evalsPage.diffPreviousTip', {
                  defaultMessage: 'This case in {previous} and in this run, side by side',
                  values: { previous: shortId(previous.runId, 24) },
                })}
              >
                <EuiLink
                  onClick={() =>
                    setTracePair({
                      caseName: c.caseName ?? c.caseId,
                      baseline: {
                        runId: previous.runId,
                        traceId: before.traceId as string,
                        aroundMs: Number.isFinite(before.timeMs) ? before.timeMs : previous.started,
                      },
                      candidate: {
                        runId: run.runId,
                        traceId: c.traceId as string,
                        aroundMs: Number.isFinite(c.timeMs) ? c.timeMs : run.started,
                      },
                    })
                  }
                  data-test-subj="agtEvlRunCaseDiffPrevious"
                >
                  <EuiText size="xs">
                    {i18n.translate('agentTraces.evalsPage.diffPrevious', {
                      defaultMessage: 'Compare with previous',
                    })}
                  </EuiText>
                </EuiLink>
              </EuiToolTip>
            )}
          </div>
        );
      },
    },
  ];

  const status = run.status;
  const metadata = Object.entries(run.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const facts: Array<[string, React.ReactNode]> = [
    [
      i18n.translate('agentTraces.evalsPage.factStarted', { defaultMessage: 'Started' }),
      formatEvalTime(run.started, 'MMM D, YYYY HH:mm:ss'),
    ],
    [
      i18n.translate('agentTraces.evalsPage.factDuration', { defaultMessage: 'Duration' }),
      formatDuration(run.durationMs),
    ],
    [
      i18n.translate('agentTraces.evalsPage.factAgent', { defaultMessage: 'Agent' }),
      [run.agentName, run.serviceName].filter(Boolean).join(' · ') || '-',
    ],
    [
      i18n.translate('agentTraces.evalsPage.factCases', { defaultMessage: 'Test cases' }),
      formatCount(run.cases),
    ],
  ];

  return (
    <div data-test-subj="agtEvlRunDetail">
      {back}
      <EuiSpacer size="xs" />
      <EuiPanel hasBorder paddingSize="m" data-test-subj="agtEvlRunHeader">
        <EuiFlexGroup alignItems="flexStart" justifyContent="spaceBetween" wrap>
          <EuiFlexItem style={{ minWidth: 0 }}>
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
              <EuiFlexItem grow={false}>
                <EuiTitle size="s">
                  <h2>
                    {run.suiteName ??
                      i18n.translate('agentTraces.evalsPage.noSuite', {
                        defaultMessage: 'Evaluation run',
                      })}
                  </h2>
                </EuiTitle>
              </EuiFlexItem>
              {status && (
                <EuiFlexItem grow={false}>
                  <EuiBadge
                    color={status === 'success' ? 'secondary' : 'danger'}
                    data-test-subj="agtEvlRunStatus"
                  >
                    {status === 'success'
                      ? i18n.translate('agentTraces.evalsPage.runSuccess', {
                          defaultMessage: 'Success',
                        })
                      : status === 'failure'
                        ? i18n.translate('agentTraces.evalsPage.runFailure', {
                            defaultMessage: 'Failure',
                          })
                        : status}
                  </EuiBadge>
                </EuiFlexItem>
              )}
              {isRegression(run) && (
                <EuiFlexItem grow={false}>
                  <EuiBadge color="danger" iconType="sortDown" data-test-subj="agtEvlRunRegression">
                    {i18n.translate('agentTraces.evalsPage.regression', {
                      defaultMessage: 'Regression',
                    })}
                  </EuiBadge>
                </EuiFlexItem>
              )}
            </EuiFlexGroup>
            <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiText
                  size="xs"
                  color="subdued"
                  className="agtEvlMono"
                  data-test-subj="agtEvlRunId"
                >
                  {run.runId}
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiCopy textToCopy={run.runId}>
                  {(copy) => (
                    <EuiButtonEmpty
                      size="xs"
                      iconType="copyClipboard"
                      onClick={copy}
                      aria-label={i18n.translate('agentTraces.evalsPage.copyRunId', {
                        defaultMessage: 'Copy run id',
                      })}
                    />
                  )}
                </EuiCopy>
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="l" responsive={false} wrap>
              {facts.map(([title, value]) => (
                <EuiFlexItem grow={false} key={title}>
                  <EuiText size="xs" color="subdued">
                    {title}
                  </EuiText>
                  <EuiText size="s">
                    <strong>{value}</strong>
                  </EuiText>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
            {metadata.length > 0 && (
              <>
                <EuiSpacer size="s" />
                <EuiFlexGroup
                  gutterSize="xs"
                  wrap
                  responsive={false}
                  data-test-subj="agtEvlRunMetadata"
                >
                  {metadata.map(([k, v]) => (
                    <EuiFlexItem grow={false} key={k}>
                      <EuiBadge color="hollow" title={`${k}: ${v}`}>
                        {k}: {v.length > 48 ? `${v.slice(0, 45)}...` : v}
                      </EuiBadge>
                    </EuiFlexItem>
                  ))}
                </EuiFlexGroup>
              </>
            )}
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiToolTip
                  content={
                    previous
                      ? i18n.translate('agentTraces.evalsPage.comparePreviousTip', {
                          defaultMessage: 'Baseline: {previous}',
                          values: { previous: previous.runId },
                        })
                      : i18n.translate('agentTraces.evalsPage.noPreviousTip', {
                          defaultMessage: 'No earlier run of this suite in the time range',
                        })
                  }
                >
                  <EuiButton
                    size="s"
                    fill
                    iconType="merge"
                    isDisabled={!previous}
                    onClick={() => previous && onCompare([previous.runId, run.runId])}
                    data-test-subj="agtEvlComparePrevious"
                  >
                    {i18n.translate('agentTraces.evalsPage.comparePrevious', {
                      defaultMessage: 'Compare with previous run',
                    })}
                  </EuiButton>
                </EuiToolTip>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <CompareWithPicker run={run} others={suiteRuns} onPick={compareWith} />
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>
      <EuiSpacer size="m" />
      <EuiFlexGrid columns={4} gutterSize="s" data-test-subj="agtEvlRunCards">
        <EuiFlexItem>
          <EuiPanel hasBorder paddingSize="s" className="agtEvlStatCard">
            <EuiText size="xs">
              <strong>
                {i18n.translate('agentTraces.evalsPage.testCases', {
                  defaultMessage: 'Test cases',
                })}
              </strong>
            </EuiText>
            <EuiTitle size="s">
              <p data-test-subj="agtEvlRunCasePassRate">
                {formatPercent(run.cases ? run.casesPassed / run.cases : undefined)}
                <EuiTextColor color="subdued">
                  <small>
                    {' '}
                    {i18n.translate('agentTraces.evalsPage.passedShort', {
                      defaultMessage: 'passed',
                    })}
                  </small>
                </EuiTextColor>
              </p>
            </EuiTitle>
            <EuiSpacer size="xs" />
            <CaseSplit run={run} />
          </EuiPanel>
        </EuiFlexItem>
        {evaluatorNames.map((name) => (
          <EuiFlexItem key={name}>
            <RunScoreCard
              agg={run.evaluators[name]}
              previous={previous?.evaluators[name]}
              onSelect={setDrilldown}
            />
          </EuiFlexItem>
        ))}
      </EuiFlexGrid>
      <EuiSpacer size="m" />
      <EuiFlexGroup gutterSize="m">
        <EuiFlexItem grow={3}>
          <EuiPanel hasBorder paddingSize="m" className="agtEvlChartPanel">
            <SectionTitle
              title={i18n.translate('agentTraces.evalsPage.runCaseScores', {
                defaultMessage: 'Scores by test case',
              })}
              help={i18n.translate('agentTraces.evalsPage.caseScoresHelp', {
                defaultMessage: 'Scaled to each evaluation range, 100% is best.',
              })}
            />
            {evaluatorNames.length > 0 ? (
              <CaseScoresChart cases={cases} evaluatorNames={evaluatorNames} />
            ) : (
              <EuiText size="s" color="subdued">
                {i18n.translate('agentTraces.evalsPage.noRunGrades', {
                  defaultMessage: 'No grades in this run.',
                })}
              </EuiText>
            )}
          </EuiPanel>
        </EuiFlexItem>
        <EuiFlexItem grow={2}>
          <EuiPanel hasBorder paddingSize="m" className="agtEvlChartPanel">
            <SectionTitle
              title={i18n.translate('agentTraces.evalsPage.suiteTrend', {
                defaultMessage: 'Runs of this suite',
              })}
              help={i18n.translate('agentTraces.evalsPage.suiteTrendHelp', {
                defaultMessage:
                  'One point per run. The marker is this run; select a point to open a run.',
              })}
            />
            {trend.length > 1 ? (
              <SuiteTrendChart points={trend} currentRunId={run.runId} onSelectRun={onOpenRun} />
            ) : (
              <EuiText size="s" color="subdued" data-test-subj="agtEvlSuiteTrendEmpty">
                {i18n.translate('agentTraces.evalsPage.suiteTrendEmpty', {
                  defaultMessage:
                    'Only this run of the suite in the time range. Widen the range to see a trend.',
                })}
              </EuiText>
            )}
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiPanel hasBorder paddingSize="m">
        <SectionTitle
          title={i18n.translate('agentTraces.evalsPage.runCasesTitle', {
            defaultMessage: 'Test cases',
          })}
          help={i18n.translate('agentTraces.evalsPage.runCasesHelp', {
            defaultMessage:
              'Errored and failed first. Select an evaluation name to see where it fails.',
          })}
        />
        <EuiInMemoryTable<RunCaseRow>
          items={cases}
          itemId="caseId"
          columns={caseColumns}
          pagination={{ initialPageSize: 25, pageSizeOptions: [25, 50, 100] }}
          message={i18n.translate('agentTraces.evalsPage.noRunCases', {
            defaultMessage: 'No test cases recorded for this run.',
          })}
          data-test-subj="agtEvlRunCases"
        />
      </EuiPanel>
      {drilldown && (
        <EvaluatorDrilldownFlyout
          name={drilldown}
          results={results.filter((r) => r.runId === run.runId && r.name === drilldown)}
          scope={i18n.translate('agentTraces.evalsPage.drilldownRunScope', {
            defaultMessage: 'Run {runId}',
            values: { runId: run.runId },
          })}
          onClose={() => setDrilldown(undefined)}
          onOpenTrace={onOpenTrace}
        />
      )}
      {tracePair && (
        <TraceCompareFlyout
          caseName={tracePair.caseName}
          baseline={{
            label: tracePair.baseline.runId,
            traceId: tracePair.baseline.traceId,
            aroundMs: tracePair.baseline.aroundMs,
          }}
          candidate={{
            label: tracePair.candidate.runId,
            traceId: tracePair.candidate.traceId,
            aroundMs: tracePair.candidate.aroundMs,
          }}
          onClose={() => setTracePair(undefined)}
          onOpenTrace={onOpenTrace}
        />
      )}
    </div>
  );
};
