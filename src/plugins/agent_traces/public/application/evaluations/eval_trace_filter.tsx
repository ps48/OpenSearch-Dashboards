/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState } from 'react';
import {
  EuiBadge,
  EuiButtonIcon,
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiPopover,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { DataPublicPluginStart } from '../../../../data/public';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { EvalFilters, EvalOutcome, createEvalsPplService } from './eval_data';
import { buildMatchingTraceIdsQuery, executeEvalPpl } from './eval_ppl';
import { OUTCOME_TEXT, formatEvalTime, formatValue, shortId } from './eval_components';
import { EvalTraceFilter, setEvalTraceFilter, useEvalTraceFilter } from './eval_trace_filter_store';

/** A condition on one evaluation's results whose traces Agent Traces can list. */
export interface TraceCondition {
  /** The evaluation; absent for a chart of all evaluations (kind `results`). */
  name?: string;
  /** `results`: the results behind a chart point (an evaluation, a verdict, a bucket). */
  kind: 'fail' | 'label' | 'below' | 'above' | 'results';
  label?: string;
  value?: number;
  /** `results`: only this verdict. */
  outcome?: EvalOutcome;
  /** `results`: only this evaluation run. */
  runId?: string;
  /** A time range of its own (a chart bucket), epoch millis; else the page's range. */
  timeRange?: { from: number; to: number };
}

/** Trace ids read for a condition; the pill says "first 500" when more matched. */
export const MAX_FILTER_TRACES = 500;

const bucketText = (range?: { from: number; to: number }) =>
  range
    ? `${formatEvalTime(range.from, 'MMM D, HH:mm')} to ${formatEvalTime(range.to, 'MMM D, HH:mm')}`
    : '';

export const conditionText = (c: TraceCondition): string => {
  switch (c.kind) {
    case 'results':
      return [
        c.name ??
          i18n.translate('agentTraces.evals.conditionAll', {
            defaultMessage: 'All evaluations',
          }),
        c.outcome ? OUTCOME_TEXT[c.outcome].toLowerCase() : undefined,
        c.runId ? shortId(c.runId, 28) : undefined,
        bucketText(c.timeRange) || undefined,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'fail':
      return i18n.translate('agentTraces.evals.conditionFail', {
        defaultMessage: '{name}: fail',
        values: { name: c.name },
      });
    case 'label':
      return i18n.translate('agentTraces.evals.conditionLabel', {
        defaultMessage: '{name} = {label}',
        values: { name: c.name, label: c.label ?? '' },
      });
    case 'below':
      return `${c.name} < ${formatValue(c.value)}`;
    case 'above':
      return `${c.name} > ${formatValue(c.value)}`;
  }
};

export const conditionFilters = (c: TraceCondition): EvalFilters => ({
  ...(c.name ? { names: [c.name] } : {}),
  ...(c.kind === 'results' && c.outcome ? { outcomes: [c.outcome] } : {}),
  ...(c.kind === 'results' && c.runId ? { runIds: [c.runId] } : {}),
  ...(c.kind === 'fail' ? { outcomes: ['fail' as const] } : {}),
  ...(c.kind === 'label' && c.label ? { labels: [c.label] } : {}),
  ...(c.kind === 'below' ? { valueBelow: c.value } : {}),
  ...(c.kind === 'above' ? { valueAbove: c.value } : {}),
});

/**
 * Distinct traces judged by results matching the condition in the time range, newest first,
 * at most `MAX_FILTER_TRACES`.
 */
export const fetchConditionTraces = async (
  data: DataPublicPluginStart,
  condition: TraceCondition,
  timeRange: { from: string; to: string },
  index: string = AGENT_EVALS_INDEX_PATTERN,
  signal?: AbortSignal
): Promise<EvalTraceFilter> => {
  // A chart point carries its own bucket.
  const range = condition.timeRange
    ? {
        from: new Date(condition.timeRange.from).toISOString(),
        to: new Date(condition.timeRange.to).toISOString(),
      }
    : timeRange;
  const ppl = createEvalsPplService(data, range, signal);
  const rows = await executeEvalPpl(ppl, index, (missing, source) =>
    buildMatchingTraceIdsQuery(conditionFilters(condition), MAX_FILTER_TRACES, {
      index: source,
      missing,
    })
  );
  const latest = new Map<string, string>();
  rows.forEach((row) => {
    const id = row['attributes.derived.evaluation.target_trace_id'];
    const last = String(row.last ?? '');
    if (typeof id === 'string' && id && (latest.get(id) ?? '') < last) latest.set(id, last);
  });
  const ids = Array.from(latest.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([id]) => id);
  return {
    label: conditionText(condition),
    traceIds: ids.slice(0, MAX_FILTER_TRACES),
    capped: ids.length > MAX_FILTER_TRACES,
  };
};

/**
 * How a view lists traces for a condition: the Evaluations page opens Agent Traces, the
 * Agent Traces page filters itself. Absent: no menu.
 */
export const ShowTracesContext = createContext<((c: TraceCondition) => void) | undefined>(
  undefined
);
export const useShowTraces = () => useContext(ShowTracesContext);

/** The conditions offered for a result or an evaluation. */
export const conditionsFor = (target: {
  name: string;
  label?: string;
  value?: number;
}): TraceCondition[] => {
  const out: TraceCondition[] = [{ name: target.name, kind: 'fail' }];
  if (target.label) out.push({ name: target.name, kind: 'label', label: target.label });
  if (target.value !== undefined && Number.isFinite(target.value)) {
    out.push({ name: target.name, kind: 'below', value: target.value });
    out.push({ name: target.name, kind: 'above', value: target.value });
  }
  return out;
};

const menuText = (c: TraceCondition): string => {
  switch (c.kind) {
    case 'results':
      return i18n.translate('agentTraces.evals.menuResults', {
        defaultMessage: 'Show these traces',
      });
    case 'fail':
      return i18n.translate('agentTraces.evals.menuFail', {
        defaultMessage: 'Show traces where {name} fails',
        values: { name: c.name },
      });
    case 'label':
      return i18n.translate('agentTraces.evals.menuLabel', {
        defaultMessage: 'Show traces with label "{label}"',
        values: { label: c.label ?? '' },
      });
    case 'below':
      return i18n.translate('agentTraces.evals.menuBelow', {
        defaultMessage: 'Show traces with value below {value}',
        values: { value: formatValue(c.value) },
      });
    case 'above':
      return i18n.translate('agentTraces.evals.menuAbove', {
        defaultMessage: 'Show traces with value above {value}',
        values: { value: formatValue(c.value) },
      });
  }
};

/** A small menu button: the trace lists a result or an evaluation leads to. */
export const ShowTracesMenu: React.FC<{
  name: string;
  label?: string;
  value?: number;
  /** Several labels (an evaluation card): one item per label. */
  labels?: string[];
}> = ({ name, label, value, labels }) => {
  const showTraces = useShowTraces();
  const [open, setOpen] = useState(false);
  if (!showTraces) return null;
  const conditions = [
    ...conditionsFor({ name, label, value }),
    ...(labels ?? [])
      .filter((l) => l !== label)
      .map((l): TraceCondition => ({ name, kind: 'label', label: l })),
  ];
  return (
    <EuiPopover
      isOpen={open}
      closePopover={() => setOpen(false)}
      panelPaddingSize="none"
      anchorPosition="downLeft"
      button={
        <EuiButtonIcon
          iconType="boxesHorizontal"
          size="xs"
          color="text"
          aria-label={i18n.translate('agentTraces.evals.menuAria', {
            defaultMessage: 'Traces for {name}',
            values: { name },
          })}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          data-test-subj="agtEvlShowTracesButton"
        />
      }
    >
      <EuiContextMenuPanel
        size="s"
        items={conditions.map((c) => (
          <EuiContextMenuItem
            key={`${c.kind}|${c.label ?? ''}|${c.value ?? ''}`}
            icon="apmTrace"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setOpen(false);
              showTraces(c);
            }}
            data-test-subj={`agtEvlShowTraces-${c.kind}`}
          >
            {menuText(c)}
          </EuiContextMenuItem>
        ))}
      />
    </EuiPopover>
  );
};

