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

export interface RowEvaluations {
  /** Trace- and session-level results by trace id, plus span results of that trace. */
  byTraceId: Map<string, EvalResult[]>;
  bySpanId: Map<string, EvalResult[]>;
  /** `trace`: top-level rows are traces (agent runs). `span`: every row is a span. */
  mode: 'trace' | 'span';
}

const EMPTY: RowEvaluations = { byTraceId: new Map(), bySpanId: new Map(), mode: 'trace' };
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
  return { byTraceId, bySpanId, mode };
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
  const [value, setValue] = useState<RowEvaluations>(EMPTY);
  const key = useMemo(
    () => Array.from(new Set(traceIds)).slice(0, MAX_TRACE_IDS).sort().join(','),
    [traceIds]
  );

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
    fetchEvalResults(ppl, buildTracesEvalsQuery(key.split(',')))
      .then((results) => !controller.signal.aborted && setValue(indexRowEvaluations(results, mode)))
      .catch(() => !controller.signal.aborted && setValue({ ...EMPTY, mode }));
    return () => controller.abort();
  }, [key, mode, services?.data]);

  return <RowEvaluationsContext.Provider value={value}>{children}</RowEvaluationsContext.Provider>;
};
