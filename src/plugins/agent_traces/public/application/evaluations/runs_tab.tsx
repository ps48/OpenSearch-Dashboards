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
  EuiEmptyPrompt,
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
import { EMPTY_RUN_EVENTS, EvalResult, RunEvents } from './eval_data';
import { RunSummary, isRegression, summarizeRuns } from './eval_aggregations';
import {
  CASE_STATUS_COLOR,
  SectionHeader,
  formatAggregate,
  formatDuration,
  formatEvalTime,
  shortId,
} from './eval_components';
import { CompareRuns } from './compare_runs';
import { MAX_COMPARE_RUNS } from './eval_url_state';
import type { RunsDetailState } from './use_eval_data';

export const NoRunsPrompt: React.FC = () => (
  <EuiEmptyPrompt
    iconType="beaker"
    data-test-subj="agtEvlNoRuns"
    title={
      <h3>
        <FormattedMessage
          id="agentTraces.evalsPage.noRunsTitle"
          defaultMessage="No evaluation runs in this time range"
        />
      </h3>
    }
    body={
      <EuiText size="s">
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
      </EuiText>
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

export const RunsTab: React.FC<{
  /** Grades of the runs. */
  results: EvalResult[];
  /** Test case and run events of the runs; empty for runs from older producers. */
  events?: RunEvents;
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
}> = ({
  results,
  events = EMPTY_RUN_EVENTS,
  compare,
  baseline,
  compareData,
  onCompareChange,
  onOpenTrace,
  onOpenRun,
  backLabel,
}) => {
  const runs = useMemo(() => summarizeRuns(results, events), [results, events]);
  const [selection, setSelection] = useState<RunSummary[]>([]);
  const evaluatorNames = useMemo(
    () => Array.from(new Set(runs.flatMap((r) => Object.keys(r.evaluators)))).sort(),
    [runs]
  );

  if (compare) {
    const baselineId = baseline && compare.includes(baseline) ? baseline : compare[0];
    // Without data read by id (tests, older callers), the runs in range are compared.
    const data = compareData ?? { results, events, loading: false, missing: [] };
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

  if (runs.length === 0) return <NoRunsPrompt />;

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
          {run.casesErrored > 0 && (
            <EuiFlexItem grow={false}>
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
            </EuiFlexItem>
          )}
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
      render: (run: RunSummary) => (
        <EuiText size="xs">{formatAggregate(run.evaluators[name])}</EuiText>
      ),
    })),
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
