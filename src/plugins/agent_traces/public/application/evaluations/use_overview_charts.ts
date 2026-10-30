/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data of the Overview's score distribution and judged-trace latency charts. Each loads only
 * while the Overview is shown and keeps its data until the range, a filter or Refresh changes.
 */

import { useEffect, useState } from 'react';
import { DataPublicPluginStart } from '../../../../data/public';
import { PplRecord, pplResponseToRecords } from '../pages/sessions/session_utils';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import {
  EVAL_FIELDS,
  EvalFilters,
  EvalOutcome,
  EvalResult,
  createEvalsPplService,
} from './eval_data';
import { TimeBoundsMs, parseEvalTime, pickInterval } from './eval_aggregations';
import { AGG_ROWS_LIMIT, baseCommands, executeVerdictAgg, fetchEvalResultsWith } from './eval_ppl';
import { Clause, VERDICT_COLUMN } from './eval_verdict';
import { verdictKeyEval, verdictKeyGroups, verdictKeyPlan } from './eval_verdict_keys';
import { spansDataset } from './eval_target';
import { errorMessage } from './use_eval_data';

const isoRange = ({ from, to }: TimeBoundsMs) => ({
  from: new Date(from).toISOString(),
  to: new Date(to).toISOString(),
});
const field = (f: string) => `\`${f}\``;
const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

interface Loadable<T> {
  loading: boolean;
  error?: string;
  value?: T;
}

/** Loaded values by key: the Overview unmounts when another tab opens, its data stays. */
const cache = new Map<string, { value?: unknown; error?: string }>();
const CACHE_SIZE = 20;
const remember = (key: string, entry: { value?: unknown; error?: string }) => {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
};

/** For tests. */
export const clearOverviewChartsCache = () => cache.clear();

/**
 * Runs `load` when enabled and nothing is loaded for `key` yet; a key loaded before (the
 * same range, filters and refresh) comes back from the cache without a query.
 */
