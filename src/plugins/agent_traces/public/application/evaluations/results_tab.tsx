/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  Criteria,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { EvalResult, OUTCOME_RANK, normalizedScore } from './eval_data';
import { ShowTracesMenu } from './eval_trace_filter';
import {
  DEFAULT_RESULTS_SORT,
  RESULTS_PAGE_SIZES,
  ResultsSort,
  ResultsSortField,
} from './eval_ppl';
import { parseEvalTime } from './eval_aggregations';
import {
  LevelBadge,
  OutcomeBadge,
  QueryErrorCallout,
  TargetText,
  formatEvalTime,
  sourceLabel,
} from './eval_components';

export const EXPLANATION_PREVIEW = 120;

interface ResultRow extends EvalResult {
  timeMs: number;
  /** Sort key for the result column: failures first, then by normalized score. */
  rank: number;
  agentOrService: string;
}

export const toResultRows = (results: EvalResult[]): ResultRow[] =>
  results.map((r) => ({
    ...r,
    timeMs: parseEvalTime(r.time),
    rank: OUTCOME_RANK[r.outcome] * 10 + (normalizedScore(r) ?? 0.5),
    agentOrService: r.agentName ?? r.serviceName ?? '',
  }));

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 3)}...` : text;

/** Table column field of each server-side sort. */
const SORT_COLUMN: Record<ResultsSortField, keyof ResultRow> = {
  time: 'timeMs',
  name: 'name',
  level: 'level',
  result: 'rank',
};
const COLUMN_SORT = Object.fromEntries(
  Object.entries(SORT_COLUMN).map(([k, v]) => [v, k])
) as Record<string, ResultsSortField>;

/**
 * Every result in the range under the filters: one page at a time, sorted and paged in the
 * query, with the exact total from the aggregation.
 */
export const ResultsTab: React.FC<{
  /** The current page's results, in the requested order. */
  results: EvalResult[];
  /** Results under the filters (exact). */
  total?: number;
  loading?: boolean;
  error?: string;
  sort?: ResultsSort;
  pageIndex?: number;
  pageSize?: number;
  onTableChange?: (change: { sort: ResultsSort; pageIndex: number; pageSize: number }) => void;
  onOpenResult: (r: EvalResult) => void;
}> = ({
  results,
  total,
  loading,
  error,
  sort = DEFAULT_RESULTS_SORT,
  pageIndex = 0,
  pageSize = RESULTS_PAGE_SIZES[0],
  onTableChange,
  onOpenResult,
}) => {
  const rows = useMemo(() => toResultRows(results), [results]);

  const columns: Array<EuiBasicTableColumn<ResultRow>> = [
    {
      field: 'timeMs',
      name: i18n.translate('agentTraces.evalsPage.colTime', { defaultMessage: 'Time' }),
      sortable: true,
      width: '130px',
      render: (_ms: number, r: ResultRow) => (
        <EuiToolTip content={r.time}>
          <EuiText size="xs">{formatEvalTime(r.time)}</EuiText>
        </EuiToolTip>
      ),
    },
    {
      field: 'name',
      name: i18n.translate('agentTraces.evalsPage.colName', { defaultMessage: 'Evaluation' }),
      sortable: true,
      width: '18%',
      render: (name: string) => (
        <EuiToolTip content={name} display="block" anchorClassName="agtEvlNameCell">
          <span className="agtEvlName eui-textTruncate" data-test-subj="agtEvlResultName">
            {name}
          </span>
        </EuiToolTip>
      ),
    },
    {
      field: 'level',
      name: i18n.translate('agentTraces.evalsPage.colLevel', { defaultMessage: 'Level' }),
      sortable: true,
      width: '90px',
      render: (level: string) => <LevelBadge level={level} />,
    },
    {
      field: 'rank',
      name: i18n.translate('agentTraces.evalsPage.colResult', { defaultMessage: 'Result' }),
      sortable: true,
      width: '210px',
      render: (_rank: number, r: ResultRow) => (
        <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap={false}>
          <EuiFlexItem grow={false}>
            <OutcomeBadge result={r} />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <ShowTracesMenu name={r.name} label={r.label} value={r.value} />
          </EuiFlexItem>
        </EuiFlexGroup>
      ),
    },
    {
      field: 'explanation',
      name: i18n.translate('agentTraces.evalsPage.colExplanation', {
        defaultMessage: 'Explanation',
      }),
      width: '28%',
      render: (explanation?: string) =>
        explanation ? (
          <EuiToolTip content={truncate(explanation, 1000)} position="top">
            <EuiText size="xs">{truncate(explanation, EXPLANATION_PREVIEW)}</EuiText>
          </EuiToolTip>
        ) : (
          <EuiText size="xs" color="subdued">
            -
          </EuiText>
        ),
    },
    {
      field: 'traceId',
      name: i18n.translate('agentTraces.evalsPage.colTarget', { defaultMessage: 'Target' }),
      render: (_id: string, r: ResultRow) => <TargetText result={r} />,
    },
    {
      field: 'evaluator',
      name: i18n.translate('agentTraces.evalsPage.colEvaluator', { defaultMessage: 'Evaluator' }),
      truncateText: true,
      render: (evaluator: string, r: ResultRow) => (
        <div className="agtEvlNameCell" title={evaluator}>
          <EuiText size="xs" className="eui-textTruncate">
            {evaluator}
          </EuiText>
          <EuiText size="xs" color="subdued">
            {sourceLabel(r.source)}
          </EuiText>
        </div>
      ),
    },
    {
      field: 'agentOrService',
      name: i18n.translate('agentTraces.evalsPage.colAgent', {
        defaultMessage: 'Agent or service',
      }),
      truncateText: true,
      render: (value: string) => <EuiText size="xs">{value || '-'}</EuiText>,
    },
  ];

  const totalItems = total ?? rows.length;
  return (
    <>
      <EuiText size="xs" color="subdued" data-test-subj="agtEvlResultsTotal">
        {i18n.translate('agentTraces.evalsPage.resultsTotal', {
          defaultMessage: '{total} {count, plural, one {result} other {results}}',
          values: { total: totalItems.toLocaleString(), count: totalItems },
        })}
      </EuiText>
      <EuiSpacer size="xs" />
      {error && <QueryErrorCallout message={error} />}
      <EuiBasicTable<ResultRow>
        items={rows}
        itemId="id"
        columns={columns}
        loading={loading}
        tableLayout="fixed"
        compressed
        className="agtEvlDenseTable"
        pagination={{
          pageIndex,
          pageSize,
          totalItemCount: totalItems,
          pageSizeOptions: RESULTS_PAGE_SIZES,
        }}
        sorting={{ sort: { field: SORT_COLUMN[sort.field], direction: sort.direction } }}
        onChange={({ page, sort: next }: Criteria<ResultRow>) => {
          const field = next ? COLUMN_SORT[String(next.field)] : undefined;
          const nextSort = field ? { field, direction: next?.direction ?? 'desc' } : sort;
          const sortChanged =
            nextSort.field !== sort.field || nextSort.direction !== sort.direction;
          const nextSize = page?.size ?? pageSize;
          onTableChange?.({
            sort: nextSort,
            pageIndex: sortChanged || nextSize !== pageSize ? 0 : (page?.index ?? pageIndex),
            pageSize: nextSize,
          });
        }}
        rowProps={(r: ResultRow) => ({
          onClick: () => onOpenResult(r),
          className: 'agtEvlTable__row',
          'data-test-subj': `agtEvlResultRow-${r.outcome}`,
        })}
        message={i18n.translate('agentTraces.evalsPage.noRows', {
          defaultMessage: 'No results match the filters in this time range.',
        })}
        data-test-subj="agtEvlResultsTable"
      />
    </>
  );
};