/** The active evaluation filter of Agent Traces, as a removable pill. */
export const EvalTraceFilterPill: React.FC<{ onRemove: () => void }> = ({ onRemove }) => {
  const filter = useEvalTraceFilter();
  if (!filter) return null;
  const count = filter.capped
    ? i18n.translate('agentTraces.evals.filterFirst', {
        defaultMessage: 'first {count} traces',
        values: { count: filter.traceIds.length },
      })
    : i18n.translate('agentTraces.evals.filterCount', {
        defaultMessage: '{count} {count, plural, one {trace} other {traces}}',
        values: { count: filter.traceIds.length },
      });
  return (
    <EuiBadge
      color="hollow"
      iconType="cross"
      iconSide="right"
      iconOnClick={() => {
        setEvalTraceFilter(undefined);
        onRemove();
      }}
      iconOnClickAriaLabel={i18n.translate('agentTraces.evals.filterRemove', {
        defaultMessage: 'Remove the evaluation filter',
      })}
      className="agtEvlFilterPill"
      data-test-subj="agtEvlTraceFilterPill"
    >
      {i18n.translate('agentTraces.evals.filterPill', {
        defaultMessage: 'Evaluation: {condition} · {count}',
        values: { condition: filter.label, count },
      })}
    </EuiBadge>
  );
};
