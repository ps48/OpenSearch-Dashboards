/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Criteria,
  EuiBadge,
  EuiCallOut,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiButtonEmpty,
  EuiCompressedFieldSearch,
  EuiSmallFilterButton,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiPanel,
  EuiPopover,
  EuiPopoverTitle,
  EuiSelectable,
  EuiSelectableOption,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { TimeRange } from '../../../../data/common';
import { EvalResult, Verdict, facetValues, num, recordsToResults } from './eval_model';
import {
  DEFAULT_RESULTS_SORT,
  F,
  FACETS,
  Facet,
  RESULTS_PAGE_SIZE,
  ResultsFilters,
  ResultsSort,
  ResultsSortField,
  buildFacetQuery,
  buildResultsCountQuery,
  buildResultsPageQuery,
} from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { useRunNames } from './use_run_names';
import { useDebounced } from './agents_home';
import {
  DASH,
  NO_AGENT_LABEL,
  QueryErrorCallout,
  SourceFilter,
  VERDICT_LABEL,
  VerdictBadge,
  VersionBadge,
  agentLabel,
  formatTime,
  ScoreCell,
  TargetLink,
  shortId,
  sliceLabel,
  versionLabel,
} from './eval_components';

const FACET_LABEL: Record<Facet, string> = {
  agents: i18n.translate('agentTraces.evals.results.agent', { defaultMessage: 'Agent' }),
  names: i18n.translate('agentTraces.evals.results.evaluation', { defaultMessage: 'Evaluation' }),
  versions: i18n.translate('agentTraces.evals.results.version', { defaultMessage: 'Version' }),
  verdicts: i18n.translate('agentTraces.evals.results.verdict', { defaultMessage: 'Verdict' }),
};

/** One message per facet (a label inserted into a sentence does not translate). */
const FACET_SEARCH: Record<Facet, string> = {
  agents: i18n.translate('agentTraces.evals.results.searchAgents', {
    defaultMessage: 'Search agents',
  }),
  names: i18n.translate('agentTraces.evals.results.searchEvaluations', {
    defaultMessage: 'Search evaluations',
  }),
  versions: i18n.translate('agentTraces.evals.results.searchVersions', {
    defaultMessage: 'Search versions',
  }),
  verdicts: i18n.translate('agentTraces.evals.results.searchVerdicts', {
    defaultMessage: 'Search verdicts',
  }),
};

const FACET_KEY: Record<Facet, string> = {
  agents: F.agentName,
  names: F.name,
  versions: F.agentVersion,
  verdicts: 'verdict',
};

const valueLabel = (facet: Facet, value: string) =>
  facet === 'verdicts'
    ? (VERDICT_LABEL[value as Verdict] ?? value)
    : facet === 'versions'
      ? versionLabel(value)
      : agentLabel(value);

/**
 * A filter menu (Results, Eval runs): the top values in the range with their counts, read
 * only while it is open (`queryOf` builds the query then).
 */
