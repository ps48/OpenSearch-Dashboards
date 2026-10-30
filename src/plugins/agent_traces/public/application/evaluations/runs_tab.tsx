/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiButton,
  EuiCode,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiSpacer,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { EMPTY_RUN_EVENTS } from './eval_data';
import { RunSummary, compareValues } from './eval_aggregations';
import { formatAggregateDelta } from './eval_compare';
import {
  CASE_STATUS_COLOR,
  SectionHeader,
  formatAggregate,
  formatDuration,
  formatEvalTime,
  formatTokens,
  shortId,
} from './eval_components';
import { ChangeDelta, CompareRuns, agentModelOf, agentVersionOf, shortModel } from './compare_runs';
import { MAX_COMPARE_RUNS } from './eval_url_state';
import { LAST_30D, NoResultsInRange } from './eval_empty_states';
import type { RunsDetailState } from './use_eval_data';
import { SuiteDetail } from './suite_detail';

/** No runs in the runs range: what runs are, and one click to the last 30 days. */
export const NoRunsPrompt: React.FC<{ onSelectRange?: (from: string) => void }> = ({
  onSelectRange,
}) => (
  <NoResultsInRange
    iconType="beaker"
    data-test-subj="agtEvlNoRuns"
    ranges={[LAST_30D]}
    onSelectRange={onSelectRange}
    title={
      <FormattedMessage
        id="agentTraces.evalsPage.noRunsTitle"
        defaultMessage="No evaluation runs in this range"
      />
    }
    body={
      <p>
        <FormattedMessage
          id="agentTraces.evalsPage.noRunsBody"
          defaultMessage="Runs are offline experiments: a test suite run against your agent, each test case scored, grouped by {runId}. Widen the time range, or run a suite with the OpenSearch GenAI SDK ({evaluate})."
          values={{
            runId: <EuiCode>test.suite.run.id</EuiCode>,
            evaluate: <EuiCode>evaluate()</EuiCode>,
          }}
        />
      </p>
    }
  />
);

/** Passed, failed and errored cases as a small bar with the counts. */
export const MiniCaseSplit: React.FC<{ run: RunSummary }> = ({ run }) => {
  const total = Math.max(1, run.cases);
  const parts = [
    { id: 'pass', count: run.casesPassed, color: CASE_STATUS_COLOR.pass },
    { id: 'fail', count: run.casesFailed, color: CASE_STATUS_COLOR.fail },
    { id: 'error', count: run.casesErrored, color: CASE_STATUS_COLOR.error },
  ];
  return (
    <EuiToolTip
      content={i18n.translate('agentTraces.evalsPage.splitTip', {
        defaultMessage: '{passed} passed, {failed} failed, {errored} errored of {cases}',
        values: {
          passed: run.casesPassed,
          failed: run.casesFailed,
          errored: run.casesErrored,
          cases: run.cases,
        },
      })}
    >
      <span data-test-subj="agtEvlRunSplit">
        <span className="agtEvlMiniSplit" aria-hidden>
          {parts.map((p) => (
            <span
              key={p.id}
              className="agtEvlMiniSplit__seg"
              style={{ width: `${(p.count / total) * 100}%`, background: p.color }}
            />
          ))}
        </span>
        <span className="agtEvlMiniSplit__text">
          <strong>{run.casesPassed}</strong>/{run.cases}
          {run.casesFailed > 0 && (
            <span style={{ color: CASE_STATUS_COLOR.fail }}>
              {' '}
              {i18n.translate('agentTraces.evalsPage.failedSuffix', {
                defaultMessage: '{count} failed',
                values: { count: run.casesFailed },
              })}
            </span>
          )}
          {run.casesErrored > 0 && (
            <span style={{ color: CASE_STATUS_COLOR.error }} data-test-subj="agtEvlRunErroredCount">
              {' '}
              {i18n.translate('agentTraces.evalsPage.erroredSuffix', {
                defaultMessage: '{count} errored',
                values: { count: run.casesErrored },
              })}
            </span>
          )}
        </span>
      </span>
    </EuiToolTip>
  );
};

