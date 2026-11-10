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
  EuiButtonIcon,
  EuiCallOut,
  EuiDescriptionList,
  EuiFieldSearch,
  EuiFilterButton,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingContent,
  EuiNotificationBadge,
  EuiPanel,
  EuiPopover,
  EuiPopoverTitle,
  EuiSpacer,
  EuiStat,
  EuiIcon,
  EuiText,
  EuiTextColor,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  CaseRow,
  CaseStatus,
  PplRecord,
  recordsToResults,
  otherRunsOfSuite,
  runBefore,
  caseSpanOf,
  runDetail,
  suiteRuns,
  withCaseNames,
} from './eval_model';
import {
  NO_AGENT,
  buildCaseResultsQuery,
  buildRunCasesQuery,
  buildRunEvaluatorsQuery,
  buildRunsLookupQuery,
  buildSuiteRunsQuery,
  isTruncated,
} from './ppl_queries';
import { SpanIOView } from './span_io_view';
import { useCaseNames, useRunNames } from './use_run_names';
import { NewTabViewLink, traceHref } from './view_links';
import { useJudgedSpans } from './eval_spans';
import {
  CiLink,
  DASH,
  EXPECTED_LABEL,
  INPUT_LABEL,
  ResultRows,
  MetaItem,
  OUTPUT_LABEL,
  QueryErrorCallout,
  RunSelectList,
  TallyCell,
  TruncatedCallout,
  VerdictBadge,
  VersionBadge,
  agentLabel,
  expectedNote,
  expectedOf,
  formatDuration,
  formatTime,
  runLabel,
} from './eval_components';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { compareOrder } from './suite_page';

type StatusFilter = 'all' | CaseStatus;

const STATUS_ORDER: Record<CaseStatus, number> = { fail: 0, error: 1, pass: 2, scored: 3 };

/** Cases shown for a status and a search (case name or id), in the browser. */
export const filterCases = (cases: CaseRow[], status: StatusFilter, q: string): CaseRow[] => {
  const needle = q.trim().toLowerCase();
  return cases.filter(
    (c) =>
      (status === 'all' || c.status === status) &&
      (!needle || `${c.caseName ?? ''} ${c.caseId}`.toLowerCase().includes(needle))
  );
};

/**
 * An expanded case: its results (one query), then its input and output from the span they
 * point to (or the trace's AI root), read when it opens.
 */
