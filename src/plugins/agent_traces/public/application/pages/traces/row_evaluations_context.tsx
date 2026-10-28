/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../types';
import {
  EvalResult,
  buildTracesEvalsQuery,
  createEvalsPplService,
  fetchEvalResults,
} from '../../evaluations/eval_data';
import { getEvalsIndexPattern } from '../../evaluations/eval_settings';

export interface RowEvaluations {
  /** Trace- and session-level results by trace id, plus span results of that trace. */
  byTraceId: Map<string, EvalResult[]>;
  bySpanId: Map<string, EvalResult[]>;
  /** `trace`: top-level rows are traces (agent runs). `span`: every row is a span. */
  mode: 'trace' | 'span';
  /** Listed rows per trace id: above 1, a trace holds several agent runs (an offline run). */
  rowsByTraceId: Map<string, number>;
}

const EMPTY: RowEvaluations = {
  byTraceId: new Map(),
  bySpanId: new Map(),
  mode: 'trace',
  rowsByTraceId: new Map(),
};

/**
 * Results to show on a top-level row. When the trace holds one agent run, all of the trace's
 * results. When it holds several (an offline evaluation run is one trace), only the results
 * of this run: on its span or on its parent (the test case), plus results without a span.
 */
export const rowResults = (
  value: RowEvaluations,
  row: { traceId: string; spanId: string; parentSpanId: string | null }
): EvalResult[] => {
  const results = value.byTraceId.get(row.traceId) ?? [];
  if ((value.rowsByTraceId.get(row.traceId) ?? 1) <= 1) return results;
  return results.filter(
    (r) => !r.spanId || r.spanId === row.spanId || r.spanId === row.parentSpanId
  );
};
const RowEvaluationsContext = createContext<RowEvaluations>(EMPTY);

export const useRowEvaluations = () => useContext(RowEvaluationsContext);

/** At most this many trace ids per lookup; the table shows one page of traces. */
const MAX_TRACE_IDS = 200;

export const indexRowEvaluations = (
  results: EvalResult[],
  mode: RowEvaluations['mode'] = 'trace'
): RowEvaluations => {
  const byTraceId = new Map<string, EvalResult[]>();
  const bySpanId = new Map<string, EvalResult[]>();
  results.forEach((r) => {
    if (r.traceId) byTraceId.set(r.traceId, [...(byTraceId.get(r.traceId) ?? []), r]);
    if (r.spanId && (r.level === 'span' || r.level === 'tool_call')) {
      bySpanId.set(r.spanId, [...(bySpanId.get(r.spanId) ?? []), r]);
    }
  });
  return { byTraceId, bySpanId, mode, rowsByTraceId: new Map() };
};

/**
 * Loads the evaluation results of the listed traces in one PPL query, for the Evaluations
 * column. A missing eval index or a failed lookup leaves the column empty.
 */
export const RowEvaluationsProvider: React.FC<{
  traceIds: string[];
  mode?: RowEvaluations['mode'];
}> = ({ traceIds, mode = 'trace', children }) => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const index = getEvalsIndexPattern(services?.uiSettings);
  const [value, setValue] = useState<RowEvaluations>(EMPTY);
  const key = useMemo(
    () => Array.from(new Set(traceIds)).slice(0, MAX_TRACE_IDS).sort().join(','),
    [traceIds]
  );
  const rowsByTraceId = useMemo(() => {
    const counts = new Map<string, number>();
    traceIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    return counts;
  }, [traceIds]);

  useEffect(() => {
    if (!key || !services?.data) {
      setValue({ ...EMPTY, mode });
      return;
    }
    const controller = new AbortController();
    // Evaluations can land long after the trace, so the lookup is not bound to the time filter.
    const ppl = createEvalsPplService(
      services.data,
      { from: 'now-90d', to: 'now+1d' },
      controller.signal
    );
    fetchEvalResults(ppl, buildTracesEvalsQuery(key.split(','), 1000, index), index)
      .then((results) => !controller.signal.aborted && setValue(indexRowEvaluations(results, mode)))
      .catch(() => !controller.signal.aborted && setValue({ ...EMPTY, mode }));
    return () => controller.abort();
  }, [key, mode, services?.data, index]);

  const withRows = useMemo(() => ({ ...value, rowsByTraceId }), [value, rowsByTraceId]);
  return (
    <RowEvaluationsContext.Provider value={withRows}>{children}</RowEvaluationsContext.Provider>
  );
};