/** `success`: completed; `failure`: some test case errored; no run event: unknown. */
export const RunStatusPill: React.FC<{ run: RunSummary }> = ({ run }) => {
  if (run.status === 'failure' || run.casesErrored > 0) {
    return (
      <EuiToolTip
        content={i18n.translate('agentTraces.evalsPage.erroredTip', {
          defaultMessage:
            '{count, plural, one {# test case} other {# test cases}} raised an error (the task or a scorer failed)',
          values: { count: run.casesErrored },
        })}
      >
        <EuiBadge color="warning" iconType="alert" data-test-subj="agtEvlRunErrored">
          {i18n.translate('agentTraces.evalsPage.errored', { defaultMessage: 'Errored' })}
        </EuiBadge>
      </EuiToolTip>
    );
  }
  if (run.status === 'success') {
    return (
      <EuiBadge color="hollow" data-test-subj="agtEvlRunCompleted">
        {i18n.translate('agentTraces.evalsPage.completed', { defaultMessage: 'Completed' })}
      </EuiBadge>
    );
  }
  return (
    <EuiToolTip
      content={i18n.translate('agentTraces.evalsPage.noRunEventTip', {
        defaultMessage: 'The producer sent no run event: counts come from the grades.',
      })}
    >
      <EuiText size="xs" color="subdued" data-test-subj="agtEvlRunNoStatus">
        -
      </EuiText>
    </EuiToolTip>
  );
};

export interface SuiteSummary {
  name: string;
  /** Runs of the suite, newest first. */
  runs: RunSummary[];
  latest: RunSummary;
  previous?: RunSummary;
}

const NO_SUITE = '(no suite name)';

/** Runs grouped by `test.suite.name`, the suite with the most recent run first. */
export const groupBySuite = (runs: RunSummary[]): SuiteSummary[] => {
  const bySuite = new Map<string, RunSummary[]>();
  runs.forEach((r) => {
    const key = r.suiteName ?? NO_SUITE;
    bySuite.set(key, [...(bySuite.get(key) ?? []), r]);
  });
  return Array.from(bySuite.entries())
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => b.started - a.started);
      return { name, runs: sorted, latest: sorted[0], previous: sorted[1] };
    })
    .sort((a, b) => b.latest.started - a.latest.started);
};

/** Change in passed cases of the latest run against the previous run of the suite. */
const SuiteChange: React.FC<{ suite: SuiteSummary }> = ({ suite }) => {
  if (!suite.previous) {
    return (
      <EuiText size="xs" color="subdued">
        -
      </EuiText>
    );
  }
  const delta = suite.latest.casesPassed - suite.previous.casesPassed;
  if (delta === 0) {
    return (
      <EuiBadge color="hollow" data-test-subj="agtEvlSuiteChange">
        {i18n.translate('agentTraces.evalsPage.suiteSame', { defaultMessage: 'same' })}
      </EuiBadge>
    );
  }
  return (
    <EuiBadge color={delta < 0 ? 'danger' : 'success'} data-test-subj="agtEvlSuiteChange">
      {i18n.translate('agentTraces.evalsPage.suiteChange', {
        defaultMessage: '{arrow} {count} {count, plural, one {case} other {cases}}',
        values: { arrow: delta < 0 ? '↘' : '↗', count: Math.abs(delta) },
      })}
    </EuiBadge>
  );
};

/** The first level: one row per test suite. */
export const SuitesTable: React.FC<{
  suites: SuiteSummary[];
  selected?: string;
  onSelect: (name?: string) => void;
}> = ({ suites, selected, onSelect }) => {
  const columns: Array<EuiBasicTableColumn<SuiteSummary>> = [
    {
      field: 'name',
      name: i18n.translate('agentTraces.evalsPage.colSuiteName', { defaultMessage: 'Test suite' }),
      render: (name: string) => (
        <EuiLink
          onClick={() => onSelect(selected === name ? undefined : name)}
          data-test-subj="agtEvlSuiteLink"
        >
          <strong>{name}</strong>
        </EuiLink>
      ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colSuiteLatest', {
        defaultMessage: 'Latest run',
      }),
      render: (suite: SuiteSummary) => <MiniCaseSplit run={suite.latest} />,
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colSuiteChange', {
        defaultMessage: 'Change vs previous run',
      }),
      render: (suite: SuiteSummary) => <SuiteChange suite={suite} />,
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colSuiteRuns', { defaultMessage: 'Runs' }),
      width: '80px',
      render: (suite: SuiteSummary) => (
        <EuiText size="xs" className="agtEvlNum">
          {suite.runs.length}
        </EuiText>
      ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colSuiteCases', { defaultMessage: 'Cases' }),
      width: '80px',
      render: (suite: SuiteSummary) => (
        <EuiText size="xs" className="agtEvlNum">
          {suite.latest.cases}
        </EuiText>
      ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colSuiteLastRun', {
        defaultMessage: 'Last run',
      }),
      render: (suite: SuiteSummary) => (
        <EuiText size="xs" color="subdued">
          {formatEvalTime(new Date(suite.latest.started).toISOString())}
        </EuiText>
      ),
    },
  ];
  return (
    <EuiInMemoryTable<SuiteSummary>
      compressed
      className="agtEvlDenseTable"
      items={suites}
      itemId="name"
      columns={columns}
      rowProps={(suite: SuiteSummary) => ({
        className: suite.name === selected ? 'euiTableRow-isSelected' : undefined,
        'data-test-subj': 'agtEvlSuiteRow',
      })}
      pagination={
        suites.length > 10 ? { initialPageSize: 10, pageSizeOptions: [10, 25] } : undefined
      }
      data-test-subj="agtEvlSuitesTable"
    />
  );
};