const useCachedLoad = <T>(
  key: string | undefined,
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>
): Loadable<T> => {
  const cached = key ? cache.get(key) : undefined;
  const [state, setState] = useState<Loadable<T> & { key?: string }>(() =>
    cached ? { loading: false, key, ...(cached as Loadable<T>) } : { loading: !!key && enabled }
  );
  useEffect(() => {
    if (!enabled || !key) return;
    const hit = cache.get(key);
    if (hit) {
      setState({ loading: false, key, ...(hit as Loadable<T>) });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        remember(key, { value });
        setState({ loading: false, key, value });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = errorMessage(error);
        remember(key, { error: message });
        setState({ loading: false, key, error: message });
      });
    return () => controller.abort();
    // `key` names everything `load` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  if (!key) return { loading: false };
  const current = state.key === key;
  return {
    loading: state.loading || !current,
    error: current ? state.error : undefined,
    value: current ? state.value : undefined,
  };
};

// ---------------------------------------------------------------------------------------
// Score distribution
// ---------------------------------------------------------------------------------------

/** Results of one evaluation counted by value and verdict, with its threshold. */
export interface ValueCount {
  value: number;
  outcome: EvalOutcome;
  count: number;
  threshold?: number;
}

/** Counts of one evaluation's values by value, threshold and what the verdict reads. */
export const buildValueCountsQuery = (
  filters: EvalFilters,
  name: string,
  ctx: { index?: string; missing?: ReadonlySet<string>; clauses?: Clause[] }
): string => {
  const missing = ctx.missing ?? new Set<string>();
  const plan = verdictKeyPlan(ctx.clauses ?? [], missing);
  const evalCommand = verdictKeyEval(plan);
  const groups = [
    field(EVAL_FIELDS.value),
    ...(missing.has(EVAL_FIELDS.threshold) ? [] : [field(EVAL_FIELDS.threshold)]),
  ];
  const by = Array.from(new Set([...groups, ...verdictKeyGroups(plan)]));
  return [
    ...baseCommands({ ...filters, names: [name], outcomes: undefined }, ctx),
    `where isnotnull(${field(EVAL_FIELDS.value)})`,
    ...(evalCommand ? [evalCommand] : []),
    `stats count() as n by ${by.join(', ')}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');
};

export const valueCountsOf = (rows: PplRecord[]): ValueCount[] =>
  rows
    .map((r) => ({
      value: num(r[EVAL_FIELDS.value]),
      outcome: (r[VERDICT_COLUMN] as EvalOutcome) ?? 'neutral',
      count: num(r.n) ?? 0,
      threshold: num(r[EVAL_FIELDS.threshold]),
    }))
    .filter((v): v is ValueCount => v.value !== undefined && v.count > 0);

export interface DistributionBin {
  /** Lower edge of the bin. */
  x: number;
  outcome: EvalOutcome;
  count: number;
}

export interface Distribution {
  bins: DistributionBin[];
  /** Bin width (the x axis' interval). */
  width: number;
  min: number;
  max: number;
  /** The most common declared threshold. */
  threshold?: number;
  mean?: number;
  total: number;
}

const DISCRETE_LIMIT = 12;

/**
 * Bins of the values: one per value when they are few whole numbers (1..5 scales, 0/1),
 * else ten equal bins over the values' range. Bars stack by verdict.
 */
export const distributionOf = (counts: ValueCount[], bins = 10): Distribution | undefined => {
  if (counts.length === 0) return undefined;
  const values = counts.map((c) => c.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const distinct = new Set(values);
  const discrete = distinct.size <= DISCRETE_LIMIT && values.every((v) => Number.isInteger(v));
  const width = discrete ? 1 : max > min ? (max - min) / bins : 1;
  const binOf = (v: number) =>
    discrete ? v : max > min ? min + Math.min(bins - 1, Math.floor((v - min) / width)) * width : v;
  const byKey = new Map<string, DistributionBin>();
  let total = 0;
  let sum = 0;
  const thresholds = new Map<number, number>();
  counts.forEach((c) => {
    const x = binOf(c.value);
    const key = `${x}|${c.outcome}`;
    const bin = byKey.get(key) ?? { x, outcome: c.outcome, count: 0 };
    bin.count += c.count;
    byKey.set(key, bin);
    total += c.count;
    sum += c.value * c.count;
    if (c.threshold !== undefined)
      thresholds.set(c.threshold, (thresholds.get(c.threshold) ?? 0) + c.count);
  });
  const threshold = Array.from(thresholds.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    bins: Array.from(byKey.values()).sort((a, b) => a.x - b.x),
    width,
    min,
    // The last bin's lower edge: the x domain holds bin starts.
    max: discrete || max === min ? max : min + (bins - 1) * width,
    threshold,
    mean: total ? sum / total : undefined,
    total,
  };
};

/** The value distribution of `name` under the filters; nothing without a name. */
export const useScoreDistribution = (
  data: DataPublicPluginStart | undefined,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  name: string | undefined,
  index: string = AGENT_EVALS_INDEX_PATTERN,
  enabled = true
): Loadable<Distribution | undefined> => {
  const key = data && name ? JSON.stringify(['dist', bounds, filters, name, index]) : undefined;
  return useCachedLoad(key, enabled, async (signal) => {
    if (!data || !name) return undefined;
    const ppl = createEvalsPplService(data, isoRange(bounds), signal);
    const agg = await executeVerdictAgg(
      ppl,
      index,
      (missing, source, clauses) =>
        buildValueCountsQuery(filters, name, { index: source, missing, clauses }),
      { emptyWithout: [EVAL_FIELDS.value] }
    );
    return distributionOf(valueCountsOf(agg.rows));
  });
};

// ---------------------------------------------------------------------------------------
// Latency of judged traces
// ---------------------------------------------------------------------------------------

/** Traces read per verdict, and per span lookup. */
export const JUDGED_TRACES_LIMIT = 200;
const SPAN_BATCH = 100;

/** Judged traces, failing when any of their evaluations failed. */
export const judgedTraces = (
  failing: EvalResult[],
  passing: EvalResult[],
  limit = JUDGED_TRACES_LIMIT
): { failing: string[]; passing: string[] } => {
  const failIds = Array.from(new Set(failing.map((r) => r.traceId).filter(Boolean))).slice(
    0,
    limit
  ) as string[];
  const failSet = new Set(failIds);
  const passIds = Array.from(
    new Set(passing.map((r) => r.traceId).filter((id): id is string => !!id && !failSet.has(id)))
  ).slice(0, limit);
  return { failing: failIds, passing: passIds };
};

/** Root spans of a batch of traces: start and duration. */
export const buildRootSpansQuery = (traceIds: string[], index: string): string =>
  [
    `source = ${index}`,
    `where parentSpanId = '' and (${traceIds.map((id) => `traceId = ${quote(id)}`).join(' or ')})`,
    'fields traceId, startTime, durationInNanos',
    `head ${traceIds.length * 2}`,
  ].join(' | ');

export interface RootSpan {
  traceId: string;
  startMs: number;
  durationMs: number;
}

export const rootSpansOf = (rows: PplRecord[]): RootSpan[] =>
  rows
    .map((r) => ({
      traceId: String(r.traceId ?? ''),
      startMs: parseEvalTime(String(r.startTime ?? '')),
      durationMs: (num(r.durationInNanos) ?? NaN) / 1e6,
    }))
    .filter((s) => s.traceId && Number.isFinite(s.startMs) && Number.isFinite(s.durationMs));

export const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export interface LatencyPoint {
  x: number;
  group: 'passing' | 'failing';
  p50: number;
  count: number;
}

export interface JudgedLatency {
  points: LatencyPoint[];
  passingP50?: number;
  failingP50?: number;
  passingCount: number;
  failingCount: number;
  /** Failing p50 over passing p50, when both have enough traces. */
  ratio?: number;
}

/** p50 of root span duration per interval, for failing and passing judged traces. */
export const judgedLatencyOf = (
  spans: RootSpan[],
  ids: { failing: string[]; passing: string[] },
  interval: number
): JudgedLatency => {
  const failSet = new Set(ids.failing);
  const passSet = new Set(ids.passing);
  // One root per trace: the longest (some traces carry several roots).
  const byTrace = new Map<string, RootSpan>();
  spans.forEach((s) => {
    const seen = byTrace.get(s.traceId);
    if (!seen || s.durationMs > seen.durationMs) byTrace.set(s.traceId, s);
  });
  const groups: Record<'failing' | 'passing', RootSpan[]> = { failing: [], passing: [] };
  byTrace.forEach((s) => {
    if (failSet.has(s.traceId)) groups.failing.push(s);
    else if (passSet.has(s.traceId)) groups.passing.push(s);
  });
  const points: LatencyPoint[] = [];
  (['passing', 'failing'] as const).forEach((group) => {
    const buckets = new Map<number, number[]>();
    groups[group].forEach((s) => {
      const x = Math.floor(s.startMs / interval) * interval;
      buckets.set(x, [...(buckets.get(x) ?? []), s.durationMs]);
    });
    Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([x, list]) =>
        points.push({ x, group, p50: median(list) as number, count: list.length })
      );
  });
  const passingP50 = median(groups.passing.map((s) => s.durationMs));
  const failingP50 = median(groups.failing.map((s) => s.durationMs));
  const ratio =
    passingP50 && failingP50 && groups.passing.length >= 3 && groups.failing.length >= 3
      ? failingP50 / passingP50
      : undefined;
  return {
    points,
    passingP50,
    failingP50,
    passingCount: groups.passing.length,
    failingCount: groups.failing.length,
    ratio,
  };
};

/**
 * Latency of the traces the results judged: the failing and passing results' trace ids
 * (`JUDGED_TRACES_LIMIT` each), then their root spans from the traces dataset.
 */
export const useJudgedTraceLatency = (
  data: DataPublicPluginStart | undefined,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  index: string = AGENT_EVALS_INDEX_PATTERN,
  spansIndex: string,
  enabled = true
): Loadable<JudgedLatency> => {
  const key = data ? JSON.stringify(['lat', bounds, filters, index, spansIndex]) : undefined;
  return useCachedLoad(key, enabled, async (signal) => {
    if (!data) return judgedLatencyOf([], { failing: [], passing: [] }, 1);
    const ppl = createEvalsPplService(data, isoRange(bounds), signal);
    const [failing, passing] = await Promise.all([
      fetchEvalResultsWith(ppl, index, { ...filters, outcomes: ['fail'] }, JUDGED_TRACES_LIMIT * 2),
      fetchEvalResultsWith(ppl, index, { ...filters, outcomes: ['pass'] }, JUDGED_TRACES_LIMIT * 2),
    ]);
    const ids = judgedTraces(failing, passing);
    const all = [...ids.failing, ...ids.passing];
    const spansPpl = createEvalsPplService(data, undefined, signal);
    const batches: string[][] = [];
    for (let i = 0; i < all.length; i += SPAN_BATCH) batches.push(all.slice(i, i + SPAN_BATCH));
    const responses = await Promise.all(
      batches.map((b) =>
        spansPpl.executeQuery(spansDataset(spansIndex), buildRootSpansQuery(b, spansIndex))
      )
    );
    const spans = responses.flatMap((r) => rootSpansOf(pplResponseToRecords(r)));
    return judgedLatencyOf(spans, ids, pickInterval(bounds, 24));
  });
};
