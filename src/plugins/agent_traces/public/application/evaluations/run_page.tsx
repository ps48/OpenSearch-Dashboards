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
  EuiContextMenuItem,
  EuiContextMenuPanel,
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
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  CaseRow,
  CaseStatus,
  recordsToResults,
  otherRunsOfSuite,
  runBefore,
  runDetail,
  suiteRuns,
} from './eval_model';
import {
  NO_AGENT,
  buildCaseResultsQuery,
  buildRunCasesQuery,
  buildRunsLookupQuery,
  buildSuiteRunsQuery,
} from './eval_ppl';
import { SpanIOView } from './span_io_view';
import { useRootSpans } from './eval_spans';
import {
  DASH,
  EXPECTED_LABEL,
  INPUT_LABEL,
  ResultRows,
  MetaItem,
  OUTPUT_LABEL,
  QueryErrorCallout,
  TallyCell,
  VerdictBadge,
  VersionBadge,
  agentLabel,
  expectedNote,
  expectedOf,
  formatDuration,
  formatTime,
  shortId,
} from './eval_components';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { CiLink, compareOrder } from './suite_page';

type StatusFilter = 'all' | CaseStatus;

const STATUS_ORDER: Record<CaseStatus, number> = { fail: 0, error: 1, pass: 2 };

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
 * An expanded case: its input, expected output and output (one root-span query), and its
 * results (one query), read when it opens.
 */
const CaseDetail: React.FC<{ runId: string; caseRow: CaseRow }> = ({ runId, caseRow }) => {
  const { dataset, index, timeRange, refreshKey, openResult } = useEvalContext();
  const { caseId } = caseRow;
  const { rows, loading, error } = usePplRows(
    dataset,
    buildCaseResultsQuery(index, runId, caseId),
    timeRange,
    refreshKey
  );
  const root = useRootSpans([caseRow.traceId]);
  const results = useMemo(
    () => recordsToResults(rows).sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
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

/** The run before a run (same suite, started last before it), from the runs in the range. */
export const useRunBefore = (runId?: string) => {
  const { dataset, index, browseRange, refreshKey } = useEvalContext();
  const lookup = usePplRows(
    dataset,
    runId ? buildRunsLookupQuery(index) : undefined,
    browseRange,
    refreshKey
  );
  const before = useMemo(
    () => (runId ? runBefore(lookup.rows, runId) : undefined),
    [lookup.rows, runId]
  );
  const others = useMemo(
    () => (runId ? otherRunsOfSuite(lookup.rows, runId) : 0),
    [lookup.rows, runId]
  );
  return { before, others, loaded: lookup.loaded, error: lookup.error };
};

/** "Compare with…": the suite's other runs, read when the menu opens. */
const CompareWithMenu: React.FC<{
  runId: string;
  suite?: string;
  started: number;
  /** Other runs of the suite in the range (from the runs lookup). */
  others: number;
}> = ({ runId, suite, started, others: otherCount }) => {
  const { dataset, index, browseRange, refreshKey, rangeLabel, navigate } = useEvalContext();
  const [open, setOpen] = useState(false);
  const { rows, loading } = usePplRows(
    dataset,
    open && suite ? buildSuiteRunsQuery(index, suite) : undefined,
    browseRange,
    refreshKey
  );
  const runs = useMemo(() => suiteRuns(rows), [rows]);
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
            otherCount === 0
              ? i18n.translate('agentTraces.evals.run.noOtherRuns', {
                  defaultMessage:
                    'No other run of this suite in {range} or the 30 days before this run.',
                  values: { range: rangeLabel },
                })
              : undefined
          }
        >
          <EuiButtonEmpty
            size="s"
            iconType="arrowDown"
            iconSide="right"
            isDisabled={!suite || otherCount === 0}
            onClick={() => setOpen(!open)}
            data-test-subj="agtEvlCompareWith"
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
        <EuiContextMenuPanel
          size="s"
          items={others.map((r) => (
            <EuiContextMenuItem
              key={r.runId}
              onClick={() => {
                setOpen(false);
                const [runA, runB] = compareOrder([r, self ?? { ...r, runId, started }]);
                navigate({ page: 'compare', runA, runB });
              }}
              data-test-subj={`agtEvlCompareWith-${r.runId}`}
            >
              {r.runId === before?.runId && (
                <strong>
                  {i18n.translate('agentTraces.evals.run.runBefore', {
                    defaultMessage: 'Run before',
                  })}
                  {' · '}
                </strong>
              )}
              <span className="agtEvlMono">{shortId(r.runId)}</span>{' '}
              <VersionBadge version={r.version} />{' '}
              <span className="agtEvlDim">{formatTime(r.started)}</span>
            </EuiContextMenuItem>
          ))}
        />
      )}
    </EuiPopover>
  );
};

