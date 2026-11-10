/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../types';
import {
  PplRecord,
  Tally,
  addToTally,
  emptyTally,
  get,
  num,
  str,
} from '../../evaluations/eval_model';
import { F, buildTracesTallyQuery } from '../../evaluations/ppl_queries';
import { useEvalsDataSource, useEvalsIndexPattern } from '../../evaluations/eval_dataset';
import { evalsDataset, runPpl } from '../../evaluations/use_ppl_rows';

export interface RowEvaluations {
  /** Tally per trace id (trace rows). */
  byTraceId: Map<string, Tally>;
  /** Tally per span id (span rows). */
  bySpanId: Map<string, Tally>;
  /** `trace`: rows are traces. `span`: every row is a span. */
  mode: 'trace' | 'span';
  /**
   * Traces listed as several agent-run rows (parallel agents under one root). Their rows show
   * `byRunSpanId`, not the whole trace's tally.
   */
  splitTraceIds: Set<string>;
  /** Tally per agent-run row of a split trace, by the row's span id: the results in its subtree. */
  byRunSpanId: Map<string, Tally>;
  /**
   * Per split trace, its results that count toward none of its runs (on the trace, or on the
   * shared root), so the run rows can say they exist.
   */
  outsideRunsByTraceId: Map<string, number>;
}

/** A level-0 row of the Traces table: an agent run, or the whole trace. */
export interface AgentRunRow {
  traceId: string;
  spanId: string;
}

/** A span's place in its trace's tree. */
export interface SpanParent {
  traceId: string;
  spanId: string;
  parentSpanId: string;
}

const EMPTY: RowEvaluations = {
  byTraceId: new Map(),
  bySpanId: new Map(),
  mode: 'trace',
  splitTraceIds: new Set(),
  byRunSpanId: new Map(),
  outsideRunsByTraceId: new Map(),
};

/** The traces listed as more than one agent-run row. */
export const splitTraceIdsOf = (runs: AgentRunRow[]): Set<string> => {
  const spansByTrace = new Map<string, Set<string>>();
  runs.forEach(({ traceId, spanId }) => {
    if (!traceId || !spanId) return;
    const spans = spansByTrace.get(traceId) ?? new Set<string>();
    spans.add(spanId);
    spansByTrace.set(traceId, spans);
  });
  return new Set(
    Array.from(spansByTrace.entries())
      .filter(([, spans]) => spans.size > 1)
      .map(([traceId]) => traceId)
  );
};

const spanKey = (traceId: string, spanId: string) => `${traceId}\u0000${spanId}`;

/**
 * Per-span tally rows (`buildTracesTallyQuery` by span) counted on the agent run each span sits
 * under: the nearest ancestor (or the span itself) that is a listed run. A result outside every
 * listed run (on the shared root, or without a span) counts on none of them; the trace's
 * Evaluations tab lists it.
 */
export const tallyByRun = (
  rows: PplRecord[],
  runs: AgentRunRow[],
  parents: SpanParent[]
): Map<string, Tally> => {
  const runKeys = new Set(runs.map((r) => spanKey(r.traceId, r.spanId)));
  const parentOf = new Map(
    parents.map((p) => [spanKey(p.traceId, p.spanId), p.parentSpanId] as const)
  );
  const byRun = new Map<string, Tally>();
  rows.forEach((row) => {
    const traceId = str(get(row, F.traceId));
    let spanId: string | undefined = str(get(row, F.spanId));
    if (!traceId) return;
    const seen = new Set<string>();
    while (spanId && !seen.has(spanId)) {
      if (runKeys.has(spanKey(traceId, spanId))) {
        byRun.set(
          spanId,
          addToTally(byRun.get(spanId) ?? emptyTally(), row.verdict, num(row.n) ?? 0)
        );
        return;
      }
      seen.add(spanId);
      spanId = parentOf.get(spanKey(traceId, spanId));
    }
  });
  return byRun;
};

/**
 * Per split trace, how many of its results (`byTraceId`) count toward none of its runs
 * (`byRun`). Traces where every result sits under a run are left out.
 */