export const FacetMenu: React.FC<{
  id: string;
  label: string;
  searchPlaceholder: string;
  queryOf: () => string;
  /** The values' field in the query's rows. */
  valueKey: string;
  valueLabel: (value: string) => string;
  timeRange: TimeRange;
  selected: string[];
  onChange: (values: string[]) => void;
}> = ({
  id,
  label,
  searchPlaceholder,
  queryOf,
  valueKey,
  valueLabel: labelOf,
  timeRange,
  selected,
  onChange,
}) => {
  const { dataset, refreshKey } = useEvalContext();
  const [open, setOpen] = useState(false);
  const { rows, loading, error } = usePplRows(
    dataset,
    open ? queryOf() : undefined,
    timeRange,
    refreshKey
  );
  const values = facetValues(rows, valueKey);
  // Selected values stay listed even when the range no longer holds them.
  const listed = [
    ...values,
    ...selected.filter((s) => !values.some((v) => v.value === s)).map((value) => ({ value, n: 0 })),
  ];
  const options: EuiSelectableOption[] = listed.map((v) => ({
    label: labelOf(v.value),
    key: v.value,
    checked: selected.includes(v.value) ? 'on' : undefined,
    append: <span className="agtEvlDim agtEvlSmall">{v.n.toLocaleString()}</span>,
  }));
  return (
    <EuiPopover
      isOpen={open}
      closePopover={() => setOpen(false)}
      panelPaddingSize="none"
      button={
        <EuiSmallFilterButton
          iconType="arrowDown"
          onClick={() => setOpen(!open)}
          isSelected={open}
          hasActiveFilters={selected.length > 0}
          numActiveFilters={selected.length || undefined}
          data-test-subj={`agtEvlFacet-${id}`}
        >
          {label}
        </EuiSmallFilterButton>
      }
    >
      <EuiPopoverTitle paddingSize="s">
        {i18n.translate('agentTraces.evals.results.topValues', {
          defaultMessage: 'Top values in the range',
        })}
      </EuiPopoverTitle>
      <div className="agtEvlFacet" data-test-subj={`agtEvlFacetList-${id}`}>
        {error ? (
          <EuiText size="xs" color="danger" className="agtEvlFacet__error">
            <p>{error}</p>
          </EuiText>
        ) : (
          <EuiSelectable
            searchable
            searchProps={{
              compressed: true,
              placeholder: searchPlaceholder,
              'data-test-subj': `agtEvlFacetSearch-${id}`,
            }}
            options={options}
            isLoading={loading}
            onChange={(next) =>
              onChange(next.filter((o) => o.checked === 'on').map((o) => String(o.key)))
            }
            listProps={{ bordered: false }}
          >
            {(list, search) => (
              <>
                <div className="agtEvlFacet__search">{search}</div>
                {list}
              </>
            )}
          </EuiSelectable>
        )}
      </div>
    </EuiPopover>
  );
};

/** A Results filter menu, with the other filters applied (and the chart slice, when set). */
const FacetFilter: React.FC<{
  facet: Facet;
  filters: ResultsFilters;
  selected: string[];
  onChange: (values: string[]) => void;
}> = ({ facet, filters, selected, onChange }) => {
  const { index, timeRange } = useSliceContext();
  return (
    <FacetMenu
      id={facet}
      label={FACET_LABEL[facet]}
      searchPlaceholder={FACET_SEARCH[facet]}
      queryOf={() => buildFacetQuery(index, filters, facet)}
      valueKey={FACET_KEY[facet]}
      valueLabel={(value) => valueLabel(facet, value)}
      timeRange={timeRange}
      selected={selected}
      onChange={onChange}
    />
  );
};

const facetPatch = (facet: Facet, values: string[]): Partial<ResultsFilters> =>
  ({ [facet]: values }) as Partial<ResultsFilters>;

/** The screen's context, with the time range narrowed to a clicked chart slice when one is set. */
const useSliceContext = () => {
  const ctx = useEvalContext();
  const { slice } = ctx.state;
  return useMemo(
    () =>
      slice
        ? {
            ...ctx,
            timeRange: {
              from: new Date(slice.from).toISOString(),
              to: new Date(slice.to).toISOString(),
            },
          }
        : ctx,
    [ctx, slice]
  );
};

const SORT_OF_COLUMN: Record<string, ResultsSortField> = {
  time: 'time',
  agentName: 'agent',
  name: 'evaluation',
  value: 'score',
};
const COLUMN_OF_SORT: Record<ResultsSortField, keyof EvalResult> = {
  time: 'time',
  agent: 'agentName',
  evaluation: 'name',
  score: 'value',
};

const ONLINE_LABEL = i18n.translate('agentTraces.evals.results.online', {
  defaultMessage: 'Online',
});
const OFFLINE_LABEL = i18n.translate('agentTraces.evals.results.offline', {
  defaultMessage: 'Offline',
});

/** Online (no `test.suite.run.id`), or Offline with the run (its name, else its short id). */
export const RunTypeCell: React.FC<{
  runId?: string;
  name?: string;
  onOpen: (runId: string) => void;
}> = ({ runId, name, onOpen }) =>
  runId ? (
    <span className="agtEvlTrunc" data-test-subj="agtEvlRunType-offline">
      {OFFLINE_LABEL}
      {' · '}
      <EuiLink
        className={name ? undefined : 'agtEvlMono'}
        title={name ? `${name} (${runId})` : runId}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onOpen(runId);
        }}
        data-test-subj={`agtEvlResultRun-${runId}`}
      >
        {name ?? shortId(runId)}
      </EuiLink>
    </span>
  ) : (
    <span className="agtEvlDim" data-test-subj="agtEvlRunType-online">
      {ONLINE_LABEL}
    </span>
  );

