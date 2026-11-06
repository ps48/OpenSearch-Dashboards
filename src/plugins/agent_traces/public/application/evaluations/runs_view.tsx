/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiBasicTableColumn,
  EuiCode,
  EuiCompressedFieldSearch,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { RunName, RunRow, evalRuns, runCases, withRunNames } from './eval_model';
import {
  F,
  NO_AGENT,
  RUNS_FACETS,
  RunsFacet,
  RunsFilters,
  buildEvalRunCasesQuery,
  buildEvalRunsQuery,
  buildRunsFacetQuery,
  isTruncated,
} from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { useDebounced } from './agents_home';
import { FacetMenu } from './results_view';
import { useRunNames } from './use_run_names';
import {
  CompareSelectionBar,
  RunNameCell,
  runSelectColumn,
  useRunSelection,
} from './run_selection';
import {
  DASH,
  PassRateCell,
  PassRateTip,
  QueryErrorCallout,
  TruncatedCallout,
  VersionBadge,
  agentLabel,
  formatTime,
  shortId,
} from './eval_components';
import { EVALS_CI_URL, EVALS_QUICKSTART_URL, NoResultsInRange } from './eval_empty_states';

const FACET_LABEL: Record<RunsFacet, string> = {
  agents: i18n.translate('agentTraces.evals.runs.agent', { defaultMessage: 'Agent' }),
  suites: i18n.translate('agentTraces.evals.runs.suite', { defaultMessage: 'Test suite' }),
};

/** One message per facet (a label inserted into a sentence does not translate). */
const FACET_SEARCH: Record<RunsFacet, string> = {
  agents: i18n.translate('agentTraces.evals.runs.searchAgents', {
    defaultMessage: 'Search agents',
  }),
  suites: i18n.translate('agentTraces.evals.runs.searchSuites', {
    defaultMessage: 'Search test suites',
  }),
};

const FACET_KEY: Record<RunsFacet, string> = { agents: F.agentName, suites: F.suiteName };

const NO_SUITE_LABEL = i18n.translate('agentTraces.evals.runs.noSuite', {
  defaultMessage: '(no test suite name)',
});

const facetValueLabel = (facet: RunsFacet, value: string) =>
  facet === 'agents' ? agentLabel(value) : value === NO_AGENT ? NO_SUITE_LABEL : value;

const EmptyBody: React.FC = () => (
  <p>
    <FormattedMessage
      id="agentTraces.evals.runs.emptyBody"
      defaultMessage="Runs appear when you run a test suite with {evaluate}."
      values={{ evaluate: <EuiCode>evaluate()</EuiCode> }}
    />{' '}
    <EuiLink href={EVALS_QUICKSTART_URL} target="_blank" data-test-subj="agtEvlRunsQuickstart">
      {i18n.translate('agentTraces.evals.runs.quickstart', { defaultMessage: 'Quickstart' })}
    </EuiLink>
    {' · '}
    <EuiLink href={EVALS_CI_URL} target="_blank" data-test-subj="agtEvlRunsSuiteInCi">
      {i18n.translate('agentTraces.evals.runs.suiteInCi', {
        defaultMessage: 'Run a test suite in CI',
      })}
    </EuiLink>
  </p>
);

/**
 * Eval runs (a home tab): one row per suite run (`test.suite.run.id`) in the range across
 * suites and agents, latest first, from two aggregations (runs, cases passed per run). Compare
 * opens a run next to another run of the same suite and agent.
 */