/** A run figure, with the run before's value under it. */
const RunStat: React.FC<{
  title: string;
  label: string;
  was?: string;
  line?: string;
  testId: string;
}> = ({ title, label, was, line, testId }) => (
  <EuiFlexItem grow={false}>
    <EuiPanel paddingSize="s" hasShadow={false} hasBorder data-test-subj={testId}>
      <EuiStat titleSize="s" title={title} description={label} />
      {(was !== undefined || line) && (
        <EuiText size="xs" color="subdued">
          <p>
            {was !== undefined
              ? i18n.translate('agentTraces.evals.run.was', {
                  defaultMessage: 'was {value} in the run before',
                  values: { value: was },
                })
              : line}
          </p>
        </EuiText>
      )}
    </EuiPanel>
  </EuiFlexItem>
);

/** A run: its header, figures (against the run before) and cases (expand a case). */
export const RunPage: React.FC<{ runId: string }> = ({ runId }) => {
  const { dataset, index, browseRange, refreshKey, navigate, openTrace } = useEvalContext();
  const lookup = useRunBefore(runId);
  const beforeId = lookup.before?.runId;
  const { rows, loading, loaded, error } = usePplRows(
    dataset,
    lookup.loaded ? buildRunCasesQuery(index, runId, beforeId) : undefined,
    browseRange,
    refreshKey
  );
  const run = useMemo(() => runDetail(runId, rows), [runId, rows]);
  const prev = useMemo(() => (beforeId ? runDetail(beforeId, rows) : undefined), [beforeId, rows]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (error || lookup.error) return <QueryErrorCallout message={error ?? lookup.error ?? ''} />;
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
          <EuiButtonEmpty
            size="xs"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              openTrace(traceId, c.at);
            }}
            data-test-subj={`agtEvlViewTrace-${c.caseId}`}
          >
            {i18n.translate('agentTraces.evals.run.viewTrace', { defaultMessage: 'View trace' })}
          </EuiButtonEmpty>
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
  ];

  return (
    <>
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem>
          <div className="agtEvlMeta" data-test-subj="agtEvlRunMeta">
            <MetaItem
              label={i18n.translate('agentTraces.evals.run.suite', { defaultMessage: 'Suite' })}
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
            {run.ciUrl && (
              <MetaItem
                label={i18n.translate('agentTraces.evals.run.ci', { defaultMessage: 'CI' })}
              >
                <CiLink url={run.ciUrl} />
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
            others={lookup.others}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiFlexGroup gutterSize="m" responsive={false} wrap data-test-subj="agtEvlRunStats">
        <RunStat
          title={`${passed} / ${cases.length}`}
          label={i18n.translate('agentTraces.evals.run.casesPassed', {
            defaultMessage: 'Cases passed',
          })}
          was={prev ? `${prev.casesPassed} / ${prev.cases.length}` : undefined}
          testId="agtEvlStatCases"
        />
        <RunStat
          title={`${run.tally.pass} / ${run.tally.pass + run.tally.fail}`}
          label={i18n.translate('agentTraces.evals.run.resultsPassed', {
            defaultMessage: 'Results passed',
          })}
          was={prev ? `${prev.tally.pass} / ${prev.tally.pass + prev.tally.fail}` : undefined}
          testId="agtEvlStatResults"
        />
        <RunStat
          title={String(run.tally.error)}
          label={i18n.translate('agentTraces.evals.run.evaluatorErrors', {
            defaultMessage: 'Evaluator errors',
          })}
          was={prev ? String(prev.tally.error) : undefined}
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
            <EuiFilterGroup data-test-subj="agtEvlCaseStatus">
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
