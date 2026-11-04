/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Criteria,
  EuiBadge,
  EuiCallOut,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiButtonEmpty,
  EuiFieldSearch,
  EuiFilterButton,
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
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
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
  ScoreBricks,
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

/** A filter menu: its values load only while it is open. */
const FacetFilter: React.FC<{
  facet: Facet;
  filters: ResultsFilters;
  selected: string[];
  onChange: (values: string[]) => void;
}> = ({ facet, filters, selected, onChange }) => {
  const { dataset, index, timeRange, refreshKey } = useSliceContext();
  const [open, setOpen] = useState(false);
  const query = open ? buildFacetQuery(index, filters, facet) : undefined;
  const { rows, loading, error } = usePplRows(dataset, query, timeRange, refreshKey);
  const values = facetValues(rows, FACET_KEY[facet]);
  // Selected values stay listed even when the range no longer holds them.
  const listed = [
    ...values,
    ...selected.filter((s) => !values.some((v) => v.value === s)).map((value) => ({ value, n: 0 })),
  ];
  const options: EuiSelectableOption[] = listed.map((v) => ({
    label: valueLabel(facet, v.value),
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
        <EuiFilterButton
          iconType="arrowDown"
          onClick={() => setOpen(!open)}
          isSelected={open}
          hasActiveFilters={selected.length > 0}
          numActiveFilters={selected.length || undefined}
          data-test-subj={`agtEvlFacet-${facet}`}
        >
          {FACET_LABEL[facet]}
        </EuiFilterButton>
      }
    >
      <EuiPopoverTitle paddingSize="s">
        {i18n.translate('agentTraces.evals.results.topValues', {
          defaultMessage: 'Top values in the range',
        })}
      </EuiPopoverTitle>
      <div className="agtEvlFacet" data-test-subj={`agtEvlFacetList-${facet}`}>
        {error ? (
          <EuiText size="xs" color="danger" className="agtEvlFacet__error">
            <p>{error}</p>
          </EuiText>
        ) : (
          <EuiSelectable
            options={options}
            isLoading={loading}
            onChange={(next) =>
              onChange(next.filter((o) => o.checked === 'on').map((o) => String(o.key)))
            }
            listProps={{ bordered: false }}
          >
            {(list) => list}
          </EuiSelectable>
        )}
      </div>
    </EuiPopover>
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
  } = useSliceContext();
  const stored = state.results;
  const [search, setSearch] = useState(stored.q);
  const q = useDebounced(search);
  const filters: ResultsFilters = useMemo(
    () => ({ ...stored, q, lockAgent, agents: lockAgent ? [] : stored.agents }),
    [stored, q, lockAgent]
  );
  const update = (patch: Partial<ResultsFilters>) =>
    setState({ results: { ...stored, q, ...patch } });

  const [sort, setSort] = useState<ResultsSort>(DEFAULT_RESULTS_SORT);
  const [pageIndex, setPageIndex] = useState(0);
  const filtersKey = JSON.stringify([filters, timeRange]);
  useEffect(() => setPageIndex(0), [filtersKey]);

  const page = usePplRows(
    dataset,
    buildResultsPageQuery(index, filters, sort, pageIndex),
    timeRange,
    refreshKey
  );
  const count = usePplRows(dataset, buildResultsCountQuery(index, filters), timeRange, refreshKey);
  const results = useMemo(() => recordsToResults(page.rows), [page.rows]);
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
            render: (a?: string) => (a ? a : <span className="agtEvlDim">{NO_AGENT_LABEL}</span>),
          } as EuiBasicTableColumn<EvalResult>,
        ]),
    {
      field: 'agentVersion',
      name: i18n.translate('agentTraces.evals.results.version', { defaultMessage: 'Version' }),
      render: (v?: string) => <VersionBadge version={v} />,
    },
    {
      field: 'name',
      name: FACET_LABEL.names,
      sortable: true,
      render: (n: string) => <strong>{n}</strong>,
    },
    {
      field: 'verdict',
      name: FACET_LABEL.verdicts,
      render: (v: Verdict) => <VerdictBadge verdict={v} />,
    },
    {
      field: 'value',
      name: i18n.translate('agentTraces.evals.results.score', { defaultMessage: 'Score' }),
      sortable: true,
      align: 'right',
      render: (_: unknown, r: EvalResult) => <ScoreBricks r={r} />,
    },
    {
      field: 'explanation',
      name: i18n.translate('agentTraces.evals.results.explanation', {
        defaultMessage: 'Explanation',
      }),
      width: '32%',
      render: (e?: string) => (
        <span className="agtEvlDim agtEvlTrunc" title={e}>
          {e ?? DASH}
        </span>
      ),
    },
    {
      field: 'runId',
      name: i18n.translate('agentTraces.evals.results.run', { defaultMessage: 'Run' }),
      render: (runId?: string) =>
        runId ? (
          <EuiLink
            className="agtEvlMono"
            title={runId}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              navigate({ page: 'run', runId });
            }}
          >
            {shortId(runId)}
          </EuiLink>
        ) : (
          <span className="agtEvlDim">
            {i18n.translate('agentTraces.evals.results.online', { defaultMessage: 'online' })}
          </span>
        ),
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

  return (
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
          <EuiFieldSearch
            fullWidth
            compressed
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
      {page.error ? (
        <QueryErrorCallout message={page.error} />
      ) : (
        <EuiPanel paddingSize="s" hasShadow={false} hasBorder>
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
              page.loaded && !page.loading
                ? i18n.translate('agentTraces.evals.results.empty', {
                    defaultMessage: 'No results match these filters in the range.',
                  })
                : undefined
            }
            data-test-subj="agtEvlResultsTable"
          />
        </EuiPanel>
      )}
    </>
  );
};
