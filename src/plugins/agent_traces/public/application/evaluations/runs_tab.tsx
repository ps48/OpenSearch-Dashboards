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
import { RunSummary, compareValues, isRegression } from './eval_aggregations';
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
  const evaluatorNames = useMemo(
    () => Array.from(new Set(runs.flatMap((r) => Object.keys(r.evaluators)))).sort(),
    [runs]
  );

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
  const byId = new Map(runs.map((r) => [r.runId, r]));

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
          {isRegression(run) && (
            <EuiFlexItem grow={false}>
              <EuiToolTip
                content={i18n.translate('agentTraces.evalsPage.regressionTip', {
                  defaultMessage: 'Worse than the previous run of this suite ({previous}): {what}',
                  values: {
                    previous: shortId(run.previousRunId, 24),
                    what: [
                      ...run.regressedEvaluators,
                      ...(run.passRateDropped ? ['fewer test cases passed'] : []),
                    ].join(', '),
                  },
                })}
              >
                <EuiBadge color="danger" iconType="sortDown" data-test-subj="agtEvlRegression">
                  {i18n.translate('agentTraces.evalsPage.regression', {
                    defaultMessage: 'Regression',
                  })}
                </EuiBadge>
              </EuiToolTip>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      ),
    },
    {
      field: 'suiteName',
      name: i18n.translate('agentTraces.evalsPage.colSuite', { defaultMessage: 'Suite' }),
      sortable: true,
      render: (suite?: string) => suite ?? '-',
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
    ...evaluatorNames.map((name): EuiBasicTableColumn<RunSummary> => ({
      name: (
        <EuiToolTip
          content={i18n.translate('agentTraces.evalsPage.colEvaluatorMeanTip', {
            defaultMessage: '{name}: mean score, or pass rate for labels',
            values: { name },
          })}
        >
          <span>{name}</span>
        </EuiToolTip>
      ),
      render: (run: RunSummary) => {
        const previous = run.previousRunId ? byId.get(run.previousRunId) : undefined;
        const now = run.evaluators[name];
        const before = previous?.evaluators[name];
        return (
          <EuiFlexGroup gutterSize="xs" alignItems="baseline" responsive={false} wrap={false}>
            <EuiFlexItem grow={false}>
              <EuiText size="xs" className="agtEvlNum">
                {formatAggregate(now)}
              </EuiText>
            </EuiFlexItem>
            {now && before && (
              <EuiFlexItem grow={false}>
                <EuiToolTip
                  content={i18n.translate('agentTraces.evalsPage.vsPreviousRun', {
                    defaultMessage: 'Against the previous run of the suite ({previous}): {before}',
                    values: { previous: previous?.runId, before: formatAggregate(before) },
                  })}
                >
                  <ChangeDelta
                    text={formatAggregateDelta(before, now)}
                    change={compareValues(before, now).change}
                    data-test-subj="agtEvlRunsDelta"
                  />
                </EuiToolTip>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        );
      },
    })),
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
        title={i18n.translate('agentTraces.evalsPage.runsTitle', {
          defaultMessage: 'Evaluation runs',
        })}
        count={runs.length}
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
              {i18n.translate('agentTraces.evalsPage.compare', {
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
        items={runs}
        itemId="runId"
        columns={columns}
        isSelectable
        selection={{ onSelectionChange: setSelection }}
        pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
        sorting={{ sort: { field: 'started', direction: 'desc' } }}
        data-test-subj="agtEvlRunsTable"
      />
    </div>
  );
};