/** Run metadata keys holding token counts or cost, when producers attach them. */
const metadataKey = (runs: RunSummary[], test: RegExp) =>
  runs
    .flatMap((r) => Object.keys(r.metadata ?? {}))
    .find((k) => test.test(k) && runs.some((r) => Number.isFinite(Number(r.metadata?.[k]))));

/** Tokens and Cost columns, only when some run's metadata has them. */
const usageColumns = (runs: RunSummary[]): Array<EuiBasicTableColumn<RunSummary>> => {
  const tokens = metadataKey(runs, /tokens?$/i);
  const cost = metadataKey(runs, /cost/i);
  const columns: Array<EuiBasicTableColumn<RunSummary>> = [];
  const value = (run: RunSummary, key: string) => {
    const n = Number(run.metadata?.[key]);
    return run.metadata?.[key] !== undefined && Number.isFinite(n) ? n : undefined;
  };
  if (tokens) {
    columns.push({
      name: i18n.translate('agentTraces.evalsPage.colTokens', { defaultMessage: 'Tokens' }),
      width: '80px',
      render: (run: RunSummary) => (
        <EuiText size="xs" className="agtEvlNum" data-test-subj="agtEvlRunTokens">
          {formatTokens(value(run, tokens))}
        </EuiText>
      ),
    });
  }
  if (cost) {
    columns.push({
      name: i18n.translate('agentTraces.evalsPage.colCost', { defaultMessage: 'Cost' }),
      width: '80px',
      render: (run: RunSummary) => {
        const n = value(run, cost);
        return (
          <EuiText size="xs" className="agtEvlNum" data-test-subj="agtEvlRunCost">
            {n === undefined ? '-' : `$${n.toFixed(n < 1 ? 4 : 2)}`}
          </EuiText>
        );
      },
    });
  }
  return columns;
};

/** The suite last opened in this browser session. */
let lastSuite: string | undefined;
/** For tests: start from the suite list. */
export const resetLastSuite = () => {
  lastSuite = undefined;
};