/**
 * Results: filters pushed into the query, sorted and paged on the server (25 a page), the
 * total from `stats count()`. `lockAgent`: the agent page's Results tab.
 */
export const ResultsView: React.FC<{ lockAgent?: string }> = ({ lockAgent }) => {
  const {
    dataset,
    index,
    timeRange,
    rangeLabel,
    refreshKey,
    state,
    setState,
    navigate,
    openResult,
    hrefOf,
  } = useSliceContext();
  const stored = state.results;
  const [search, setSearch] = useState(stored.q);
  const q = useDebounced(search);
  // Back and Forward change the stored search: show it (not on our own updates, which store q).
  useEffect(() => {
    if (stored.q !== q) setSearch(stored.q);
    // Only a change of the stored search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.q]);
  const filters: ResultsFilters = useMemo(
    () => ({ ...stored, q, lockAgent, agents: lockAgent ? [] : stored.agents }),
    [stored, q, lockAgent]
  );
  const update = (patch: Partial<ResultsFilters>) =>
    setState({ results: { ...stored, q, ...patch } });

  // The sort is kept in the app state (the URL), so the tab comes back sorted as it was left.
  const [sort, setSortValue] = useState<ResultsSort>(state.resultsSort ?? DEFAULT_RESULTS_SORT);
  const setSort = (next: ResultsSort) => {
    setSortValue(next);
    setState({ resultsSort: next });
  };
  const [pageIndex, setPageIndex] = useState(0);
  const filtersKey = JSON.stringify([filters, timeRange]);
  // New filters or a new range go back to page 1; Refresh (which resolves a relative range
  // again, so `timeRange` changes too) keeps the page. The refresh seen last is kept up to date
  // on every Refresh, including one that leaves the filters key alone (an absolute range), so a
  // later filter change is not mistaken for a refresh.
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    const refreshed = lastRefresh.current !== refreshKey;
    lastRefresh.current = refreshKey;
    if (!refreshed) setPageIndex(0);
    // Keyed on the filters; refreshKey is read to tell a refresh apart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);
  useEffect(() => {
    lastRefresh.current = refreshKey;
  }, [refreshKey]);

  const page = usePplRows(
    dataset,
    buildResultsPageQuery(index, filters, sort, pageIndex),
    timeRange,
    refreshKey
  );
  const count = usePplRows(dataset, buildResultsCountQuery(index, filters), timeRange, refreshKey);
  const results = useMemo(() => recordsToResults(page.rows), [page.rows]);
  // Offline results name their run: read from the result itself, else one document per run.
  const runIds = useMemo(
    () => [...new Set(results.flatMap((r) => (r.runId && !r.runName ? [r.runId] : [])))],
    [results]
  );
  const looked = useRunNames(runIds);
  const runNames = useMemo(() => {
    const m = new Map(looked);
    results.forEach((r) => {
      if (r.runId && r.runName) m.set(r.runId, { name: r.runName });
    });
    return m;
  }, [looked, results]);
  const total = num(count.rows[0]?.total) ?? 0;

  const chips: Array<{ facet: Facet; value: string }> = FACETS.filter(
    (f) => !(lockAgent && f === 'agents')
  ).flatMap((facet) => filters[facet].map((value) => ({ facet, value })));

  const columns: Array<EuiBasicTableColumn<EvalResult>> = [
    {
      field: 'time',
      name: i18n.translate('agentTraces.evals.results.time', { defaultMessage: 'Time' }),
      sortable: true,
      width: '140px',
      render: (t: number) => <span className="agtEvlDim">{formatTime(t, 'MMM D, HH:mm:ss')}</span>,
    },
    ...(lockAgent
      ? []
      : [
          {
            field: 'agentName',
            name: FACET_LABEL.agents,
            sortable: true,
            width: '13%',
            truncateText: true,
            render: (a?: string) =>
              a ? (
                <span className="agtEvlTrunc" title={a}>
                  {a}
                </span>
              ) : (
                <span className="agtEvlDim">{NO_AGENT_LABEL}</span>
              ),
          } as EuiBasicTableColumn<EvalResult>,
        ]),
    {
      field: 'agentVersion',
      name: i18n.translate('agentTraces.evals.results.version', { defaultMessage: 'Version' }),
      width: '96px',
      render: (v?: string) => <VersionBadge version={v} />,
    },
    {
      field: 'runId',
      name: i18n.translate('agentTraces.evals.results.runType', { defaultMessage: 'Run type' }),
      width: '13%',
      truncateText: true,
      render: (runId: string | undefined) => (
        <RunTypeCell
          runId={runId}
          name={runId ? runNames.get(runId)?.name : undefined}
          onOpen={(id) => navigate({ page: 'run', runId: id })}
        />
      ),
    },
    {
      field: 'name',
      name: FACET_LABEL.names,
      sortable: true,
      width: '15%',
      truncateText: true,
      // A link, so the result opens from the keyboard too (the row click is mouse only).
      render: (n: string, r: EvalResult) => (
        <EuiToolTip
          anchorClassName="agtEvlTruncAnchor"
          content={
            <>
              <div>
                <strong>{n}</strong>
              </div>
              {r.evaluatorName && (
                <div>
                  {i18n.translate('agentTraces.evals.results.evaluatorTip', {
                    defaultMessage: 'Evaluator: {evaluator}',
                    values: { evaluator: r.evaluatorName },
                  })}
                </div>
              )}
              {r.evaluatorDescription && <div>{r.evaluatorDescription}</div>}
            </>
          }
        >
          <EuiLink
            className="agtEvlTrunc"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              openResult(r);
            }}
            data-test-subj="agtEvlResultOpen"
          >
            <strong>{n}</strong>
          </EuiLink>
        </EuiToolTip>
      ),
    },
    {
      field: 'verdict',
      name: FACET_LABEL.verdicts,
      width: '120px',
      render: (v: Verdict) => <VerdictBadge verdict={v} />,
    },
    {
      field: 'value',
      name: i18n.translate('agentTraces.evals.results.score', { defaultMessage: 'Score' }),
      sortable: true,
      width: '140px',
      render: (_: unknown, r: EvalResult) => <ScoreCell r={r} />,
    },
    {
      field: 'explanation',
      name: i18n.translate('agentTraces.evals.results.explanation', {
        defaultMessage: 'Explanation',
      }),
      width: '22%',
      render: (e: string | undefined, r: EvalResult) =>
        r.errorType && !e ? (
          // An evaluator error: its error.type is the reason.
          <span className="agtEvlTrunc" title={r.errorType}>
            <code>{r.errorType}</code>
          </span>
        ) : (
          <span className="agtEvlDim agtEvlTrunc" title={e}>
            {e ?? DASH}
          </span>
        ),
    },
    {
      field: 'level',
      name: i18n.translate('agentTraces.evals.results.target', { defaultMessage: 'Target' }),
      width: '96px',
      render: (_: unknown, r: EvalResult) => <TargetLink r={r} href={hrefOf?.(r)} />,
    },
  ];

  const onTableChange = ({ page: p, sort: s }: Criteria<EvalResult>) => {
    if (s) {
      const field = SORT_OF_COLUMN[String(s.field)];
      if (field && (field !== sort.field || s.direction !== sort.direction)) {
        setSort({ field, direction: s.direction });
        setPageIndex(0);
        return;
      }
    }
    if (p) setPageIndex(p.index);
  };

  const table = page.error ? (
    <QueryErrorCallout message={page.error} />
  ) : (
    <EuiBasicTable<EvalResult>
      items={results}
      itemId="id"
      columns={columns}
      loading={page.loading || count.loading}
      sorting={{
        sort: { field: COLUMN_OF_SORT[sort.field], direction: sort.direction },
      }}
      pagination={{
        pageIndex,
        pageSize: RESULTS_PAGE_SIZE,
        totalItemCount: total,
        pageSizeOptions: [RESULTS_PAGE_SIZE],
        hidePerPageOptions: true,
      }}
      onChange={onTableChange}
      rowProps={(r: EvalResult) => ({
        className: 'agtEvlClickRow',
        onClick: () => openResult(r),
      })}
      noItemsMessage={
        page.loaded && !page.loading ? (
          <span data-test-subj="agtEvlResultsEmpty">
            {i18n.translate('agentTraces.evals.results.empty', {
              defaultMessage: 'No results match these filters in the range.',
            })}
            {(chips.length > 0 || !!filters.q) && (
              <>
                {' '}
                <EuiLink
                  onClick={() => {
                    setSearch('');
                    update({ agents: [], names: [], versions: [], verdicts: [], q: '' });
                  }}
                  data-test-subj="agtEvlResultsEmptyClear"
                >
                  {i18n.translate('agentTraces.evals.results.clearFilters', {
                    defaultMessage: 'Clear filters',
                  })}
                </EuiLink>
              </>
            )}
          </span>
        ) : undefined
      }
      data-test-subj="agtEvlResultsTable"
    />
  );

  const body = (
    <>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiFilterGroup>
            {FACETS.filter((f) => !(lockAgent && f === 'agents')).map((facet) => (
              <FacetFilter
                key={facet}
                facet={facet}
                filters={filters}
                selected={filters[facet]}
                onChange={(values) => update(facetPatch(facet, values))}
              />
            ))}
          </EuiFilterGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <SourceFilter value={filters.source} onChange={(source) => update({ source })} />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiCompressedFieldSearch
            fullWidth
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => update({ q: search })}
            placeholder={i18n.translate('agentTraces.evals.results.search', {
              defaultMessage: 'Search explanations',
            })}
            data-test-subj="agtEvlResultsSearch"
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      {chips.length > 0 && (
        <>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
            {chips.map(({ facet, value }) => (
              <EuiFlexItem grow={false} key={`${facet}-${value}`}>
                <EuiBadge
                  color="hollow"
                  iconType="cross"
                  iconSide="right"
                  iconOnClick={() =>
                    update(
                      facetPatch(
                        facet,
                        filters[facet].filter((v) => v !== value)
                      )
                    )
                  }
                  iconOnClickAriaLabel={i18n.translate('agentTraces.evals.results.removeChip', {
                    defaultMessage: 'Remove',
                  })}
                  data-test-subj={`agtEvlChip-${facet}-${value}`}
                >
                  {FACET_LABEL[facet]}: {valueLabel(facet, value)}
                </EuiBadge>
              </EuiFlexItem>
            ))}
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                size="xs"
                onClick={() => update({ agents: [], names: [], versions: [], verdicts: [] })}
                data-test-subj="agtEvlClearChips"
              >
                {i18n.translate('agentTraces.evals.results.clear', { defaultMessage: 'Clear' })}
              </EuiButtonEmpty>
            </EuiFlexItem>
          </EuiFlexGroup>
        </>
      )}
      {state.slice && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut size="s" iconType="visLine" data-test-subj="agtEvlSliceCallout">
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem>
                <span>
                  {i18n.translate('agentTraces.evals.results.slice', {
                    defaultMessage: 'Showing the slice you clicked on the chart:',
                  })}{' '}
                  <strong>{sliceLabel(state.slice.from, state.slice.to)}</strong>
                </span>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiLink
                  onClick={() => setState({ slice: undefined })}
                  data-test-subj="agtEvlClearSlice"
                >
                  {i18n.translate('agentTraces.evals.results.sliceBack', {
                    defaultMessage: 'Back to {range}',
                    values: { range: rangeLabel },
                  })}
                </EuiLink>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiCallOut>
        </>
      )}
      <EuiSpacer size="m" />
      {/* The total comes from its own query: without it the pager cannot count. */}
      {!page.error && count.error && (
        <>
          <QueryErrorCallout message={count.error} />
          <EuiSpacer size="s" />
        </>
      )}
      {lockAgent && !page.error ? (
        <EuiPanel paddingSize="s" hasShadow={false} hasBorder>
          {table}
        </EuiPanel>
      ) : (
        table
      )}
    </>
  );

  // The agent page's Results tab sits under the page's own header; the home tab has its own.
  if (lockAgent) return body;
  return (
    <EuiPanel paddingSize="m" hasShadow={false} hasBorder data-test-subj="agtEvlResultsPanel">
      <EuiTitle size="s">
        <h3>
          {i18n.translate('agentTraces.evals.results.title', { defaultMessage: 'Eval results' })}
          {count.loaded && !count.error && (
            <span className="agtEvlDim"> ({total.toLocaleString()})</span>
          )}
        </h3>
      </EuiTitle>
      <EuiSpacer size="xs" />
      <EuiText size="s" color="subdued">
        <p>
          {i18n.translate('agentTraces.evals.results.description', {
            defaultMessage:
              'Every evaluation result, online and offline: one row per verdict on a span, trace or session, newest first. Click a row to see the result.',
          })}
        </p>
      </EuiText>
      <EuiSpacer size="m" />
      {body}
    </EuiPanel>
  );
};
