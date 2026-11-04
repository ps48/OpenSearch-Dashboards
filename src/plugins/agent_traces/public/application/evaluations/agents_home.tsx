/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiCompressedFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiIconTip,
  EuiInMemoryTable,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { AgentVersionRow, MIN_N, agentVersionRows } from './eval_model';
import { NO_AGENT, buildAgentsQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import {
  LiveDot,
  NO_AGENT_LABEL,
  PassRateCell,
  QueryErrorCallout,
  SourceFilter,
  formatTime,
  versionLabel,
} from './eval_components';
import { AgentsEmptyState } from './eval_empty_states';

const RATE_TIP = i18n.translate('agentTraces.evals.agents.rateTip', {
  defaultMessage:
    "Mean of the version's evaluation pass rates. Faded: fewer than {min} results with a pass rule.",
  values: { min: MIN_N },
});

/** A version's pass rate, faded under the minimum sample size; the tooltip gives n. */
export const VersionRateCell: React.FC<{ row: AgentVersionRow }> = ({ row }) => (
  <EuiToolTip
    content={i18n.translate('agentTraces.evals.agents.nTip', {
      defaultMessage: 'n = {n} results with a pass rule',
      values: { n: row.decided.toLocaleString() },
    })}
  >
    <span
      className={row.decided < MIN_N ? 'agtEvlLowN' : undefined}
      data-test-subj={`agtEvlVersionRate-${row.id}`}
    >
      <PassRateCell rate={row.rate} />
    </span>
  </EuiToolTip>
);

/** Debounced value: search is pushed into the query, so it waits for a pause in typing. */
export const useDebounced = <T,>(value: T, ms = 300): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
};

const sortAgent = (r: AgentVersionRow) => (r.agent === NO_AGENT ? '~' : r.agent);

/** Agents (the Evaluations home): one row per agent version, from one aggregation. */
export const AgentsHome: React.FC = () => {
  const { dataset, index, timeRange, rangeLabel, refreshKey, state, setState, navigate } =
    useEvalContext();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = buildAgentsQuery(index, state.agentsSource, q);
  const { rows, loading, error, loaded } = usePplRows(dataset, query, timeRange, refreshKey);
  const items = useMemo(() => agentVersionRows(rows), [rows]);

  const open = (r: AgentVersionRow) =>
    navigate(
      { page: 'agent', agent: r.agent, tab: 'evaluations' },
      // Open the agent with this version as the one compared.
      { versionPick: { ...state.versionPick, [r.agent]: { b: r.version ?? '' } } }
    );

  const columns: Array<EuiBasicTableColumn<AgentVersionRow>> = [
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
      field: 'version',
      name: i18n.translate('agentTraces.evals.agents.version', { defaultMessage: 'Version' }),
      sortable: (r: AgentVersionRow) => r.version ?? '',
      render: (_: unknown, r: AgentVersionRow) => (
        <span className="agtEvlNoWrap">
          <EuiBadge color="hollow">
            {r.live && <LiveDot />}
            {versionLabel(r.version)}
          </EuiBadge>
        </span>
      ),
    },
    {
      field: 'rate',
      name: (
        <EuiToolTip content={RATE_TIP}>
          <span>
            {i18n.translate('agentTraces.evals.agents.passRate', {
              defaultMessage: 'Pass rate',
            })}{' '}
            <EuiIcon type="questionInCircle" size="s" color="subdued" />
          </span>
        </EuiToolTip>
      ),
      sortable: (r: AgentVersionRow) => r.rate ?? -1,
      render: (_: unknown, r: AgentVersionRow) => <VersionRateCell row={r} />,
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
    <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
      <EuiTitle size="s">
        <h3>
          {i18n.translate('agentTraces.evals.agents.title', { defaultMessage: 'Agents' })}
          <span className="agtEvlDim"> ({items.length})</span>
        </h3>
      </EuiTitle>
      <EuiSpacer size="xs" />
      <EuiText size="s" color="subdued">
        <p>
          {i18n.translate('agentTraces.evals.agents.description', {
            defaultMessage:
              'One row per agent version with evaluation results in the time range. A dot marks a version with results in the last 6 hours. Click a row to see its evaluations and compare it with another version.',
          })}
        </p>
      </EuiText>
      <EuiSpacer size="m" />
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem>
          <EuiCompressedFieldSearch
            fullWidth
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
        <EuiInMemoryTable<AgentVersionRow>
          items={items}
          itemId="id"
          columns={columns}
          loading={loading}
          tableLayout="auto"
          sorting={{ sort: { field: 'last', direction: 'desc' } }}
          allowNeutralSort={false}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          rowProps={(r: AgentVersionRow) => ({
            className: 'agtEvlClickRow',
            onClick: () => open(r),
            'data-test-subj': `agtEvlAgentRow-${r.id}`,
          })}
          message={loaded && !loading ? <AgentsEmptyState range={rangeLabel} /> : undefined}
          data-test-subj="agtEvlAgentsTable"
        />
      )}
    </EuiPanel>
  );
};
