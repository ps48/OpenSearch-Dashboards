/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiNotificationBadge,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { RunRow, suiteRuns } from './eval_model';
import { buildSuiteRunsQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { PassRateChart } from './pass_rate_chart';
import {
  DASH,
  MetaItem,
  PassRateCell,
  QueryErrorCallout,
  VersionBadge,
  agentLabel,
  formatTime,
  shortId,
} from './eval_components';

/** The CI run's number (last path part of `cicd.pipeline.run.url.full`). */
export const ciLabel = (url: string) => `#${url.replace(/\/+$/, '').split('/').pop()}`;

export const CiLink: React.FC<{ url?: string }> = ({ url }) =>
  url ? (
    <EuiLink
      href={url}
      target="_blank"
      external
      title="cicd.pipeline.run.url.full"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      {ciLabel(url)}
    </EuiLink>
  ) : (
    <span className="agtEvlDim">{DASH}</span>
  );

/** Where the agent version changes from one run to the next. */
export const runVersionMarkers = (runs: RunRow[]) =>
  runs
    .filter((r, i) => i > 0 && r.version !== runs[i - 1].version)
    .map((r) => ({ t: r.started, label: r.version ?? DASH }));

/** Two runs in time order: the older is A, the baseline. */
export const compareOrder = (runs: RunRow[]): [string, string] => {
  const [x, y] = [...runs].sort((p, q) => p.started - q.started);
  return [x.runId, y.runId];
};

/** A suite: pass rate by run, its runs; select two to compare. */
export const SuitePage: React.FC<{ suite: string }> = ({ suite }) => {
  const { dataset, index, timeRange, refreshKey, navigate } = useEvalContext();
  const { rows, loading, loaded, error } = usePplRows(
    dataset,
    buildSuiteRunsQuery(index, suite),
    timeRange,
    refreshKey
  );
  const runs = useMemo(() => suiteRuns(rows), [rows]);
  const [selected, setSelected] = useState<RunRow[]>([]);
  const agent = runs.map((r) => r.agent).find(Boolean);
  const canCompare = selected.length === 2;

  const columns: Array<EuiBasicTableColumn<RunRow>> = [
    {
      field: 'runId',
      name: i18n.translate('agentTraces.evals.suite.run', { defaultMessage: 'Run' }),
      render: (id: string) => (
        <EuiLink className="agtEvlMono" title={id}>
          {shortId(id)}
        </EuiLink>
      ),
    },
    {
      field: 'started',
      name: i18n.translate('agentTraces.evals.suite.started', { defaultMessage: 'Started' }),
      sortable: true,
      render: (t: number) => <span className="agtEvlDim">{formatTime(t)}</span>,
    },
    {
      field: 'version',
      name: i18n.translate('agentTraces.evals.suite.agentVersion', {
        defaultMessage: 'Agent version',
      }),
      sortable: true,
      render: (v?: string) => <VersionBadge version={v} />,
    },
    {
      field: 'tally',
      name: i18n.translate('agentTraces.evals.suite.results', { defaultMessage: 'Results' }),
      align: 'right',
      sortable: (r: RunRow) => r.tally.n,
      render: (_: unknown, r: RunRow) => r.tally.n.toLocaleString(),
    },
    {
      field: 'rate',
      name: i18n.translate('agentTraces.evals.suite.passRate', { defaultMessage: 'Pass rate' }),
      align: 'right',
      sortable: (r: RunRow) => r.rate ?? -1,
      render: (rate?: number) => <PassRateCell rate={rate} />,
    },
    {
      field: 'errors',
      name: i18n.translate('agentTraces.evals.suite.errors', {
        defaultMessage: 'Evaluator errors',
      }),
      align: 'right',
      sortable: (r: RunRow) => r.tally.error,
      render: (_: unknown, r: RunRow) =>
        r.tally.error ? (
          <EuiBadge color="warning">{r.tally.error}</EuiBadge>
        ) : (
          <span className="agtEvlDim">0</span>
        ),
    },
    {
      field: 'ciUrl',
      name: i18n.translate('agentTraces.evals.suite.ci', { defaultMessage: 'CI run' }),
      render: (url?: string) => <CiLink url={url} />,
    },
  ];

  const hint = canCompare
    ? ''
    : selected.length === 1
      ? i18n.translate('agentTraces.evals.suite.selectOneMore', {
          defaultMessage: 'Select one more run',
        })
      : i18n.translate('agentTraces.evals.suite.selectTwo', {
          defaultMessage: 'Select two runs to compare',
        });

  return (
    <>
      <div className="agtEvlMeta" data-test-subj="agtEvlSuiteMeta">
        <MetaItem
          label={i18n.translate('agentTraces.evals.suite.agent', { defaultMessage: 'Agent' })}
        >
          {agent ? (
            <EuiLink onClick={() => navigate({ page: 'agent', agent, tab: 'suites' })}>
              <strong>{agentLabel(agent)}</strong>
            </EuiLink>
          ) : (
            DASH
          )}
        </MetaItem>
        <MetaItem
          label={i18n.translate('agentTraces.evals.suite.runsInRange', {
            defaultMessage: 'Runs in the range',
          })}
        >
          <strong>{runs.length}</strong>
        </MetaItem>
      </div>
      {error && <QueryErrorCallout message={error} />}
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <EuiTitle size="xs">
          <h3>
            {i18n.translate('agentTraces.evals.suite.chartTitle', {
              defaultMessage: 'Pass rate by run',
            })}
          </h3>
        </EuiTitle>
        <EuiText size="xs" color="subdued">
          <p>
            {i18n.translate('agentTraces.evals.suite.chartSub', {
              defaultMessage:
                'One point per run. A dashed line marks the first run of an agent version.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        {runs.some((r) => r.rate !== undefined) ? (
          <PassRateChart
            id="suiteRuns"
            height={180}
            showPoints
            points={runs
              .filter((r) => r.rate !== undefined)
              .map((r) => ({ t: r.started, rate: r.rate ?? 0, label: r.version }))}
            markers={runVersionMarkers(runs)}
          />
        ) : (
          <EuiText size="s" color="subdued">
            <p>
              {i18n.translate('agentTraces.evals.suite.chartEmpty', {
                defaultMessage: 'No runs with a pass rule in the range.',
              })}
            </p>
          </EuiText>
        )}
      </EuiPanel>
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem>
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('agentTraces.evals.suite.runsTitle', { defaultMessage: 'Runs' })}{' '}
                <EuiNotificationBadge color="subdued">{runs.length}</EuiNotificationBadge>
              </h3>
            </EuiTitle>
            <EuiText size="xs" color="subdued">
              <p>
                {i18n.translate('agentTraces.evals.suite.runsSub', {
                  defaultMessage: 'Click a run to see its cases.',
                })}
              </p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {hint}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              size="s"
              fill={canCompare}
              isDisabled={!canCompare}
              onClick={() => {
                const [runA, runB] = compareOrder(selected);
                navigate({ page: 'compare', runA, runB });
              }}
              data-test-subj="agtEvlCompareButton"
            >
              {i18n.translate('agentTraces.evals.suite.compare', {
                defaultMessage: 'Compare {n}/2',
                values: { n: selected.length },
              })}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiInMemoryTable<RunRow>
          items={runs}
          itemId="runId"
          columns={columns}
          loading={loading}
          isSelectable
          selection={{
            onSelectionChange: (items: RunRow[]) => setSelected(items.slice(-2)),
            selectable: (r: RunRow) =>
              selected.length < 2 || selected.some((s) => s.runId === r.runId),
            selectableMessage: (ok: boolean) =>
              ok
                ? ''
                : i18n.translate('agentTraces.evals.suite.maxTwo', {
                    defaultMessage: 'Two runs are selected',
                  }),
          }}
          sorting={{ sort: { field: 'started', direction: 'desc' } }}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          rowProps={(r: RunRow) => ({
            className: 'agtEvlClickRow',
            onClick: (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest('input,a,button')) return;
              navigate({ page: 'run', runId: r.runId });
            },
            'data-test-subj': `agtEvlRunRow-${r.runId}`,
          })}
          message={
            loaded && !loading
              ? i18n.translate('agentTraces.evals.suite.empty', {
                  defaultMessage: 'No runs of this suite in the range.',
                })
              : undefined
          }
          data-test-subj="agtEvlRunsTable"
        />
      </EuiPanel>
    </>
  );
};
