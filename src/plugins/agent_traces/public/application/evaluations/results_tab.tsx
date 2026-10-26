/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { EuiBasicTableColumn, EuiInMemoryTable, EuiText, EuiToolTip } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { EvalResult, normalizedScore } from './eval_data';
import { parseEvalTime } from './eval_aggregations';
import {
  LevelBadge,
  OutcomeBadge,
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

const OUTCOME_RANK = { fail: 0, neutral: 1, pass: 2 };

export const toResultRows = (results: EvalResult[]): ResultRow[] =>
  results.map((r) => ({
    ...r,
    timeMs: parseEvalTime(r.time),
    rank: OUTCOME_RANK[r.outcome] * 10 + (normalizedScore(r) ?? 0.5),
    agentOrService: r.agentName ?? r.serviceName ?? '',
  }));

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 3)}...` : text;

export const ResultsTab: React.FC<{
  results: EvalResult[];
  onOpenResult: (r: EvalResult) => void;
}> = ({ results, onOpenResult }) => {
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
      truncateText: true,
      render: (name: string) => <strong>{name}</strong>,
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
      render: (_rank: number, r: ResultRow) => <OutcomeBadge result={r} />,
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
      sortable: true,
      truncateText: true,
      render: (evaluator: string, r: ResultRow) => (
        <div>
          <EuiText size="xs">{evaluator}</EuiText>
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
      sortable: true,
      truncateText: true,
      render: (value: string) => <EuiText size="xs">{value || '-'}</EuiText>,
    },
  ];

  return (
    <EuiInMemoryTable<ResultRow>
      items={rows}
      itemId="id"
      columns={columns}
      tableLayout="auto"
      pagination={{ initialPageSize: 25, pageSizeOptions: [25, 50, 100] }}
      sorting={{ sort: { field: 'timeMs', direction: 'desc' } }}
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
  );
};
