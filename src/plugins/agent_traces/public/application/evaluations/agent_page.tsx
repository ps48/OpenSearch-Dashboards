/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingChart,
  EuiNotificationBadge,
  EuiPanel,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  AgentEvaluations,
  EvaluationRow,
  SuiteRow,
  agentEvaluations,
  agentSuites,
  trendPoints,
  versionMarkers,
} from './eval_model';
import {
  buildAgentEvaluationsQuery,
  buildAgentSuitesQuery,
  buildAgentTrendQuery,
  trendStep,
} from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { AgentTab } from './eval_routes';
import { ResultsView } from './results_view';
import { PassRateChart } from './pass_rate_chart';
import {
  DASH,
  DeltaCell,
  MetaItem,
  PassRateCell,
  QueryErrorCallout,
  SourceFilter,
  VersionBadge,
  formatDay,
  formatTime,
  pct,
} from './eval_components';

const TAB_LABEL: Record<AgentTab, string> = {
  evaluations: i18n.translate('agentTraces.evals.agent.tabEvaluations', {
    defaultMessage: 'Evaluations',
  }),
  suites: i18n.translate('agentTraces.evals.agent.tabSuites', { defaultMessage: 'Suites' }),
  results: i18n.translate('agentTraces.evals.agent.tabResults', { defaultMessage: 'Results' }),
};

const AgentMeta: React.FC<{ data: AgentEvaluations }> = ({ data: { summary } }) =>
  summary ? (
    <div className="agtEvlMeta" data-test-subj="agtEvlAgentMeta">
      <MetaItem
        label={i18n.translate('agentTraces.evals.agent.latestVersion', {
          defaultMessage: 'Latest version',
        })}
      >
        <VersionBadge version={summary.latest.version} />{' '}
        {i18n.translate('agentTraces.evals.agent.since', {
          defaultMessage: 'since {day}',
          values: { day: formatDay(summary.latest.first) },
        })}
      </MetaItem>
      {summary.previous && (
        <MetaItem
          label={i18n.translate('agentTraces.evals.agent.previous', { defaultMessage: 'Previous' })}
        >
          <VersionBadge version={summary.previous.version} />
        </MetaItem>
      )}
      <MetaItem
        label={i18n.translate('agentTraces.evals.agent.results', { defaultMessage: 'Results' })}
      >
        <strong>{summary.n.toLocaleString()}</strong>
      </MetaItem>
      <MetaItem
        label={i18n.translate('agentTraces.evals.agent.lastResult', {
          defaultMessage: 'Last result',
        })}
      >
        {formatTime(summary.last)}
      </MetaItem>
    </div>
  ) : null;

const SectionTitle: React.FC<{ title: string; count?: number; sub?: string }> = ({
  title,
  count,
  sub,
}) => (
  <>
    <EuiTitle size="xs">
      <h3>
        {title}{' '}
        {count !== undefined && (
          <EuiNotificationBadge color="subdued">{count}</EuiNotificationBadge>
        )}
      </h3>
    </EuiTitle>
    {sub && (
      <EuiText size="xs" color="subdued">
        <p>{sub}</p>
      </EuiText>
    )}
    <EuiSpacer size="s" />
  </>
);

