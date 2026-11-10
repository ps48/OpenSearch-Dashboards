/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useOpenSearchDashboards } from '../../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../../types';
import { EvalResult, recordsToResults } from '../../../evaluations/eval_model';
import { buildSessionResultsQuery, buildTraceResultsQuery } from '../../../evaluations/ppl_queries';
import { useEvalsDataSource, useEvalsIndexPattern } from '../../../evaluations/eval_dataset';
import { errorMessage, evalsDataset, runPpl } from '../../../evaluations/use_ppl_rows';

export interface TraceEvaluations {
  /** Every result of the trace, failures first. */
  results: EvalResult[];
  /** Results per span id: on the span each points to, else on the trace's AI root. */
  bySpanId: Record<string, EvalResult[]>;
  isLoading: boolean;
  error?: string;
}

const ORDER = { fail: 0, error: 1, pass: 2, scored: 3 };

/**
 * Each result on the span it points to (its `spanId`, whatever its level: a trace-level result
 * of an agent behind an HTTP handler points to the agent span), else, without a span id or with
 * one the tree does not have (`spanIds`, when known), on the trace's AI root (`aiRootSpanId`).
 */
export const groupBySpan = (
  results: EvalResult[],
  aiRootSpanId?: string,
  spanIds?: Set<string>
): Record<string, EvalResult[]> => {
  const out: Record<string, EvalResult[]> = {};
  results.forEach((r) => {
    const spanId = r.spanId && (!spanIds || spanIds.has(r.spanId)) ? r.spanId : aiRootSpanId;
    if (spanId) (out[spanId] = out[spanId] ?? []).push(r);
  });
  return out;
};

const isMissingIndex = (message: string) =>
  /no such index|index_not_found|IndexNotFound/i.test(message);

interface ResultsState {
  results: EvalResult[];
  isLoading: boolean;
  error?: string;
}

/**
 * Results for `buildQuery(index)` (head 200), from the start of the global range to now:
 * results land after what they judge. Nothing runs without a query or an evaluations index.
 */
const useEvalResults = (
  key: string | undefined,
  buildQuery: (index: string, key: string) => string
): ResultsState => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const index = useEvalsIndexPattern();
  const dataSource = useEvalsDataSource();
  const [state, setState] = useState<ResultsState>({ results: [], isLoading: false });

  useEffect(() => {
    if (!key || !services?.data || !index) {
      setState({ results: [], isLoading: false });
      return;
    }
    const controller = new AbortController();
    const timefilter = services.data.query.timefilter.timefilter;
    const from = timefilter.calculateBounds(timefilter.getTime()).min?.toISOString() ?? 'now-7d';
    setState({ results: [], isLoading: true });
    runPpl(
      services.data,
      evalsDataset(index, dataSource),
      buildQuery(index, key),
      { from, to: new Date().toISOString() },
      controller.signal
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const results = recordsToResults(rows).sort(
          (a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.name.localeCompare(b.name)
        );
        setState({ results, isLoading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = errorMessage(error);
        setState({
          results: [],
          isLoading: false,
          error: isMissingIndex(message) ? undefined : message,
        });
      });
    return () => controller.abort();
    // `buildQuery` is a module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, services?.data, index, dataSource]);

  return state;
};

const traceResultsQuery = (index: string, traceId: string) =>
  buildTraceResultsQuery(index, [traceId]);

/** The session-level results of a session (Agent Traces session view). */
export const useSessionEvaluations = (sessionId: string | undefined): ResultsState =>
  useEvalResults(sessionId, buildSessionResultsQuery);

/**
 * The results of one trace (head 200), from the start of the global range to now: results
 * land after the trace they judge. Only runs when Agent Evaluations is on (an index is set).
 */
export const useTraceEvaluations = (
  traceId: string | undefined,
  aiRootSpanId?: string,
  spanIds?: Set<string>
): TraceEvaluations => {
  const state = useEvalResults(traceId, traceResultsQuery);
  return useMemo(
    () => ({ ...state, bySpanId: groupBySpan(state.results, aiRootSpanId, spanIds) }),
    [state, aiRootSpanId, spanIds]
  );
};
