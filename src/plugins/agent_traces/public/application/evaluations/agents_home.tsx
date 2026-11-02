/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiBasicTableColumn,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIconTip,
  EuiInMemoryTable,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { AgentRow, agentRows } from './eval_model';
import { NO_AGENT, buildAgentsQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import {
  DeltaCell,
  NO_AGENT_LABEL,
  PassRateCell,
  PassRateTip,
  QueryErrorCallout,
  SourceFilter,
  VersionBadge,
  formatDay,
  formatTime,
} from './eval_components';

/** Debounced value: search is pushed into the query, so it waits for a pause in typing. */
export const useDebounced = <T,>(value: T, ms = 300): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
};

const sortAgent = (r: AgentRow) => (r.agent === NO_AGENT ? '~' : r.agent);

/** Agents (the Evaluations home): one aggregation, sorted and paged in the browser. */
export const AgentsHome: React.FC = () => {
  const { dataset, index, timeRange, refreshKey, state, setState, navigate } = useEvalContext();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = buildAgentsQuery(index, state.agentsSource, q);
  const { rows, loading, error, loaded } = usePplRows(dataset, query, timeRange, refreshKey);
  const agents = useMemo(() => agentRows(rows), [rows]);

  const columns: Array<EuiBasicTableColumn<AgentRow>> = [
    {
      field: 'agent',
      name: i18n.translate('agentTraces.evals.agents.agent', { defaultMessage: 'Agent' }),
      sortable: sortAgent,
      render: (agent: string) =>
        agent === NO_AGENT ? (
          <span className="agtEvlDim">
            <EuiLink color="subdued">{NO_AGENT_LABEL}</EuiLink>{' '}
            <EuiIconTip
              type="questionInCircle"
              size="s"
              content={i18n.translate('agentTraces.evals.agents.noAgentTip', {
                defaultMessage:
                  'These results have no gen_ai.agent.name. Set it on the result (the SDK does this for you) to group them under an agent.',
              })}
            />
          </span>
        ) : (
          <EuiLink>
            <strong>{agent}</strong>
          </EuiLink>
        ),
    },
    {
      field: 'latest',
      name: i18n.translate('agentTraces.evals.agents.latestVersion', {
        defaultMessage: 'Latest version',
      }),
      sortable: (r: AgentRow) => r.latest.first,
      render: (_: unknown, r: AgentRow) =>
        r.latest.version ? (
          <span>
            <VersionBadge version={r.latest.version} />{' '}
            <span className="agtEvlDim agtEvlSmall">
              {i18n.translate('agentTraces.evals.agents.since', {
                defaultMessage: 'since {day}',
                values: { day: formatDay(r.latest.first) },
              })}
            </span>
          </span>
        ) : (
          <VersionBadge />
        ),
    },
    {
      field: 'rate',
      name: (
        <span>
          {i18n.translate('agentTraces.evals.agents.passRate', {
            defaultMessage: 'Pass rate (latest version)',
          })}{' '}
          <PassRateTip />
        </span>
      ),
      align: 'right',
      sortable: (r: AgentRow) => r.rate ?? -1,
      render: (rate?: number) => <PassRateCell rate={rate} />,
    },
    {
      field: 'delta',
      name: i18n.translate('agentTraces.evals.agents.vsPrevious', {
        defaultMessage: 'vs previous version',
      }),
      align: 'right',
      sortable: (r: AgentRow) => r.delta ?? Number.POSITIVE_INFINITY,
      render: (delta: number | undefined, r: AgentRow) => (
        <span>
          <DeltaCell delta={delta} />
          {r.previous?.version && (
            <span className="agtEvlDim agtEvlSmall">
              {' '}
              {i18n.translate('agentTraces.evals.agents.vsVersion', {
                defaultMessage: 'vs {version}',
                values: { version: r.previous.version },
              })}
            </span>
          )}
        </span>
      ),
    },
    {
      field: 'n',
      name: i18n.translate('agentTraces.evals.agents.results', { defaultMessage: 'Results' }),
      align: 'right',
      sortable: true,
      render: (n: number) => n.toLocaleString(),
    },
    {
      field: 'last',
      name: i18n.translate('agentTraces.evals.agents.lastResult', {
        defaultMessage: 'Last result',
      }),
      align: 'right',
      sortable: true,
      render: (last: number) => <span className="agtEvlDim">{formatTime(last)}</span>,
    },
  ];

  return (
    <>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem>
          <EuiFieldSearch
            fullWidth
            compressed
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={i18n.translate('agentTraces.evals.agents.search', {
              defaultMessage: 'Search agents',
            })}
            data-test-subj="agtEvlAgentsSearch"
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <SourceFilter
            value={state.agentsSource}
            onChange={(agentsSource) => setState({ agentsSource })}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      {error ? (
        <QueryErrorCallout message={error} />
      ) : (
        <EuiPanel paddingSize="s" hasShadow={false} hasBorder>
          <EuiInMemoryTable<AgentRow>
            items={agents}
            itemId="agent"
            columns={columns}
            loading={loading}
            sorting={{ sort: { field: 'last', direction: 'desc' } }}
            pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
            rowProps={(r: AgentRow) => ({
              className: 'agtEvlClickRow',
              onClick: () => navigate({ page: 'agent', agent: r.agent, tab: 'evaluations' }),
              'data-test-subj': `agtEvlAgentRow-${r.agent}`,
            })}
            message={
              loaded && !loading
                ? i18n.translate('agentTraces.evals.agents.empty', {
                    defaultMessage: 'No evaluation results in the range.',
                  })
                : undefined
            }
            data-test-subj="agtEvlAgentsTable"
          />
          <EuiText size="xs" color="subdued">
            <p>
              {i18n.translate('agentTraces.evals.agents.footnote', {
                defaultMessage:
                  'Pass rate counts results with a pass rule (pass or fail). Scored-only results and evaluator errors are not counted.',
              })}
            </p>
          </EuiText>
        </EuiPanel>
      )}
    </>
  );
};