const EvaluationsTab: React.FC<{ agent: string }> = ({ agent }) => {
  const { dataset, index, timeRange, refreshKey, rangeMs, state, setState, navigate } =
    useEvalContext();
  const source = state.agentSource;
  const table = usePplRows(
    dataset,
    buildAgentEvaluationsQuery(index, agent, source),
    timeRange,
    refreshKey
  );
  const { step } = trendStep(rangeMs);
  const trend = usePplRows(
    dataset,
    buildAgentTrendQuery(index, agent, source, step),
    timeRange,
    refreshKey
  );
  const data = useMemo(() => agentEvaluations(agent, table.rows), [agent, table.rows]);
  const points = useMemo(() => trendPoints(trend.rows), [trend.rows]);
  const latest = data.summary?.latest.version;
  const previous = data.summary?.previous;

  const columns: Array<EuiBasicTableColumn<EvaluationRow>> = [
    {
      field: 'name',
      name: i18n.translate('agentTraces.evals.agent.evaluation', { defaultMessage: 'Evaluation' }),
      sortable: true,
      render: (name: string, r: EvaluationRow) => (
        <span>
          <EuiLink>
            <strong>{name}</strong>
          </EuiLink>
          {!r.hasPassRule && (
            <>
              {' '}
              <EuiToolTip
                content={i18n.translate('agentTraces.evals.agent.noPassRuleTip', {
                  defaultMessage: 'The producer sets no pass rule: results only carry a score.',
                })}
              >
                <EuiBadge color="hollow" data-test-subj="agtEvlNoPassRule">
                  {i18n.translate('agentTraces.evals.agent.noPassRule', {
                    defaultMessage: 'No pass rule',
                  })}
                </EuiBadge>
              </EuiToolTip>
            </>
          )}
        </span>
      ),
    },
    {
      field: 'latestRate',
      name: i18n.translate('agentTraces.evals.agent.passRateVersion', {
        defaultMessage: 'Pass rate · {version}',
        values: { version: latest ?? DASH },
      }),
      align: 'right',
      sortable: (r: EvaluationRow) => r.latestRate ?? -1,
      render: (rate?: number) => <PassRateCell rate={rate} />,
    },
    ...(previous
      ? ([
          {
            field: 'previousRate',
            name: i18n.translate('agentTraces.evals.agent.passRateVersion', {
              defaultMessage: 'Pass rate · {version}',
              values: { version: previous.version ?? DASH },
            }),
            align: 'right',
            sortable: (r: EvaluationRow) => r.previousRate ?? -1,
            render: (rate?: number) => <span>{pct(rate)}</span>,
          },
          {
            field: 'delta',
            name: i18n.translate('agentTraces.evals.agent.change', { defaultMessage: 'Change' }),
            align: 'right',
            sortable: (r: EvaluationRow) => r.delta ?? Number.POSITIVE_INFINITY,
            render: (delta?: number) => <DeltaCell delta={delta} />,
          },
        ] as Array<EuiBasicTableColumn<EvaluationRow>>)
      : []),
    {
      field: 'n',
      name: i18n.translate('agentTraces.evals.agent.resultsCol', { defaultMessage: 'Results' }),
      align: 'right',
      sortable: true,
      render: (n: number) => n.toLocaleString(),
    },
  ];

  const sourceWord =
    source === 'online'
      ? i18n.translate('agentTraces.evals.agent.online', { defaultMessage: 'Online' })
      : source === 'offline'
        ? i18n.translate('agentTraces.evals.agent.offline', { defaultMessage: 'Offline' })
        : i18n.translate('agentTraces.evals.agent.all', { defaultMessage: 'All' });

  return (
    <>
      <AgentMeta data={data} />
      <SourceFilter value={source} onChange={(agentSource) => setState({ agentSource })} />
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <SectionTitle
          title={i18n.translate('agentTraces.evals.agent.trendTitle', {
            defaultMessage: 'Pass rate over time',
          })}
          sub={i18n.translate('agentTraces.evals.agent.trendSub', {
            defaultMessage:
              '{source} results of every evaluation, per {step}. A dashed line marks the first result of a version.',
            values: { source: sourceWord, step },
          })}
        />
        {trend.error ? (
          <QueryErrorCallout message={trend.error} />
        ) : trend.loading && !points.length ? (
          <EuiLoadingChart size="l" />
        ) : points.length ? (
          <PassRateChart
            id="agentTrend"
            points={points}
            markers={versionMarkers(data.summary?.versions ?? [])}
          />
        ) : (
          <EuiText size="s" color="subdued">
            <p>
              {i18n.translate('agentTraces.evals.agent.trendEmpty', {
                defaultMessage: 'No results with a pass rule in the range.',
              })}
            </p>
          </EuiText>
        )}
      </EuiPanel>
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <SectionTitle
          title={TAB_LABEL.evaluations}
          count={data.rows.length}
          sub={i18n.translate('agentTraces.evals.agent.evalsSub', {
            defaultMessage:
              'Latest version against the one before it. Click an evaluation to see its results.',
          })}
        />
        {table.error ? (
          <QueryErrorCallout message={table.error} />
        ) : (
          <EuiInMemoryTable<EvaluationRow>
            items={data.rows}
            itemId="name"
            columns={columns}
            loading={table.loading}
            sorting={{
              sort: previous
                ? { field: 'delta', direction: 'asc' }
                : { field: 'name', direction: 'asc' },
            }}
            pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
            rowProps={(r: EvaluationRow) => ({
              className: 'agtEvlClickRow',
              onClick: () =>
                navigate(
                  { page: 'agent', agent, tab: 'results' },
                  { results: { ...state.results, names: [r.name] } }
                ),
              'data-test-subj': `agtEvlEvalRow-${r.name}`,
            })}
            message={
              table.loaded && !table.loading
                ? i18n.translate('agentTraces.evals.agent.evalsEmpty', {
                    defaultMessage: 'No results for this agent in the range.',
                  })
                : undefined
            }
            data-test-subj="agtEvlEvaluationsTable"
          />
        )}
      </EuiPanel>
    </>
  );
};