const CaseDetail: React.FC<{ runId: string; caseRow: CaseRow }> = ({ runId, caseRow }) => {
  const { dataset, index, timeRange, refreshKey, openResult } = useEvalContext();
  const { caseId } = caseRow;
  const { rows, loading, loaded, error } = usePplRows(
    dataset,
    buildCaseResultsQuery(index, runId, caseId),
    timeRange,
    refreshKey
  );
  const results = useMemo(
    () => recordsToResults(rows).sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
  const target = useMemo(() => caseSpanOf(results, caseRow.traceId), [results, caseRow.traceId]);
  // After the results answer: they say which span the case's input and output are on.
  const root = useJudgedSpans(loaded ? [target] : []);
  const io = caseRow.traceId ? root.byTrace.get(caseRow.traceId) : undefined;
  const expected = expectedOf(results);
  if (error) return <QueryErrorCallout message={error} />;
  if (loading && !results.length) return <EuiLoadingContent lines={2} />;
  return (
    <div className="agtEvlCaseResults" data-test-subj={`agtEvlCaseResults-${caseId}`}>
      {/* A failed span read is an error, not missing input or output. */}
      {root.error && <QueryErrorCallout message={root.error} />}
      <SpanIOView
        idPrefix={`agtEvlCase-${caseId}`}
        testId="agtEvlCaseIO"
        sections={[
          { key: 'input', label: INPUT_LABEL, value: io?.rawInput ?? io?.input },
          { key: 'output', label: OUTPUT_LABEL, value: io?.rawOutput ?? io?.output },
          {
            key: 'expected',
            label: EXPECTED_LABEL,
            note: expectedNote(expected.truncated),
            value: expected.text,
          },
        ]}
      />
      <EuiSpacer size="s" />
      <EuiTitle size="xxs">
        <span>
          {i18n.translate('agentTraces.evals.run.caseResults', { defaultMessage: 'Results' })}
        </span>
      </EuiTitle>
      <ResultRows results={results} onOpen={openResult} testId="agtEvlCaseResultRows" />
    </div>
  );
};

/** What each evaluation of a run checks, by evaluation name (those with a description). */
export const evaluatorDescriptionsOf = (rows: PplRecord[]): Array<[string, string]> => {
  const out = new Map<string, string>();
  recordsToResults(rows).forEach((r) => {
    if (r.evaluatorDescription && !out.has(r.name)) out.set(r.name, r.evaluatorDescription);
  });
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
};

/** The run's evaluations and what each checks, when the SDK recorded a description. */
const EvaluationsSummary: React.FC<{ runId: string }> = ({ runId }) => {
  const { dataset, index, browseRange, refreshKey } = useEvalContext();
  const { rows } = usePplRows(
    dataset,
    buildRunEvaluatorsQuery(index, runId),
    browseRange,
    refreshKey
  );
  const described = useMemo(() => evaluatorDescriptionsOf(rows), [rows]);
  if (!described.length) return null;
  return (
    <>
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="s" hasShadow={false} hasBorder data-test-subj="agtEvlRunEvaluators">
        <EuiTitle size="xxs">
          <h4>
            {i18n.translate('agentTraces.evals.run.whatTheyCheck', {
              defaultMessage: 'What the evaluations check',
            })}
          </h4>
        </EuiTitle>
        <EuiSpacer size="xs" />
        <EuiDescriptionList
          type="column"
          compressed
          listItems={described.map(([name, description]) => ({
            title: name,
            description: <span className="agtEvlProse">{description}</span>,
          }))}
        />
      </EuiPanel>
    </>
  );
};

/**
 * The run before a run (same suite and agent, started last before it), from the suite's runs in the
 * range, latest first. Runs once the run's suite is known (`suite`: undefined while unknown,
 * `null` for a run without a suite, which has no run before).
 */
export const useRunBefore = (runId?: string, suite?: string | null) => {
  const { dataset, index, browseRange, refreshKey } = useEvalContext();
  const query = runId && typeof suite === 'string' ? buildRunsLookupQuery(index, suite) : undefined;
  const lookup = usePplRows(dataset, query, browseRange, refreshKey);
  const before = useMemo(
    () => (runId ? runBefore(lookup.rows, runId) : undefined),
    [lookup.rows, runId]
  );
  const others = useMemo(
    () => (runId ? otherRunsOfSuite(lookup.rows, runId) : 0),
    [lookup.rows, runId]
  );
  return {
    before,
    others,
    loaded: lookup.loaded || (!!runId && suite === null),
    error: lookup.error,
    truncated: isTruncated(lookup.rows),
  };
};

/**
 * The run page's "Compare with…": the other runs of its suite and agent, read when the menu
 * opens. The older run of the two is A.
 */
export const CompareWithMenu: React.FC<{
  runId: string;
  suite?: string;
  started: number;
  /** Other runs to compare with in the range (from a runs lookup). */
  others: number;
  /** The runs lookup failed: nothing to compare with is known. */
  unavailable?: boolean;
  /** The runs lookup has not answered yet. */
  pending?: boolean;
  /** The run's agent (undefined for no agent name): only its runs compare. */
  agent?: string;
  testId?: string;
}> = ({
  runId,
  suite,
  started,
  others: otherCount,
  unavailable,
  pending,
  agent,
  testId = 'agtEvlCompareWith',
}) => {
  const { dataset, index, browseRange, refreshKey, rangeLabel, navigate } = useEvalContext();
  const [open, setOpen] = useState(false);
  const { rows, loading } = usePplRows(
    dataset,
    open && suite ? buildSuiteRunsQuery(index, suite) : undefined,
    browseRange,
    refreshKey
  );
  const runs = useMemo(
    () => suiteRuns(rows).filter((r) => r.runId === runId || r.agent === agent),
    [rows, runId, agent]
  );
  const self = runs.find((r) => r.runId === runId);
  const before = runs.filter((r) => r.started < started).pop();
  const others = runs.filter((r) => r.runId !== runId).reverse();
  return (
    <EuiPopover
      isOpen={open}
      closePopover={() => setOpen(false)}
      panelPaddingSize="none"
      anchorPosition="downRight"
      button={
        <EuiToolTip
          content={
            unavailable
              ? i18n.translate('agentTraces.evals.run.runsUnavailable', {
                  defaultMessage: 'The runs of this test suite could not be read.',
                })
              : otherCount === 0 && !pending
                ? i18n.translate('agentTraces.evals.run.noOtherRuns', {
                    defaultMessage:
                      'No other run of this test suite and agent in {range} or the 30 days before this run.',
                    values: { range: rangeLabel },
                  })
                : undefined
          }
        >
          <EuiButtonEmpty
            size="s"
            iconType="arrowDown"
            iconSide="right"
            isDisabled={!suite || unavailable || pending || otherCount === 0}
            onClick={() => setOpen(!open)}
            data-test-subj={testId}
          >
            {i18n.translate('agentTraces.evals.run.compareWith', {
              defaultMessage: 'Compare with…',
            })}
          </EuiButtonEmpty>
        </EuiToolTip>
      }
    >
      <EuiPopoverTitle paddingSize="s">
        {i18n.translate('agentTraces.evals.run.compareThisWith', {
          defaultMessage: 'Compare this run with',
        })}
      </EuiPopoverTitle>
      {loading && !runs.length ? (
        <EuiLoadingContent lines={2} />
      ) : (
        <RunSelectList
          runs={others}
          loading={loading}
          marked={before?.runId}
          testId={`${testId}List`}
          onPick={(picked) => {
            setOpen(false);
            const r = others.find((x) => x.runId === picked);
            if (!r) return;
            const [runA, runB] = compareOrder([r, self ?? { ...r, runId, started }]);
            navigate({ page: 'compare', runA, runB });
          }}
        />
      )}
    </EuiPopover>
  );
};

/** The previous run of the suite, as the run figures name it. */
export interface PreviousRun {
  label: string;
  started: number;
  onCompare: () => void;
}

/** A figure's change against the previous run. */
export interface StatDelta {
  current: number;
  /** The previous run's value (undefined: the previous run has none). */
  previous?: number;
  /** The previous run's figure as shown (e.g. `7 / 8`), for the tooltip. */
  previousText?: string;
  /** Pass rates in percent: the change reads in points (`-25 pts`). */
  points?: boolean;
  /** More is better (passes), or worse (errors). */
  higherIsBetter: boolean;
}

/**
 * How a figure moved: up / down with its health color, the same, or new since that run (the
 * previous run has no such figure; a previous 0 is a value, so 0 to 2 is up).
 */
export const deltaOf = (d: StatDelta): { kind: 'up' | 'down' | 'same' | 'new'; diff: number } => {
  if (d.previous === undefined) return { kind: 'new', diff: d.current };
  const diff = d.current - d.previous;
  return { kind: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', diff };
};

/**
 * A "passed of total" figure's change: the passed count when both runs have the same total,
 * else the pass rate in points (5 / 5 then 9 / 12 is -25 pts, not +4). None without a total.
 */
export const passedDelta = (
  passed: number,
  total: number,
  prevPassed: number,
  prevTotal: number
): StatDelta | undefined => {
  const previousText = `${prevPassed} / ${prevTotal}`;
  if (total === prevTotal) {
    return { current: passed, previous: prevPassed, previousText, higherIsBetter: true };
  }
  if (!total || !prevTotal) return undefined;
  const pct = (p: number, t: number) => Math.round((p / t) * 100);
  return {
    current: pct(passed, total),
    previous: pct(prevPassed, prevTotal),
    previousText,
    higherIsBetter: true,
    points: true,
  };
};

const DeltaLine: React.FC<{ delta: StatDelta; prev: PreviousRun }> = ({ delta, prev }) => {
  const { kind, diff } = deltaOf(delta);
  const run = `${prev.label}, ${formatTime(prev.started, 'MMM D, HH:mm')}`;
  const good = kind === 'same' ? undefined : diff > 0 === delta.higherIsBetter;
  const color = good === undefined ? 'subdued' : good ? 'success' : 'danger';
  const text =
    kind === 'new'
      ? i18n.translate('agentTraces.evals.run.deltaNew', {
          defaultMessage: 'New since previous run ({run})',
          values: { run },
        })
      : kind === 'same'
        ? i18n.translate('agentTraces.evals.run.deltaSame', {
            defaultMessage: 'Same as previous run ({run})',
            values: { run },
          })
        : i18n.translate('agentTraces.evals.run.delta', {
            defaultMessage: '{diff} vs previous run ({run})',
            values: { diff: diff > 0 ? `+${diff}` : String(diff), run },
          });
  const shown =
    delta.points && kind !== 'new' && kind !== 'same'
      ? i18n.translate('agentTraces.evals.run.deltaPoints', {
          defaultMessage: '{diff} pts vs previous run ({run})',
          values: { diff: diff > 0 ? `+${diff}` : String(diff), run },
        })
      : text;
  return (
    <EuiText size="xs" data-test-subj="agtEvlStatDelta" data-delta={kind}>
      <p>
        <EuiToolTip
          content={
            delta.previousText !== undefined
              ? i18n.translate('agentTraces.evals.run.deltaWas', {
                  defaultMessage: 'Previous run: {value}',
                  values: { value: delta.previousText },
                })
              : undefined
          }
        >
          <EuiTextColor color={color}>
            {kind === 'up' && <EuiIcon type="sortUp" size="s" color={color} />}
            {kind === 'down' && <EuiIcon type="sortDown" size="s" color={color} />} {shown}
          </EuiTextColor>
        </EuiToolTip>{' '}
        <EuiLink onClick={prev.onCompare} data-test-subj="agtEvlStatDeltaCompare">
          {i18n.translate('agentTraces.evals.run.deltaCompare', { defaultMessage: 'Compare' })}
        </EuiLink>
      </p>
    </EuiText>
  );
};

/** A run figure, with its change against the previous run under it. */
const RunStat: React.FC<{
  title: string;
  label: string;
  delta?: StatDelta;
  prev?: PreviousRun;
  line?: string;
  testId: string;
}> = ({ title, label, delta, prev, line, testId }) => (
  <EuiFlexItem grow={false}>
    <EuiPanel paddingSize="s" hasShadow={false} hasBorder data-test-subj={testId}>
      <EuiStat titleSize="s" title={title} description={label} />
      {delta && prev ? (
        <DeltaLine delta={delta} prev={prev} />
      ) : (
        line && (
          <EuiText size="xs" color="subdued">
            <p>{line}</p>
          </EuiText>
        )
      )}
    </EuiPanel>
  </EuiFlexItem>
);

/** A run: its header, figures (against the run before) and cases (expand a case). */
export const RunPage: React.FC<{ runId: string }> = ({ runId }) => {
  const { dataset, index, browseRange, refreshKey, navigate, openTrace, hrefOf } = useEvalContext();
  // The run's cases first (they name its suite), then the suite's run before and its cases:
  // the page shows as soon as its own cases answer, the run before's figures fill in after.
  const { rows, loading, loaded, error } = usePplRows(
    dataset,
    buildRunCasesQuery(index, runId),
    browseRange,
    refreshKey
  );
  const detail = useMemo(() => runDetail(runId, rows), [runId, rows]);
  const caseNames = useCaseNames(useMemo(() => [runId], [runId]));
  const run = useMemo(
    () => detail && { ...detail, cases: withCaseNames(detail.cases, caseNames) },
    [detail, caseNames]
  );
  const lookup = useRunBefore(runId, run ? (run.suite ?? null) : undefined);
  const beforeId = lookup.before?.runId;
  const beforeCases = usePplRows(
    dataset,
    beforeId ? buildRunCasesQuery(index, beforeId) : undefined,
    browseRange,
    refreshKey
  );
  const prev = useMemo(
    () => (beforeId ? runDetail(beforeId, beforeCases.rows) : undefined),
    [beforeId, beforeCases.rows]
  );
  // The run's and the run before's names (each falls back to its short id).
  // Read over the browse range, where the run before was found (the page's own range is this
  // run's window, which the run before is outside of).
  const names = useRunNames(
    useMemo(() => (beforeId ? [runId, beforeId] : [runId]), [runId, beforeId]),
    browseRange
  );
  const own = names.get(runId);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (error) return <QueryErrorCallout message={error} />;
  if (!run) {
    return loading || !loaded ? (
      <EuiLoadingContent lines={6} />
    ) : (
      <EuiText color="subdued" data-test-subj="agtEvlRunEmpty">
        <p>
          {i18n.translate('agentTraces.evals.run.empty', {
            defaultMessage: 'No results of this run in the range. Widen the range.',
          })}
        </p>
      </EuiText>
    );
  }

  const cases = run.cases;
  const count = (s: CaseStatus) => cases.filter((c) => c.status === s).length;
  const shown = filterCases(cases, status, q);
  const toggle = (caseId: string) => setExpanded((e) => ({ ...e, [caseId]: !e[caseId] }));
  const expandedMap = Object.fromEntries(
    shown
      .filter((c) => expanded[c.caseId])
      .map((c) => [c.caseId, <CaseDetail runId={runId} caseRow={c} />])
  );

  const columns: Array<EuiBasicTableColumn<CaseRow>> = [
    {
      width: '32px',
      isExpander: true,
      render: (c: CaseRow) => (
        <EuiButtonIcon
          onClick={() => toggle(c.caseId)}
          aria-label={i18n.translate('agentTraces.evals.run.expand', {
            defaultMessage: 'Show results',
          })}
          iconType={expanded[c.caseId] ? 'arrowDown' : 'arrowRight'}
        />
      ),
    },
    {
      field: 'caseName',
      name: i18n.translate('agentTraces.evals.run.case', { defaultMessage: 'Case' }),
      sortable: (c: CaseRow) => c.caseName ?? c.caseId,
      render: (_: unknown, c: CaseRow) => (
        <span>
          <strong>{c.caseName ?? c.caseId}</strong>{' '}
          <span className="agtEvlDim agtEvlSmall agtEvlMono">{c.caseId}</span>
        </span>
      ),
    },
    {
      field: 'status',
      name: i18n.translate('agentTraces.evals.run.status', { defaultMessage: 'Status' }),
      sortable: (c: CaseRow) => STATUS_ORDER[c.status],
      render: (s: CaseStatus) => <VerdictBadge verdict={s} />,
    },
    {
      field: 'failed',
      name: i18n.translate('agentTraces.evals.run.failedEvals', {
        defaultMessage: 'Failed evaluations',
      }),
      render: (_: unknown, c: CaseRow) =>
        c.failed.length || c.errored.length ? (
          <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
            {c.failed.map((n) => (
              <EuiFlexItem grow={false} key={`f-${n}`}>
                <EuiBadge color="danger">{n}</EuiBadge>
              </EuiFlexItem>
            ))}
            {c.errored.map((n) => (
              <EuiFlexItem grow={false} key={`e-${n}`}>
                <EuiBadge color="warning">{n}</EuiBadge>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        ) : (
          <span className="agtEvlDim">{DASH}</span>
        ),
    },
    {
      field: 'tally',
      name: i18n.translate('agentTraces.evals.run.results', { defaultMessage: 'Results' }),
      render: (_: unknown, c: CaseRow) => <TallyCell tally={c.tally} />,
    },
    {
      field: 'traceId',
      name: '',
      align: 'right',
      render: (traceId: string | undefined, c: CaseRow) =>
        traceId ? (
          <NewTabViewLink
            button
            href={traceHref(hrefOf, traceId, c.at)}
            onOpen={() => openTrace(traceId, c.at)}
            label={i18n.translate('agentTraces.evals.run.viewTrace', {
              defaultMessage: 'View trace',
            })}
            testId={`agtEvlViewTrace-${c.caseId}`}
          />
        ) : null,
    },
  ];

  const passed = count('pass');
  const filters: Array<[StatusFilter, string, number]> = [
    ['all', i18n.translate('agentTraces.evals.run.all', { defaultMessage: 'All' }), cases.length],
    [
      'fail',
      i18n.translate('agentTraces.evals.run.failed', { defaultMessage: 'Failed' }),
      count('fail'),
    ],
    [
      'error',
      i18n.translate('agentTraces.evals.run.errors', { defaultMessage: 'Errors' }),
      count('error'),
    ],
    ['pass', i18n.translate('agentTraces.evals.run.passed', { defaultMessage: 'Passed' }), passed],
    // Cases with scores only (no pass rule): shown when there are some.
    ...(count('scored')
      ? ([
          [
            'scored',
            i18n.translate('agentTraces.evals.run.scoredOnly', { defaultMessage: 'Scored' }),
            count('scored'),
          ],
        ] as Array<[StatusFilter, string, number]>)
      : []),
  ];

  const previousRun: PreviousRun | undefined =
    beforeId && lookup.before
      ? {
          label: runLabel({ runId: beforeId, name: names.get(beforeId)?.name }),
          started: lookup.before.started,
          onCompare: () => navigate({ page: 'compare', runA: beforeId, runB: runId }),
        }
      : undefined;

  // The run before is optional: a failed lookup leaves the run's figures, with a warning.
  const beforeError = lookup.error ?? beforeCases.error;
  return (
    <>
      {isTruncated(rows) && (
        <>
          <TruncatedCallout />
          <EuiSpacer size="s" />
        </>
      )}
      {beforeError && (
        <>
          <EuiCallOut
            color="warning"
            iconType="alert"
            size="s"
            title={i18n.translate('agentTraces.evals.run.beforeError', {
              defaultMessage: 'Could not read the run before',
            })}
            data-test-subj="agtEvlRunBeforeError"
          >
            <EuiText size="xs">
              <p>{beforeError}</p>
            </EuiText>
          </EuiCallOut>
          <EuiSpacer size="s" />
        </>
      )}
      {own?.description && (
        <>
          <EuiText
            size="s"
            color="subdued"
            className="agtEvlProse"
            data-test-subj="agtEvlRunDescription"
          >
            <p>{own.description}</p>
          </EuiText>
          <EuiSpacer size="s" />
        </>
      )}
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem>
          <div className="agtEvlMeta" data-test-subj="agtEvlRunMeta">
            {own?.name && (
              <MetaItem
                label={i18n.translate('agentTraces.evals.run.runName', { defaultMessage: 'Run' })}
              >
                <strong data-test-subj="agtEvlRunName">{own.name}</strong>
              </MetaItem>
            )}
            <MetaItem
              label={i18n.translate('agentTraces.evals.run.suite', {
                defaultMessage: 'Test suite',
              })}
            >
              {run.suite ? (
                <EuiLink onClick={() => run.suite && navigate({ page: 'suite', suite: run.suite })}>
                  <strong>{run.suite}</strong>
                </EuiLink>
              ) : (
                DASH
              )}
            </MetaItem>
            <MetaItem
              label={i18n.translate('agentTraces.evals.run.agent', { defaultMessage: 'Agent' })}
            >
              <EuiLink
                onClick={() =>
                  navigate({ page: 'agent', agent: run.agent ?? NO_AGENT, tab: 'evaluations' })
                }
              >
                <strong>{agentLabel(run.agent)}</strong>
              </EuiLink>{' '}
              <VersionBadge version={run.version} />
            </MetaItem>
            <MetaItem
              label={i18n.translate('agentTraces.evals.run.started', { defaultMessage: 'Started' })}
            >
              <strong>{formatTime(run.started, 'MMM D, HH:mm:ss')}</strong>
            </MetaItem>
            <MetaItem
              label={i18n.translate('agentTraces.evals.run.duration', {
                defaultMessage: 'Duration',
              })}
            >
              <strong>{formatDuration(run.durationMs)}</strong>
            </MetaItem>
            {own?.ciUrl && (
              <MetaItem
                label={i18n.translate('agentTraces.evals.run.ci', { defaultMessage: 'CI' })}
              >
                <CiLink url={own.ciUrl} />
              </MetaItem>
            )}
            <span className="agtEvlMono agtEvlDim" title="test.suite.run.id">
              {runId}
            </span>
          </div>
        </EuiFlexItem>
        {beforeId && (
          <EuiFlexItem grow={false}>
            <EuiButton
              size="s"
              fill
              onClick={() => navigate({ page: 'compare', runA: beforeId, runB: runId })}
              data-test-subj="agtEvlCompareRunBefore"
            >
              {i18n.translate('agentTraces.evals.run.compareRunBefore', {
                defaultMessage: 'Compare with run before',
              })}
            </EuiButton>
          </EuiFlexItem>
        )}
        <EuiFlexItem grow={false}>
          <CompareWithMenu
            runId={runId}
            suite={run.suite}
            started={run.started}
            agent={run.agent}
            others={lookup.others}
            unavailable={!!lookup.error}
            pending={!lookup.loaded}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiFlexGroup gutterSize="m" responsive={false} wrap data-test-subj="agtEvlRunStats">
        <RunStat
          title={`${passed} / ${cases.length}`}
          label={i18n.translate('agentTraces.evals.run.casesPassed', {
            defaultMessage: 'Cases passed',
          })}
          prev={previousRun}
          delta={prev && passedDelta(passed, cases.length, prev.casesPassed, prev.cases.length)}
          testId="agtEvlStatCases"
        />
        <RunStat
          title={`${run.tally.pass} / ${run.tally.pass + run.tally.fail}`}
          label={i18n.translate('agentTraces.evals.run.resultsPassed', {
            defaultMessage: 'Results passed',
          })}
          prev={previousRun}
          delta={
            prev &&
            passedDelta(
              run.tally.pass,
              run.tally.pass + run.tally.fail,
              prev.tally.pass,
              prev.tally.pass + prev.tally.fail
            )
          }
          testId="agtEvlStatResults"
        />
        <RunStat
          title={String(run.tally.error)}
          label={i18n.translate('agentTraces.evals.run.evaluatorErrors', {
            defaultMessage: 'Evaluator errors',
          })}
          prev={previousRun}
          delta={
            prev && {
              current: run.tally.error,
              previous: prev.tally.error,
              previousText: String(prev.tally.error),
              higherIsBetter: false,
            }
          }
          testId="agtEvlStatErrors"
        />
        <RunStat
          title={run.tally.n.toLocaleString()}
          label={i18n.translate('agentTraces.evals.run.resultsStat', {
            defaultMessage: 'Results',
          })}
          line={i18n.translate('agentTraces.evals.run.resultsLine', {
            defaultMessage: '{cases} cases × {evals} evaluations: {names}',
            values: {
              cases: cases.length,
              evals: run.evaluations.length,
              names: run.evaluations.join(', '),
            },
          })}
          testId="agtEvlStatTotal"
        />
      </EuiFlexGroup>
      <EvaluationsSummary runId={runId} />
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <EuiTitle size="xs">
          <h3>
            {i18n.translate('agentTraces.evals.run.cases', { defaultMessage: 'Cases' })}{' '}
            <EuiNotificationBadge color="subdued">{cases.length}</EuiNotificationBadge>
          </h3>
        </EuiTitle>
        <EuiText size="xs" color="subdued">
          <p>
            {i18n.translate('agentTraces.evals.run.casesSub', {
              defaultMessage:
                'Each case has one result per evaluation. A case passes only when all its results pass; it fails when any fails, and errors when an evaluator errored or the task raised. Click a case for its input, output, expected output and results.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiFilterGroup compressed data-test-subj="agtEvlCaseStatus">
              {filters.map(([key, label, n]) => (
                <EuiFilterButton
                  key={key}
                  hasActiveFilters={status === key}
                  numFilters={n}
                  onClick={() => setStatus(key)}
                  data-test-subj={`agtEvlCaseStatus-${key}`}
                >
                  {label}
                </EuiFilterButton>
              ))}
            </EuiFilterGroup>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiFieldSearch
              fullWidth
              compressed
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={i18n.translate('agentTraces.evals.run.search', {
                defaultMessage: 'Search cases',
              })}
              data-test-subj="agtEvlCaseSearch"
            />
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiInMemoryTable<CaseRow>
          items={shown}
          itemId="caseId"
          columns={columns}
          isExpandable
          itemIdToExpandedRowMap={expandedMap}
          sorting={{ sort: { field: 'status', direction: 'asc' } }}
          pagination={{ initialPageSize: 50, pageSizeOptions: [50, 100] }}
          rowProps={(c: CaseRow) => ({
            className: 'agtEvlClickRow',
            onClick: (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest('a,button')) return;
              toggle(c.caseId);
            },
            'data-test-subj': `agtEvlCaseRow-${c.caseId}`,
          })}
          data-test-subj="agtEvlCasesTable"
        />
      </EuiPanel>
    </>
  );
};
