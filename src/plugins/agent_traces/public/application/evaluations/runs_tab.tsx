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
  EuiHealth,
  EuiInMemoryTable,
  EuiSpacer,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { EvalResult } from './eval_data';
import { RunSummary, isRegression, summarizeRuns } from './eval_aggregations';
import { formatAggregate, formatEvalTime, shortId } from './eval_components';
import { CompareRuns } from './compare_runs';

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
      <EuiText size="s" textAlign="left">
        <p>
          <FormattedMessage
            id="agentTraces.evalsPage.noRunsBody"
            defaultMessage="Evaluation runs are offline experiments: a test suite run against your agent, with each test case scored. Results are grouped into runs by {runId}."
            values={{ runId: <EuiCode>test.suite.run.id</EuiCode> }}
          />
        </p>
        <p>
          <FormattedMessage
            id="agentTraces.evalsPage.noRunsHow"
            defaultMessage="The OpenSearch GenAI SDK benchmark helpers emit {suiteSpan} and {caseSpan} spans and evaluation events that carry {runId}, {caseId} and {suite}. Any producer that sets these attributes on its gen_ai.evaluation.result events shows up here."
            values={{
              suiteSpan: <EuiCode>test_suite_run</EuiCode>,
              caseSpan: <EuiCode>test_case</EuiCode>,
              runId: <EuiCode>test.suite.run.id</EuiCode>,
              caseId: <EuiCode>test.case.id</EuiCode>,
              suite: <EuiCode>test.suite.name</EuiCode>,
            }}
          />
        </p>
      </EuiText>
    }
  />
);

export const RunsTab: React.FC<{
  results: EvalResult[];
  compare?: [string, string];
  onCompareChange: (compare?: [string, string]) => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}> = ({ results, compare, onCompareChange, onOpenTrace }) => {
  const runs = useMemo(() => summarizeRuns(results), [results]);
  const [selection, setSelection] = useState<RunSummary[]>([]);
  const evaluatorNames = useMemo(
    () => Array.from(new Set(runs.flatMap((r) => Object.keys(r.evaluators)))).sort(),
    [runs]
  );

  if (compare) {
    const [baselineId, candidateId] = compare;
    const byId = new Map(runs.map((r) => [r.runId, r]));
    return (
      <CompareRuns
        results={results}
        baseline={byId.get(baselineId)}
        candidate={byId.get(candidateId)}
        baselineId={baselineId}
        candidateId={candidateId}
        onBack={() => onCompareChange(undefined)}
        onSwap={() => onCompareChange([candidateId, baselineId])}
        onOpenTrace={onOpenTrace}
      />
    );
  }

  if (runs.length === 0) return <NoRunsPrompt />;

  const sameSuite =
    selection.length === 2 && (selection[0].suiteName ?? '') === (selection[1].suiteName ?? '');
  const canCompare = selection.length === 2 && sameSuite;
  const compareHint =
    selection.length !== 2
      ? i18n.translate('agentTraces.evalsPage.compareHintCount', {
          defaultMessage: 'Select two runs of the same suite.',
        })
      : !sameSuite
        ? i18n.translate('agentTraces.evalsPage.compareHintSuite', {
            defaultMessage: 'The two runs must belong to the same suite.',
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
              <EuiText size="xs" className="agtEvlMono">
                {shortId(runId, 24)}
              </EuiText>
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
      field: 'cases',
      name: i18n.translate('agentTraces.evalsPage.colCases', { defaultMessage: 'Test cases' }),
      sortable: true,
      width: '90px',
    },
    {
      field: 'casesPassed',
      name: i18n.translate('agentTraces.evalsPage.colPassFail', {
        defaultMessage: 'Passed / failed',
      }),
      sortable: true,
      render: (_passed: number, run: RunSummary) => (
        <EuiFlexGroup gutterSize="s" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiHealth color="success">{run.casesPassed}</EuiHealth>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiHealth color={run.casesFailed > 0 ? 'danger' : 'subdued'}>
              {run.casesFailed}
            </EuiHealth>
          </EuiFlexItem>
        </EuiFlexGroup>
      ),
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
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiText size="s" color="subdued">
            <FormattedMessage
              id="agentTraces.evalsPage.runsCount"
              defaultMessage="{count, plural, one {# run} other {# runs}}. Select two runs of a suite to compare them."
              values={{ count: runs.length }}
            />
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiToolTip content={compareHint}>
            <EuiButton
              size="s"
              fill
              iconType="merge"
              isDisabled={!canCompare}
              onClick={() => {
                const [a, b] = [...selection].sort((x, y) => x.started - y.started);
                onCompareChange([a.runId, b.runId]);
              }}
              data-test-subj="agtEvlCompareButton"
            >
              {i18n.translate('agentTraces.evalsPage.compare', {
                defaultMessage: 'Compare ({count})',
                values: { count: selection.length },
              })}
            </EuiButton>
          </EuiToolTip>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiInMemoryTable<RunSummary>
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