export const RunsTab: React.FC<{
  /** Runs in the runs time range, newest first (see `useRunResults`). */
  runs: RunSummary[];
  /** Compared runs in column order, and the baseline (the first by default). */
  compare?: string[];
  baseline?: string;
  /** Grades and events of the compared runs, read by run id (any time). */
  compareData?: RunsDetailState;
  onCompareChange: (compare?: string[], baseline?: string) => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
  /** Opens the run's page. */
  onOpenRun?: (runId: string) => void;
  /** Label of the back link of a comparison (the run page it was opened from). */
  backLabel?: string;
  /** Sets the runs range (`now-30d` to now) from the empty state. */
  onSelectRange?: (from: string) => void;
}> = ({
  runs,
  compare,
  baseline,
  compareData,
  onCompareChange,
  onOpenTrace,
  onOpenRun,
  backLabel,
  onSelectRange,
}) => {
  const [selection, setSelection] = useState<RunSummary[]>([]);
  // Back from a run's page, the suite it was opened from is still the one shown.
  const [suite, setSuiteState] = useState<string | undefined>(() => lastSuite);
  const setSuite = (next: string | undefined) => {
    lastSuite = next;
    setSuiteState(next);
  };
  const suites = useMemo(() => groupBySuite(runs), [runs]);
  const shownRuns = useMemo(
    () => (suite ? runs.filter((r) => (r.suiteName ?? NO_SUITE) === suite) : runs),
    [runs, suite]
  );
  // The run the latest run of the shown suite is measured against: the run before it.
  const suiteBaselineId = useMemo(() => {
    if (!suite) return undefined;
    const latest = [...shownRuns].sort((a, b) => b.started - a.started)[0];
    return latest?.previousRunId;
  }, [suite, shownRuns]);

  if (compare) {
    const baselineId = baseline && compare.includes(baseline) ? baseline : compare[0];
    const data = compareData ?? {
      results: [],
      events: EMPTY_RUN_EVENTS,
      loading: true,
      missing: [],
    };
    return (
      <CompareRuns
        runIds={compare}
        baselineId={baselineId}
        results={data.results}
        events={data.events}
        loading={data.loading}
        error={data.error}
        missing={data.missing}
        available={runs}
        onChange={(runIds, next) => onCompareChange(runIds, next)}
        onBack={() => onCompareChange(undefined)}
        backLabel={backLabel}
        onOpenTrace={onOpenTrace}
      />
    );
  }

  if (runs.length === 0) return <NoRunsPrompt onSelectRange={onSelectRange} />;

  const sameSuite = selection.every((r) => (r.suiteName ?? '') === (selection[0]?.suiteName ?? ''));
  const countOk = selection.length >= 2 && selection.length <= MAX_COMPARE_RUNS;
  const canCompare = countOk && sameSuite;
  const compareHint = !countOk
    ? i18n.translate('agentTraces.evalsPage.compareHintCount', {
        defaultMessage: 'Select 2 to {max} runs of the same suite.',
        values: { max: MAX_COMPARE_RUNS },
      })
    : !sameSuite
      ? i18n.translate('agentTraces.evalsPage.compareHintSuite', {
          defaultMessage: 'The runs must belong to the same suite.',
        })
      : undefined;

  const columns: Array<EuiBasicTableColumn<RunSummary>> = [
    {
      field: 'runId',
      name: i18n.translate('agentTraces.evalsPage.colRun', { defaultMessage: 'Run' }),
      sortable: true,
      render: (runId: string, run: RunSummary) => (
        <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
          <EuiFlexItem grow={false}>
            <EuiToolTip content={runId}>
              {onOpenRun ? (
                <EuiLink onClick={() => onOpenRun(runId)} data-test-subj="agtEvlRunLink">
                  <EuiText size="xs" className="agtEvlMono">
                    {shortId(runId, 28)}
                  </EuiText>
                </EuiLink>
              ) : (
                <EuiText size="xs" className="agtEvlMono">
                  {shortId(runId, 28)}
                </EuiText>
              )}
            </EuiToolTip>
          </EuiFlexItem>
          {runId === suiteBaselineId && (
            <EuiFlexItem grow={false}>
              <EuiBadge color="hollow" data-test-subj="agtEvlRunBaselineBadge">
                {i18n.translate('agentTraces.evalsPage.baselineBadge', {
                  defaultMessage: 'baseline',
                })}
              </EuiBadge>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      ),
    },
    {
      field: 'suiteName',
      name: i18n.translate('agentTraces.evalsPage.colSuite', { defaultMessage: 'Suite' }),
      sortable: true,
      render: (suiteName?: string) => suiteName ?? '-',
    },
    {
      field: 'started',
      name: i18n.translate('agentTraces.evalsPage.colStarted', { defaultMessage: 'Started' }),
      sortable: true,
      render: (started: number) => formatEvalTime(started, 'MMM D, YYYY HH:mm'),
    },
    {
      field: 'status',
      name: i18n.translate('agentTraces.evalsPage.colStatus', { defaultMessage: 'Status' }),
      width: '100px',
      render: (_status: string | undefined, run: RunSummary) => <RunStatusPill run={run} />,
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colAgentVersion', {
        defaultMessage: 'Agent version',
      }),
      width: '100px',
      render: (run: RunSummary) => (
        <EuiText size="xs" data-test-subj="agtEvlRunAgentVersion">
          {agentVersionOf(run) ?? '-'}
        </EuiText>
      ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colModel', { defaultMessage: 'Model' }),
      render: (run: RunSummary) => {
        const model = agentModelOf(run);
        return model ? (
          <EuiToolTip content={model}>
            <EuiText size="xs" className="eui-textTruncate" data-test-subj="agtEvlRunModel">
              {shortModel(model)}
            </EuiText>
          </EuiToolTip>
        ) : (
          <EuiText size="xs" color="subdued">
            -
          </EuiText>
        );
      },
    },
    {
      field: 'durationMs',
      name: i18n.translate('agentTraces.evalsPage.colDuration', { defaultMessage: 'Duration' }),
      sortable: true,
      width: '90px',
      render: (ms?: number) => formatDuration(ms),
    },
    {
      field: 'casesPassed',
      name: i18n.translate('agentTraces.evalsPage.colPassed', { defaultMessage: 'Passed' }),
      sortable: (run: RunSummary) => (run.cases ? run.casesPassed / run.cases : 0),
      width: '190px',
      render: (_passed: number, run: RunSummary) => <MiniCaseSplit run={run} />,
    },
    // Per-evaluation scores live on the run's own page, not as columns here.
    ...usageColumns(runs),
    {
      field: 'agentName',
      name: i18n.translate('agentTraces.evalsPage.colRunAgent', { defaultMessage: 'Agent' }),
      render: (agent: string | undefined, run: RunSummary) => agent ?? run.serviceName ?? '-',
    },
  ];

  return (
    <div data-test-subj="agtEvlRuns">
      <SectionHeader
        title={i18n.translate('agentTraces.evalsPage.suitesTitle', {
          defaultMessage: 'Test suites',
        })}
        count={suites.length}
        help={i18n.translate('agentTraces.evalsPage.suitesHelp', {
          defaultMessage:
            'A test suite is a fixed set of test cases, such as a benchmark or an experiment, that you run your agent against. Each run is scored, so you can track quality over time and compare runs.',
        })}
      />
      <EuiSpacer size="s" />
      {suite ? (
        <SuiteDetail
          suite={suite}
          suiteName={suite === NO_SUITE ? undefined : suite}
          suites={suites.map((x) => x.name)}
          runs={shownRuns}
          onSelect={setSuite}
          onOpenRun={onOpenRun}
        />
      ) : (
        <SuitesTable suites={suites} selected={suite} onSelect={setSuite} />
      )}
      {/* Runs are shown per suite only: the suite list is the entry point. */}
      {suite && (
        <>
          <EuiSpacer size="l" />
          <SectionHeader
            title={i18n.translate('agentTraces.evalsPage.runsOfSuite', {
              defaultMessage: 'Runs of {suite}',
              values: { suite },
            })}
            count={shownRuns.length}
            help={i18n.translate('agentTraces.evalsPage.runsHelp', {
              defaultMessage:
                'Open a run for its test cases, or select 2 to 5 runs of a suite to compare.',
            })}
            actions={
              <EuiToolTip content={compareHint}>
                <EuiButton
                  size="s"
                  fill
                  iconType="merge"
                  isDisabled={!canCompare}
                  onClick={() => {
                    // Oldest first: the oldest run is the baseline (A).
                    const ordered = [...selection].sort((x, y) => x.started - y.started);
                    onCompareChange(ordered.map((r) => r.runId));
                  }}
                  data-test-subj="agtEvlCompareButton"
                >
                  {selection.length === 2 && canCompare
                    ? i18n.translate('agentTraces.evalsPage.compareTwo', {
                        defaultMessage: 'Compare 2 runs →',
                      })
                    : i18n.translate('agentTraces.evalsPage.compare', {
                        defaultMessage: 'Compare ({count})',
                        values: { count: selection.length },
                      })}
                </EuiButton>
              </EuiToolTip>
            }
          />
          <EuiSpacer size="s" />
          <EuiInMemoryTable<RunSummary>
            compressed
            className="agtEvlDenseTable"
            items={shownRuns}
            itemId="runId"
            columns={columns.filter((c) => !('field' in c && c.field === 'suiteName'))}
            isSelectable
            selection={{ onSelectionChange: setSelection }}
            pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
            sorting={{ sort: { field: 'started', direction: 'desc' } }}
            data-test-subj="agtEvlRunsTable"
          />
        </>
      )}
    </div>
  );
};