export const outsideRunsOf = (
  byTraceId: Map<string, Tally>,
  runs: AgentRunRow[],
  byRun: Map<string, Tally>
): Map<string, number> => {
  const placed = new Map<string, number>();
  runs.forEach(({ traceId, spanId }) =>
    placed.set(traceId, (placed.get(traceId) ?? 0) + (byRun.get(spanId)?.n ?? 0))
  );
  const outside = new Map<string, number>();
  placed.forEach((n, traceId) => {
    const rest = (byTraceId.get(traceId)?.n ?? 0) - n;
    if (rest > 0) outside.set(traceId, rest);
  });
  return outside;
};

/**
 * The span parents of a `fetchSpanParents` answer read with `head limit + 1`, or a rejection when
 * the answer was cut (more than `limit` spans) or empty (the traces' spans are not readable).
 */
export const completeSpanParents = (
  spans: Array<{ traceId: string; spanId: string; parentSpanId?: string }>,
  limit: number
): SpanParent[] => {
  if (spans.length === 0) throw new Error('No span parents');
  if (spans.length > limit) throw new Error('Span parents truncated');
  return spans.map(({ traceId, spanId, parentSpanId }) => ({
    traceId,
    spanId,
    parentSpanId: parentSpanId ?? '',
  }));
};

const RowEvaluationsContext = createContext<RowEvaluations>(EMPTY);

export const useRowEvaluations = () => useContext(RowEvaluationsContext);

/**
 * At most this many trace ids per lookup. The table can list more rows (`discover:sampleSize`,
 * and a page of spans covers many traces), so the ids are looked up in chunks: one query per
 * chunk, never one per row.
 */
export const TRACE_IDS_PER_QUERY = 200;

/** The distinct ids, sorted, in chunks of `size`. */
export const chunkTraceIds = (ids: string[], size = TRACE_IDS_PER_QUERY): string[][] => {
  const distinct = Array.from(new Set(ids.filter(Boolean))).sort();
  const chunks: string[][] = [];
  for (let i = 0; i < distinct.length; i += size) chunks.push(distinct.slice(i, i + size));
  return chunks;
};

/** The rows of every chunk, or a rejection when any chunk failed (nothing partial). */
export const allRows = async (chunks: Array<Promise<PplRecord[]>>): Promise<PplRecord[]> =>
  (await Promise.all(chunks)).flat();

/**
 * The rows of the chunks that answered: one failed chunk (a throttle, a shard failure) does not
 * blank the rows the others found. Rejects only when every chunk failed.
 */
