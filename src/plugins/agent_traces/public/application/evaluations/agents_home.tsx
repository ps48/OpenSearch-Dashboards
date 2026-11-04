/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiIconTip,
  EuiInMemoryTable,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { AgentRow, MIN_N, VersionStat, agentRows, isLive } from './eval_model';
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
  pct,
  versionLabel,
} from './eval_components';
import { AgentsEmptyState } from './eval_empty_states';

/** Badges shown per agent; the rest are counted. */
export const MAX_VERSION_BADGES = 4;

const VERSIONS_TIP = i18n.translate('agentTraces.evals.agents.versionsTip', {
  defaultMessage:
    "One badge per gen_ai.agent.version, most recent result first, up to 4. Pass rate = mean of the version's evaluation pass rates. A dot marks results in the last 6 hours; two dots mean the versions run at the same time. Faded: fewer than {min} results with a pass rule. Compare any two versions on the agent page.",
  values: { min: MIN_N },
});

const versionTip = (v: VersionStat) => {
  const low = v.decided < MIN_N;
  return [
    `${versionLabel(v.version)}: ${
      v.rate === undefined
        ? i18n.translate('agentTraces.evals.agents.noRule', {
            defaultMessage: 'no results with a pass rule',
          })
        : i18n.translate('agentTraces.evals.agents.rateTip', {
            defaultMessage: '{rate} pass rate',
            values: { rate: pct(v.rate) },
          })
    }`,
    i18n.translate('agentTraces.evals.agents.nTip', {
      defaultMessage: 'n = {n} results with a pass rule',
      values: { n: v.decided.toLocaleString() },
    }) +
      (low
        ? i18n.translate('agentTraces.evals.agents.lowTip', {
            defaultMessage: ' (fewer than {min}: treat with care)',
            values: { min: MIN_N },
          })
        : ''),
    i18n.translate('agentTraces.evals.agents.firstLastTip', {
      defaultMessage: 'first result in range {first}, last {last}',
      values: { first: formatTime(v.first), last: formatTime(v.last) },
    }),
  ].join(' · ');
};

/** One badge per version (most recent result first, up to 4, then "+N"). */
export const VersionRates: React.FC<{ row: AgentRow }> = ({ row }) => {
  if (row.versions.length === 1 && row.versions[0].version === undefined)
    return <PassRateCell rate={row.rate} />;
  const shown = row.versions.slice(0, MAX_VERSION_BADGES);
  const more = row.versions.length - shown.length;
  return (
    <span data-test-subj={`agtEvlVersionRates-${row.agent}`}>
      {shown.map((v) => (
        <EuiToolTip key={v.version ?? ''} content={versionTip(v)}>
          <EuiBadge
            color="hollow"
            className={`agtEvlVersionBadge${v.decided < MIN_N ? ' agtEvlVersionBadge--low' : ''}`}
            data-test-subj={`agtEvlVersionRate-${v.version ?? ''}`}
          >
            {isLive(v) && <LiveDot />}
            {versionLabel(v.version)} <strong>{pct(v.rate)}</strong>
          </EuiBadge>
        </EuiToolTip>
      ))}
      {more > 0 && <span className="agtEvlDim agtEvlSmall">+{more}</span>}
    </span>
  );
};

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
  const { dataset, index, timeRange, rangeLabel, refreshKey, state, setState, navigate } =
    useEvalContext();
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
      field: 'versions',
      name: (
        <EuiToolTip content={VERSIONS_TIP}>
          <span>
            {i18n.translate('agentTraces.evals.agents.passRateByVersion', {
              defaultMessage: 'Pass rate by version',
            })}{' '}
            <EuiIcon type="questionInCircle" size="s" color="subdued" />
          </span>
        </EuiToolTip>
      ),
      render: (_: unknown, r: AgentRow) => <VersionRates row={r} />,
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
            message={loaded && !loading ? <AgentsEmptyState range={rangeLabel} /> : undefined}
            data-test-subj="agtEvlAgentsTable"
          />
          {agents.length > 0 && (
            <EuiText size="xs" color="subdued">
              <p>
                {i18n.translate('agentTraces.evals.agents.footnote', {
                  defaultMessage:
                    'Pass rate counts results with a pass rule (pass or fail); each evaluation counts the same. Hover a version for its sample size.',
                })}
              </p>
            </EuiText>
          )}
        </EuiPanel>
      )}
    </>
  );
};