export const RunsView: React.FC = () => {
  const { dataset, index, timeRange, refreshKey, state, setState, navigate } = useEvalContext();
  const stored = state.runs;
  const [search, setSearch] = useState(stored.q);
  const q = useDebounced(search);
  // Back and Forward change the stored search: show it (not on our own updates, which store q).
  useEffect(() => {
    if (stored.q !== q) setSearch(stored.q);
    // Only a change of the stored search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.q]);
  const filters: RunsFilters = useMemo(() => ({ ...stored, q }), [stored, q]);
  const update = (patch: Partial<RunsFilters>) => setState({ runs: { ...stored, q, ...patch } });
  const filtered = filters.agents.length > 0 || filters.suites.length > 0 || !!filters.q.trim();
  const clearFilters = () => {
    setSearch('');
    update({ agents: [], suites: [], q: '' });
  };

  const runsQuery = usePplRows(dataset, buildEvalRunsQuery(index, filters), timeRange, refreshKey);
  const casesQuery = usePplRows(
    dataset,
    buildEvalRunCasesQuery(index, filters),
    timeRange,
    refreshKey
  );
  const plainRuns = useMemo(() => evalRuns(runsQuery.rows), [runsQuery.rows]);
  const names = useRunNames(useMemo(() => plainRuns.map((r) => r.runId), [plainRuns]));
  const runs: Array<RunRow & RunName> = useMemo(
    () => withRunNames(plainRuns, names),
    [plainRuns, names]
  );
  const cases = useMemo(() => runCases(casesQuery.rows), [casesQuery.rows]);
  const truncated = isTruncated(runsQuery.rows);

  const sel = useRunSelection<RunRow & RunName>();

  const columns: Array<EuiBasicTableColumn<RunRow & RunName>> = [
    runSelectColumn(sel),
    {
      field: 'runId',
      name: i18n.translate('agentTraces.evals.runs.run', { defaultMessage: 'Run' }),
      sortable: (r: RunRow & RunName) => r.name ?? shortId(r.runId),
      render: (_: string, r: RunRow & RunName) => (
        <RunNameCell
          run={r}
          onOpen={() => navigate({ page: 'run', runId: r.runId })}
          testId={`agtEvlRunsRunLink-${r.runId}`}
        />
      ),
    },
    {
      field: 'suite',
      name: FACET_LABEL.suites,
      sortable: (r: RunRow) => r.suite ?? '',
      render: (suite?: string) =>
        suite ? (
          <EuiLink onClick={() => navigate({ page: 'suite', suite })}>
            <strong>{suite}</strong>
          </EuiLink>
        ) : (
          <span className="agtEvlDim">{NO_SUITE_LABEL}</span>
        ),
    },
    {
      field: 'agent',
      name: FACET_LABEL.agents,
      sortable: (r: RunRow) => r.agent ?? '',
      render: (agent?: string) =>
        agent ? agent : <span className="agtEvlDim">{agentLabel(agent)}</span>,
    },
    {
      field: 'version',
      name: i18n.translate('agentTraces.evals.runs.version', { defaultMessage: 'Version' }),
      sortable: (r: RunRow) => r.version ?? '',
      render: (v?: string) => <VersionBadge version={v} />,
    },
    {
      field: 'cases',
      name: i18n.translate('agentTraces.evals.runs.casesPassed', {
        defaultMessage: 'Cases passed',
      }),
      align: 'right',
      sortable: (r: RunRow) => {
        const c = cases.get(r.runId);
        return c && c.cases ? c.passed / c.cases : -1;
      },
      render: (_: unknown, r: RunRow) => {
        const c = cases.get(r.runId);
        return c ? (
          <strong className="agtEvlNoWrap" data-test-subj={`agtEvlRunsCases-${r.runId}`}>
            {c.passed} / {c.cases}
          </strong>
        ) : (
          <span className="agtEvlDim">{DASH}</span>
        );
      },
    },
    {
      field: 'rate',
      name: (
        <span>
          {i18n.translate('agentTraces.evals.runs.passRate', { defaultMessage: 'Pass rate' })}{' '}
          <PassRateTip />
        </span>
      ),
      align: 'right',
      sortable: (r: RunRow) => r.rate ?? -1,
      render: (rate?: number) => <PassRateCell rate={rate} />,
    },
    {
      field: 'started',
      name: i18n.translate('agentTraces.evals.runs.started', { defaultMessage: 'Started' }),
      sortable: true,
      render: (t: number) => <span className="agtEvlDim">{formatTime(t)}</span>,
    },
  ];

  return (
    <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
      <EuiTitle size="s">
        <h3>
          {i18n.translate('agentTraces.evals.runs.title', { defaultMessage: 'Eval runs' })}
          <span className="agtEvlDim"> ({runs.length})</span>
        </h3>
      </EuiTitle>
      <EuiSpacer size="xs" />
      <EuiText size="s" color="subdued">
        <p>
          {i18n.translate('agentTraces.evals.runs.description', {
            defaultMessage:
              'Offline test runs: one row per run of a test suite (evaluate() or a Benchmark), newest first. Online evaluations of live traffic are under Agents. Click a run to see its cases, or check two runs of the same test suite and agent to compare them.',
          })}
        </p>
      </EuiText>
      <EuiSpacer size="m" />
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiFilterGroup>
            {RUNS_FACETS.map((facet) => (
              <FacetMenu
                key={facet}
                id={`runs-${facet}`}
                label={FACET_LABEL[facet]}
                searchPlaceholder={FACET_SEARCH[facet]}
                queryOf={() => buildRunsFacetQuery(index, filters, facet)}
                valueKey={FACET_KEY[facet]}
                valueLabel={(value) => facetValueLabel(facet, value)}
                timeRange={timeRange}
                selected={filters[facet]}
                onChange={(values) => update({ [facet]: values })}
              />
            ))}
          </EuiFilterGroup>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiCompressedFieldSearch
            fullWidth
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => update({ q: search })}
            placeholder={i18n.translate('agentTraces.evals.runs.search', {
              defaultMessage: 'Search run id, test suite or agent',
            })}
            data-test-subj="agtEvlRunsSearch"
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <CompareSelectionBar
            sel={sel}
            onCompare={(runA, runB) => navigate({ page: 'compare', runA, runB })}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      {truncated && (
        <>
          <TruncatedCallout />
          <EuiSpacer size="s" />
        </>
      )}
      {/* "Cases passed" comes from its own query: a failure is shown, not dashes. */}
      {!runsQuery.error && casesQuery.error && (
        <>
          <QueryErrorCallout message={casesQuery.error} />
          <EuiSpacer size="s" />
        </>
      )}
      {runsQuery.error ? (
        <QueryErrorCallout message={runsQuery.error} />
      ) : (
        <EuiInMemoryTable<RunRow & RunName>
          items={runs}
          itemId="runId"
          columns={columns}
          loading={runsQuery.loading}
          tableLayout="auto"
          sorting={{ sort: { field: 'started', direction: 'desc' } }}
          allowNeutralSort={false}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          rowProps={(r: RunRow) => ({
            className: 'agtEvlClickRow',
            onClick: (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest('input,label,a,button')) return;
              navigate({ page: 'run', runId: r.runId });
            },
            'data-test-subj': `agtEvlRunsRow-${r.runId}`,
          })}
          message={
            runsQuery.loaded && !runsQuery.loading ? (
              filtered ? (
                <NoResultsInRange
                  title={i18n.translate('agentTraces.evals.runs.emptyFilteredTitle', {
                    defaultMessage: 'No eval runs match these filters',
                  })}
                  ranges={[]}
                  onClearFilters={clearFilters}
                  data-test-subj="agtEvlRunsEmpty"
                />
              ) : (
                <NoResultsInRange
                  iconType="play"
                  title={i18n.translate('agentTraces.evals.runs.emptyTitle', {
                    defaultMessage: 'No eval runs in this time range',
                  })}
                  body={<EmptyBody />}
                  ranges={[]}
                  data-test-subj="agtEvlRunsEmpty"
                />
              )
            ) : undefined
          }
          data-test-subj="agtEvlRunsTable"
        />
      )}
    </EuiPanel>
  );
};