export const settledRows = async (chunks: Array<Promise<PplRecord[]>>): Promise<PplRecord[]> => {
  const settled = await Promise.allSettled(chunks);
  const answered = settled.filter(
    (r): r is PromiseFulfilledResult<PplRecord[]> => r.status === 'fulfilled'
  );
  if (settled.length > 0 && answered.length === 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  return answered.flatMap((r) => r.value);
};

/** Tallies from `buildTracesTallyQuery` rows. */
export const indexRowTallies = (
  rows: PplRecord[],
  mode: RowEvaluations['mode'] = 'trace'
): RowEvaluations => {
  const byTraceId = new Map<string, Tally>();
  const bySpanId = new Map<string, Tally>();
  rows.forEach((row) => {
    const n = num(row.n) ?? 0;
    const traceId = str(get(row, F.traceId));
    const spanId = str(get(row, F.spanId));
    if (traceId)
      byTraceId.set(traceId, addToTally(byTraceId.get(traceId) ?? emptyTally(), row.verdict, n));
    if (spanId)
      bySpanId.set(spanId, addToTally(bySpanId.get(spanId) ?? emptyTally(), row.verdict, n));
  });
  return { ...EMPTY, byTraceId, bySpanId, mode };
};

/**
 * The Evaluations column: one aggregation (count by trace id, or by span id, and verdict) for
 * the traces of the visible page, from the start of the range to now (results land after the
 * traces). A missing eval index, or every chunk failing, leaves the column empty; a chunk that
 * failed only leaves its own rows without a tally.
 *
 * In trace mode, a trace listed as several agent-run rows (`agentRuns`) gets one tally per run:
 * its results are counted by span and placed under the run each span descends from, using the
 * spans' parents (`fetchSpanParents`, one query per chunk of such traces). These lookups run in
 * their own effect, so a change in the listed runs does not repeat the per-trace lookup. If any
 * of them fails (or `fetchSpanParents` rejects because the parents are incomplete), every split
 * row falls back to the whole trace's tally: per-run tallies are never built from part of the
 * results or part of the tree.
 */
export const RowEvaluationsProvider: React.FC<{
  traceIds: string[];
  mode?: RowEvaluations['mode'];
  agentRuns?: AgentRunRow[];
  fetchSpanParents?: (traceIds: string[], signal: AbortSignal) => Promise<SpanParent[]>;
}> = ({ traceIds, mode = 'trace', agentRuns, fetchSpanParents, children }) => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const index = useEvalsIndexPattern();
  const dataSource = useEvalsDataSource();
  const [traceTallies, setTraceTallies] = useState<RowEvaluations>(EMPTY);
  const [runTallies, setRunTallies] = useState<{ key: string; byRun: Map<string, Tally> }>();
  const key = useMemo(() => Array.from(new Set(traceIds)).sort().join(','), [traceIds]);
  // The runs of split traces only: other traces' rows do not change the lookups.
  const splitRuns = useMemo(() => {
    if (mode !== 'trace' || !agentRuns) return [];
    const split = splitTraceIdsOf(agentRuns);
    return agentRuns.filter((r) => split.has(r.traceId));
  }, [agentRuns, mode]);
  const splitKey = useMemo(
    () =>
      splitRuns
        .map((r) => spanKey(r.traceId, r.spanId))
        .sort()
        .join(','),
    [splitRuns]
  );
  const fetchParentsRef = useRef(fetchSpanParents);
  fetchParentsRef.current = fetchSpanParents;

  const rangeOf = useCallback(() => {
    const timefilter = services.data.query.timefilter.timefilter;
    const from = timefilter.calculateBounds(timefilter.getTime()).min?.toISOString() ?? 'now-7d';
    return { from, to: new Date().toISOString() };
  }, [services?.data]);
  const tally = useCallback(
    (ids: string[], bySpan: boolean, signal: AbortSignal) =>
      runPpl(
        services.data,
        evalsDataset(index ?? '', dataSource),
        buildTracesTallyQuery(index ?? '', ids, bySpan),
        rangeOf(),
        signal
      ),
    [services?.data, index, dataSource, rangeOf]
  );

  // The per-trace (or per-span) tallies of the listed rows.
  useEffect(() => {
    if (!key || !services?.data || !index) {
      setTraceTallies({ ...EMPTY, mode });
      return;
    }
    const controller = new AbortController();
    settledRows(
      chunkTraceIds(key.split(',')).map((ids) => tally(ids, mode === 'span', controller.signal))
    )
      .then((rows) => !controller.signal.aborted && setTraceTallies(indexRowTallies(rows, mode)))
      .catch(() => !controller.signal.aborted && setTraceTallies({ ...EMPTY, mode }));
    return () => controller.abort();
  }, [key, mode, services?.data, index, tally]);

  // The per-run tallies of split traces.
  useEffect(() => {
    setRunTallies(undefined);
    const fetchParents = fetchParentsRef.current;
    if (!splitKey || !fetchParents || !services?.data || !index) return;
    const controller = new AbortController();
    const chunks = chunkTraceIds(splitRuns.map((r) => r.traceId));
    Promise.all([
      allRows(chunks.map((ids) => tally(ids, true, controller.signal))),
      Promise.all(chunks.map((ids) => fetchParents(ids, controller.signal))),
    ])
      .then(([rows, parents]) => {
        if (controller.signal.aborted) return;
        setRunTallies({ key: splitKey, byRun: tallyByRun(rows, splitRuns, parents.flat()) });
      })
      .catch(() => undefined);
    return () => controller.abort();
    // splitRuns is read through splitKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitKey, services?.data, index, tally]);

  const value = useMemo<RowEvaluations>(() => {
    if (!runTallies || runTallies.key !== splitKey) return traceTallies;
    return {
      ...traceTallies,
      splitTraceIds: splitTraceIdsOf(splitRuns),
      byRunSpanId: runTallies.byRun,
      outsideRunsByTraceId: outsideRunsOf(traceTallies.byTraceId, splitRuns, runTallies.byRun),
    };
  }, [traceTallies, runTallies, splitKey, splitRuns]);

  return <RowEvaluationsContext.Provider value={value}>{children}</RowEvaluationsContext.Provider>;
};
