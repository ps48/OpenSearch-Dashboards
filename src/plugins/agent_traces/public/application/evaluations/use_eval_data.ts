/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { DataPublicPluginStart } from '../../../../data/public';
import { pplResponseToRecords } from '../pages/sessions/session_utils';
import {
  EVALS_DATASET,
  EVAL_FIELDS,
  EvalFilters,
  EvalResult,
  buildEvalFacetsQuery,
  buildEvalResultsQuery,
  createEvalsPplService,
  fetchEvalResults,
} from './eval_data';
import { TimeBoundsMs, applyClientFilters, previousPeriod } from './eval_aggregations';

/** Results read per period; aggregates over more results say they use the latest ones. */
export const RESULTS_LIMIT = 5000;
/** Results read for the Evaluation runs tab. */
export const RUN_RESULTS_LIMIT = 10000;

/** Readable message of a failed PPL request (the engine's reason when it sent one). */
export const errorMessage = (error: unknown): string => {
  if (!error) return '';
  const e = error as { body?: { message?: unknown }; message?: unknown };
  const raw = String(e.body?.message ?? e.message ?? error);
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { reason?: string; details?: string };
      };
      const reason = parsed.error?.details || parsed.error?.reason;
      if (reason) return reason;
    } catch {
      // not JSON: use the raw message
    }
  }
  return raw;
};

/** Whether the error says the evaluation index does not exist yet. */
export const isIndexMissing = (error: unknown): boolean =>
  /no such index|index_not_found|IndexNotFound/i.test(
    `${errorMessage(error)} ${String((error as { message?: unknown })?.message ?? '')}`
  );

export interface Facet {
  name: string;
  level: string;
  source: string;
  count: number;
}

const toFacets = (response: unknown): Facet[] =>
  pplResponseToRecords(response).map((row) => ({
    name: String(row[EVAL_FIELDS.name] ?? ''),
    level: String(row[EVAL_FIELDS.level] ?? ''),
    source: String(row[EVAL_FIELDS.source] ?? ''),
    count: Number(row.results ?? 0),
  }));

const isoRange = ({ from, to }: TimeBoundsMs) => ({
  from: new Date(from).toISOString(),
  to: new Date(to).toISOString(),
});

export interface EvalData {
  loading: boolean;
  error?: string;
  indexMissing: boolean;
  /** Results in the time range under the filters, newest first (at most RESULTS_LIMIT). */
  results: EvalResult[];
  /** Same for the previous equal period, for deltas. */
  previous: EvalResult[];
  /** Results in the range under the server-side filters (exact, from an aggregation). */
  total?: number;
  /** Evaluation names, levels and sources present in the range (filter options). */
  facets: Facet[];
  /** More results matched than were read. */
  truncated: boolean;
}

const EMPTY: EvalData = {
  loading: true,
  indexMissing: false,
  results: [],
  previous: [],
  facets: [],
  truncated: false,
};

/** Fetch the current and previous period's results plus the filter facets. */
export const useEvalData = (
  data: DataPublicPluginStart,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  refreshKey: number
): EvalData => {
  const [state, setState] = useState<EvalData>(EMPTY);
  const serverFilters = useMemo(
    () => ({
      names: filters.names,
      levels: filters.levels,
      sources: filters.sources,
      search: filters.search,
    }),
    [filters.names, filters.levels, filters.sources, filters.search]
  );
  const key = JSON.stringify([bounds, serverFilters, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const current = createEvalsPplService(data, isoRange(bounds), controller.signal);
    const before = createEvalsPplService(data, isoRange(previousPeriod(bounds)), controller.signal);
    const query = buildEvalResultsQuery(serverFilters, RESULTS_LIMIT);
    Promise.all([
      fetchEvalResults(current, query),
      fetchEvalResults(before, query),
      current.executeQuery(EVALS_DATASET, buildEvalFacetsQuery()),
      current.executeQuery(EVALS_DATASET, buildEvalFacetsQuery(serverFilters)),
    ])
      .then(([results, previous, allFacets, filteredFacets]) => {
        if (controller.signal.aborted) return;
        const total = toFacets(filteredFacets).reduce((n, f) => n + f.count, 0);
        setState({
          loading: false,
          indexMissing: false,
          results,
          previous,
          total,
          facets: toFacets(allFacets),
          truncated: total > results.length,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          ...EMPTY,
          loading: false,
          indexMissing: isIndexMissing(error),
          error: errorMessage(error),
        });
      });
    return () => controller.abort();
    // `key` captures bounds, filters and refreshKey by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);

  return useMemo(
    () => ({
      ...state,
      results: applyClientFilters(state.results, filters),
      previous: applyClientFilters(state.previous, filters),
    }),
    [state, filters]
  );
};

export interface RunData {
  loading: boolean;
  error?: string;
  indexMissing: boolean;
  results: EvalResult[];
  truncated: boolean;
}

/** Results that belong to evaluation runs in the time range. */
export const useRunResults = (
  data: DataPublicPluginStart,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  refreshKey: number,
  /** Fetch only while the runs tab is shown. */
  enabled = true
): RunData => {
  const [state, setState] = useState<RunData>({
    loading: true,
    indexMissing: false,
    results: [],
    truncated: false,
  });
  const key = JSON.stringify([bounds, filters.names, filters.search, refreshKey]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const ppl = createEvalsPplService(data, isoRange(bounds), controller.signal);
    // Level, source and outcome filters do not apply: a run is compared on all its results.
    fetchEvalResults(
      ppl,
      buildEvalResultsQuery(
        { names: filters.names, search: filters.search, runsOnly: true },
        RUN_RESULTS_LIMIT
      )
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          indexMissing: false,
          results,
          truncated: results.length >= RUN_RESULTS_LIMIT,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          indexMissing: isIndexMissing(error),
          error: errorMessage(error),
          results: [],
          truncated: false,
        });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, enabled]);
  return state;
};
