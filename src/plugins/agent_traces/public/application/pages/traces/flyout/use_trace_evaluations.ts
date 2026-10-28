/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useOpenSearchDashboards } from '../../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../../types';
import {
  EvalResult,
  buildTraceEvalsQuery,
  createEvalsPplService,
  failuresFirst,
  fetchEvalResults,
} from '../../../evaluations/eval_data';
import { getEvalsIndexPattern } from '../../../evaluations/eval_settings';

export interface TraceEvaluations {
  /** Every result that judged the trace, one of its spans, or its session. */
  results: EvalResult[];
  /** Results by evaluated span id (span and tool-call levels). */
  bySpanId: Record<string, EvalResult[]>;
  /** Trace-level results. */
  traceResults: EvalResult[];
  /** Session-level results of the trace's session. */
  sessionResults: EvalResult[];
  isLoading: boolean;
  /** Set when the lookup failed; a missing eval index is not an error (no results). */
  error?: string;
}

const EMPTY: Omit<TraceEvaluations, 'isLoading'> = {
  results: [],
  bySpanId: {},
  traceResults: [],
  sessionResults: [],
};

/** Results by trace and session, so reopening a trace (Back, Forward) does not refetch. */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 50;
const cache = new Map<string, { at: number; results: EvalResult[] }>();
/** For tests. */
export const clearTraceEvaluationsCache = () => cache.clear();

const isMissingIndex = (message: string) =>
  /no such index|index_not_found|IndexNotFound|not found/i.test(message);

export const groupTraceEvaluations = (
  results: EvalResult[],
  traceId: string,
  sessionId?: string
): Omit<TraceEvaluations, 'isLoading' | 'error'> => {
  const ordered = failuresFirst(results);
  const bySpanId: Record<string, EvalResult[]> = {};
  const traceResults: EvalResult[] = [];
  const sessionResults: EvalResult[] = [];
  ordered.forEach((r) => {
    if (r.level === 'session') {
      if (!sessionId || r.sessionId === sessionId) sessionResults.push(r);
    } else if (r.traceId === traceId && r.spanId && r.level !== 'trace') {
      (bySpanId[r.spanId] = bySpanId[r.spanId] ?? []).push(r);
    } else if (r.traceId === traceId) {
      traceResults.push(r);
    }
  });
  // Only what the flyout shows: results of the session's other traces stay with those traces.
  const shown = failuresFirst([
    ...sessionResults,
    ...traceResults,
    ...Object.values(bySpanId).flat(),
  ]);
  return { results: shown, bySpanId, traceResults, sessionResults };
};

/**
 * Evaluation results (`gen_ai.evaluation.result` events) that judged this trace, its spans, or
 * its session. Not time-bounded: evaluations often run long after the trace.
 */
export const useTraceEvaluations = (
  traceId: string | undefined,
  sessionId?: string
): TraceEvaluations => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const index = getEvalsIndexPattern(services?.uiSettings);
  const [state, setState] = useState<{ results: EvalResult[]; isLoading: boolean; error?: string }>(
    { results: [], isLoading: false }
  );

  useEffect(() => {
    if (!traceId || !services?.data) {
      setState({ results: [], isLoading: false });
      return;
    }
    const key = `${index}|${traceId}|${sessionId ?? ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      setState({ results: hit.results, isLoading: false });
      return;
    }
    const controller = new AbortController();
    setState({ results: [], isLoading: true });
    // A wide range: the PPL service otherwise applies the global time filter.
    const ppl = createEvalsPplService(
      services.data,
      { from: 'now-90d', to: 'now+1d' },
      controller.signal
    );
    fetchEvalResults(ppl, buildTraceEvalsQuery(traceId, sessionId, 200, index), index)
      .then((results) => {
        cache.delete(key);
        cache.set(key, { at: Date.now(), results });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        if (!controller.signal.aborted) setState({ results, isLoading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({
          results: [],
          isLoading: false,
          error: isMissingIndex(message) ? undefined : message,
        });
      });
    return () => controller.abort();
  }, [traceId, sessionId, services?.data, index]);

  return useMemo(
    () => ({
      ...(traceId ? groupTraceEvaluations(state.results, traceId, sessionId) : EMPTY),
      isLoading: state.isLoading,
      error: state.error,
    }),
    [state, traceId, sessionId]
  );
};