const SuitesTab: React.FC<{ agent: string; onCount: (n: number) => void }> = ({
  agent,
  onCount,
}) => {
  const { dataset, index, timeRange, refreshKey, navigate } = useEvalContext();
  const { rows, loading, loaded, error } = usePplRows(
    dataset,
    buildAgentSuitesQuery(index, agent),
    timeRange,
    refreshKey
  );
  const suites = useMemo(() => agentSuites(rows), [rows]);
  React.useEffect(() => {
    if (loaded) onCount(suites.length);
  }, [loaded, suites.length, onCount]);

  const columns: Array<EuiBasicTableColumn<SuiteRow>> = [
    {
      field: 'suite',
      name: i18n.translate('agentTraces.evals.suites.suite', { defaultMessage: 'Suite' }),
      sortable: true,
      render: (s: string) => (
        <EuiLink>
          <strong>{s}</strong>
        </EuiLink>
      ),
    },
    {
      field: 'runs',
      name: i18n.translate('agentTraces.evals.suites.runs', { defaultMessage: 'Runs' }),
      align: 'right',
      sortable: true,
    },
    {
      field: 'last',
      name: i18n.translate('agentTraces.evals.suites.lastRun', { defaultMessage: 'Last run' }),
      sortable: (s: SuiteRow) => s.last.started,
      render: (_: unknown, s: SuiteRow) => (
        <span className="agtEvlDim">{formatTime(s.last.started)}</span>
      ),
    },
    {
      field: 'version',
      name: i18n.translate('agentTraces.evals.suites.agentVersion', {
        defaultMessage: 'Agent version',
      }),
      sortable: (s: SuiteRow) => s.last.version ?? '',
      render: (_: unknown, s: SuiteRow) => <VersionBadge version={s.last.version} />,
    },
    {
      field: 'rate',
      name: i18n.translate('agentTraces.evals.suites.lastRate', {
        defaultMessage: 'Pass rate · last run',
      }),
      align: 'right',
      sortable: (s: SuiteRow) => s.last.rate ?? -1,
      render: (_: unknown, s: SuiteRow) => <PassRateCell rate={s.last.rate} />,
    },
    {
      field: 'delta',
      name: i18n.translate('agentTraces.evals.suites.vsRunBefore', {
        defaultMessage: 'vs run before',
      }),
      align: 'right',
      sortable: (s: SuiteRow) => s.delta ?? Number.POSITIVE_INFINITY,
      render: (delta?: number) => <DeltaCell delta={delta} />,
    },
  ];

  return (
    <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
      <SectionTitle
        title={TAB_LABEL.suites}
        count={suites.length}
        sub={i18n.translate('agentTraces.evals.suites.sub', {
          defaultMessage:
            'Suites with a run in the range. Click a suite to see its runs and compare two of them.',
        })}
      />
      {error ? (
        <QueryErrorCallout message={error} />
      ) : (
        <EuiInMemoryTable<SuiteRow>
          items={suites}
          itemId="suite"
          columns={columns}
          loading={loading}
          sorting={{ sort: { field: 'last', direction: 'desc' } }}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          rowProps={(s: SuiteRow) => ({
            className: 'agtEvlClickRow',
            onClick: () => navigate({ page: 'suite', suite: s.suite }),
            'data-test-subj': `agtEvlSuiteRow-${s.suite}`,
          })}
          message={
            loaded && !loading
              ? i18n.translate('agentTraces.evals.suites.empty', {
                  defaultMessage: 'No suite runs in the range.',
                })
              : undefined
          }
          data-test-subj="agtEvlSuitesTable"
        />
      )}
    </EuiPanel>
  );
};

/** One agent: Evaluations, Suites and Results tabs; each tab queries only while shown. */
export const AgentPage: React.FC<{ agent: string; tab: AgentTab }> = ({ agent, tab }) => {
  const { navigate } = useEvalContext();
  const [suiteCount, setSuiteCount] = React.useState<number>();
  return (
    <>
      <EuiTabs size="s">
        {(['evaluations', 'suites', 'results'] as AgentTab[]).map((t) => (
          <EuiTab
            key={t}
            isSelected={tab === t}
            onClick={() => navigate({ page: 'agent', agent, tab: t })}
            data-test-subj={`agtEvlAgentTab-${t}`}
          >
            {TAB_LABEL[t]}
            {t === 'suites' && suiteCount !== undefined && (
              <>
                {' '}
                <EuiNotificationBadge color="subdued">{suiteCount}</EuiNotificationBadge>
              </>
            )}
          </EuiTab>
        ))}
      </EuiTabs>
      <EuiSpacer size="m" />
      {tab === 'evaluations' && <EvaluationsTab agent={agent} />}
      {tab === 'suites' && <SuitesTab agent={agent} onCount={setSuiteCount} />}
      {tab === 'results' && <ResultsView lockAgent={agent} />}
    </>
  );
};
