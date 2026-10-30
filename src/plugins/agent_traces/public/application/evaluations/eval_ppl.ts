/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { PplRecord, pplResponseToRecords } from '../pages/sessions/session_utils';
import {
  EVAL_FIELDS,
  EvalFilters,
  EvalOutcome,
  EvalResult,
  EvaluatorSummary,
  buildEvalCommands,
  buildEvalResultsQuery,
  evalsDataset,
  recordToEvalResult,
  labelCounts,
  outcomesFilter,
  sortSummaries,
} from './eval_data';
import { Clause, VERDICT_CLAUSES, VERDICT_COLUMN, builtinRange } from './eval_verdict';
import {
  MATCH_NONE,
  VerdictKey,
  VerdictKeyPlan,
  verdictKeyEval,
  verdictKeyGroups,
  verdictKeyOf,
  verdictKeyPlan,
  verdictOfKey,
  verdictWhere,
} from './eval_verdict_keys';
import type { EvalKpis, OutcomeBucket, TrendPoint } from './eval_aggregations';
import { parseEvalTime } from './eval_aggregations';

/**
 * Exact numbers for the Overview: server-side PPL aggregations on the evaluation index.
 * Aggregations group by what the verdict reads (`eval_verdict_keys.ts`) and the browser
 * applies the rules to each group, so counts, pass rates, means, label splits and time
 * buckets hold at any volume, and the queries do not grow with the rules.
 */

const field = (f: string) => `\`${f}\``;
const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Fields a query may name that an index might not map yet (a mapping grows as producers
 * send new attributes; PPL rejects unknown fields). They are dropped and retried.
 */
const OPTIONAL_FIELDS = new Set<string>([
  EVAL_FIELDS.assessment,
  EVAL_FIELDS.threshold,
  EVAL_FIELDS.direction,
  EVAL_FIELDS.scoreMin,
  EVAL_FIELDS.scoreMax,
  EVAL_FIELDS.errorType,
  EVAL_FIELDS.label,
  EVAL_FIELDS.value,
  EVAL_FIELDS.level,
  EVAL_FIELDS.source,
  EVAL_FIELDS.sessionId,
  EVAL_FIELDS.targetTraceId,
]);

/**
 * Fields PPL said it does not know, per index pattern, for a few minutes. The index template
 * maps every field the UI reads, so this is a safety net (an index created before the
 * template, a custom index pattern): the query runs again without what needs the field.
 */
const MISSING_TTL_MS = 5 * 60 * 1000;
const missingByIndex = new Map<string, { at: number; fields: Set<string> }>();
export const clearMissingFieldsCache = () => missingByIndex.clear();

const missingOf = (index: string): Set<string> => {
  const hit = missingByIndex.get(index);
  return hit && Date.now() - hit.at < MISSING_TTL_MS ? hit.fields : new Set();
};

/** The field PPL said it does not know, from the error of a failed request. */
export const missingFieldOf = (error: unknown): string | undefined => {
  const e = error as { body?: unknown; message?: unknown } | undefined;
  let text = String(e?.message ?? error ?? '');
  try {
    text += ` ${JSON.stringify(e?.body ?? '')}`;
  } catch {
    // circular body: the message is enough
  }
  const match = /Field \[([^\]]+)\] not found/.exec(text.replace(/\\"/g, '"'));
  return match?.[1];
};

type Build = (missing: ReadonlySet<string>, source: string) => string;

/**
 * Runs `build(missing, index)` once against the whole index pattern and returns its rows.
 * When PPL answers "Field [x] not found" for an optional field, it runs again treating `x`
 * as absent (`missing`), and remembers that for a few minutes. With `emptyWithout`, a
 * missing field from that list means there is nothing to read: no rows.
 */
export const executeEvalPpl = async (
  ppl: PPLService,
  index: string,
  build: Build,
  options: { emptyWithout?: string[] } = {}
): Promise<PplRecord[]> => {
  let missing = new Set(missingOf(index));
  for (let attempt = 0; attempt <= OPTIONAL_FIELDS.size; attempt++) {
    try {
      return pplResponseToRecords(
        await ppl.executeQuery(evalsDataset(index), build(missing, index))
      );
    } catch (error) {
      const f = missingFieldOf(error);
      if (f && options.emptyWithout?.includes(f)) return [];
      if (!f || !OPTIONAL_FIELDS.has(f) || missing.has(f)) throw error;
      missing = new Set([...missing, f]);
      missingByIndex.set(index, { at: Date.now(), fields: missing });
    }
  }
  throw new Error('Evaluation query failed');
};

export interface QueryContext {
  index?: string;
  /** Verdict clauses (`VERDICT_CLAUSES` by default). */
  clauses?: Clause[];
  missing?: ReadonlySet<string>;
  /** A `where` keeping the wanted verdicts (`verdictWhere`), for queries that filter on it. */
  verdictWhere?: string;
}

const present = (missing: ReadonlySet<string>) => (f: string) => !missing.has(f);

/** `source`, the filters and the verdict filter (`ctx.verdictWhere`). */
export const baseCommands = (filters: EvalFilters, ctx: QueryContext = {}): string[] =>
  buildEvalCommands(filters, ctx.index ?? AGENT_EVALS_INDEX_PATTERN, {
    missing: ctx.missing,
    verdictWhere: ctx.verdictWhere,
  });

const planOf = (ctx: QueryContext): VerdictKeyPlan =>
  verdictKeyPlan(ctx.clauses ?? VERDICT_CLAUSES, ctx.missing ?? new Set());

/** `eval` of the verdict key columns (when any) and the `by` list with the verdict keys. */
const withVerdictKeys = (ctx: QueryContext, groups: string[]) => {
  const plan = planOf(ctx);
  const evalCommand = verdictKeyEval(plan);
  const by = Array.from(new Set([...groups, ...verdictKeyGroups(plan)]));
  return { evals: evalCommand ? [evalCommand] : [], by };
};

/**
 * Groups of results by what the verdict reads, with their counts: what a verdict filter is
 * built from (`verdictWhere`).
 */
export const buildVerdictKeysQuery = (filters: EvalFilters, ctx: QueryContext = {}): string => {
  const { evals, by } = withVerdictKeys(ctx, []);
  return [
    ...baseCommands(filters, { ...ctx, verdictWhere: undefined }),
    ...evals,
    `stats count() as n by ${by.join(', ')}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');
};

/** Aggregated rows with their verdict (`evl_verdict`), and the groups behind them. */
export interface VerdictAgg {
  rows: PplRecord[];
  keys: VerdictKey[];
  plan: VerdictKeyPlan;
  clauses: Clause[];
}

/**
 * Runs an aggregation grouped by the verdict keys (`build` gets the clauses to plan with)
 * and sets each row's `evl_verdict` from the rules.
 */
export const executeVerdictAgg = async (
  ppl: PPLService,
  index: string,
  build: (missing: ReadonlySet<string>, source: string, clauses: Clause[]) => string,
  options: { emptyWithout?: string[]; clauses?: Clause[] } = {}
): Promise<VerdictAgg> => {
  const clauses = options.clauses ?? VERDICT_CLAUSES;
  let used: ReadonlySet<string> = new Set();
  const rows = await executeEvalPpl(
    ppl,
    index,
    (missing, source) => {
      used = missing;
      return build(missing, source, clauses);
    },
    options
  );
  const plan = verdictKeyPlan(clauses, used);
  const keys = rows.map((r) => verdictKeyOf(r, plan));
  rows.forEach((r, i) => {
    r[VERDICT_COLUMN] = verdictOfKey(keys[i], plan, clauses);
  });
  return { rows, keys, plan, clauses };
};

/** The verdict groups of the results under the filters (verdict filter left out). */
export const fetchVerdictGroups = (
  ppl: PPLService,
  index: string,
  filters: EvalFilters
): Promise<VerdictAgg> =>
  executeVerdictAgg(ppl, index, (missing, source, clauses) =>
    buildVerdictKeysQuery(filters, { index: source, missing, clauses })
  );

/** The `where` keeping `outcomes`, from verdict groups (`MATCH_NONE`: nothing matches). */
export const whereForOutcomes = (agg: VerdictAgg, outcomes: EvalOutcome[]): string =>
  verdictWhere(agg.keys, agg.plan, agg.clauses, outcomes);

/** Rows of a verdict aggregation kept by the filters' verdict filter, if any. */
export const keepOutcomes = (rows: PplRecord[], filters: EvalFilters): PplRecord[] => {
  const outcomes = outcomesFilter(filters);
  return outcomes ? rows.filter((r) => outcomes.includes(r[VERDICT_COLUMN] as EvalOutcome)) : rows;
};

/**
 * Runs `build` with the verdict filter of `filters` as a `where` (`verdictWhere`, built
 * from an aggregation of the verdict groups first); no rows when no group matches.
 */
export const executeEvalPplFiltered = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  build: (missing: ReadonlySet<string>, source: string, verdictWhere?: string) => string,
  options: { emptyWithout?: string[] } = {}
): Promise<PplRecord[]> => {
  const outcomes = outcomesFilter(filters);
  if (!outcomes) return executeEvalPpl(ppl, index, (m, s) => build(m, s), options);
  const where = whereForOutcomes(await fetchVerdictGroups(ppl, index, filters), outcomes);
  if (where === MATCH_NONE) return [];
  return executeEvalPpl(ppl, index, (m, s) => build(m, s, where), options);
};

/** Results under the filters, newest first, with optional fields dropped when unmapped. */
export const fetchEvalResultsWith = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  limit: number
): Promise<EvalResult[]> =>
  (
    await executeEvalPplFiltered(ppl, index, filters, (missing, source, where) =>
      buildEvalResultsQuery(filters, limit, source, missing, where)
    )
  )
    .map(recordToEvalResult)
    .sort((a, b) => parseEvalTime(b.time) - parseEvalTime(a.time))
    .slice(0, limit);

const SUMMARY_GROUPS = [
  EVAL_FIELDS.name,
  EVAL_FIELDS.level,
  EVAL_FIELDS.source,
  EVAL_FIELDS.label,
  EVAL_FIELDS.direction,
  EVAL_FIELDS.scoreMin,
  EVAL_FIELDS.scoreMax,
];
const TREND_GROUPS = [
  EVAL_FIELDS.name,
  EVAL_FIELDS.direction,
  EVAL_FIELDS.scoreMin,
  EVAL_FIELDS.scoreMax,
];
/** Rows an aggregation may return (the engine's bucket limit). */
export const AGG_ROWS_LIMIT = 10000;

const valueStats = (missing: ReadonlySet<string>) =>
  missing.has(EVAL_FIELDS.value)
    ? ''
    : `, count(${field(EVAL_FIELDS.value)}) as nv, sum(${field(EVAL_FIELDS.value)}) as sv, min(${field(
        EVAL_FIELDS.value
      )}) as vmin, max(${field(EVAL_FIELDS.value)}) as vmax`;

/**
 * Counts and value sums per evaluation, level, source, label, declared scale and verdict
 * keys (`executeVerdictAgg` sets the verdict). The verdict filter is applied to the rows
 * (`keepOutcomes`), not in the query.
 */
export const buildSummaryAggQuery = (filters: EvalFilters, ctx: QueryContext = {}): string => {
  const missing = ctx.missing ?? new Set<string>();
  const { evals, by } = withVerdictKeys(ctx, SUMMARY_GROUPS.filter(present(missing)).map(field));
  return [
    ...baseCommands(filters, ctx),
    ...evals,
    `stats count() as n${valueStats(missing)} by ${by.join(', ')}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');
};

/** PPL span of a bucket size: `5m`, `3h`, `1d`. */
export const spanUnit = (intervalMs: number): string => {
  const units: Array<[number, string]> = [
    [24 * 3600 * 1000, 'd'],
    [3600 * 1000, 'h'],
    [60 * 1000, 'm'],
    [1000, 's'],
  ];
  const [size, unit] = units.find(([ms]) => intervalMs % ms === 0) ?? [1000, 's'];
  return `${Math.max(1, Math.round(intervalMs / size))}${unit}`;
};

/** Counts and value sums per time bucket, evaluation, declared scale and verdict keys. */
export const buildTrendAggQuery = (
  filters: EvalFilters,
  intervalMs: number,
  ctx: QueryContext = {}
): string => {
  const missing = ctx.missing ?? new Set<string>();
  const { evals, by } = withVerdictKeys(ctx, TREND_GROUPS.filter(present(missing)).map(field));
  return [
    ...baseCommands(filters, ctx),
    ...evals,
    `stats count() as n${valueStats(missing)} by span(${field(EVAL_FIELDS.time)}, ${spanUnit(
      intervalMs
    )}) as t, ${by.join(', ')}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');
};

/** Distinct evaluated traces and sessions. */
export const buildDistinctAggQuery = (filters: EvalFilters, ctx: QueryContext = {}): string => {
  const missing = ctx.missing ?? new Set<string>();
  const parts = ['count() as n'];
  if (!missing.has(EVAL_FIELDS.targetTraceId)) {
    parts.push(`distinct_count(${field(EVAL_FIELDS.targetTraceId)}) as traces`);
  }
  if (!missing.has(EVAL_FIELDS.sessionId)) {
    parts.push(`distinct_count(${field(EVAL_FIELDS.sessionId)}) as sessions`);
  }
  return [...baseCommands(filters, ctx), `stats ${parts.join(', ')}`].join(' | ');
};

/** Distinct target trace ids of the results matching the filters, newest first. */
export const buildMatchingTraceIdsQuery = (
  filters: EvalFilters,
  limit: number,
  ctx: QueryContext = {}
): string =>
  [
    ...baseCommands(filters, ctx),
    `where isnotnull(${field(EVAL_FIELDS.targetTraceId)})`,
    `stats max(${field(EVAL_FIELDS.time)}) as last by ${field(EVAL_FIELDS.targetTraceId)}`,
    'sort - last',
    `head ${limit + 1}`,
  ].join(' | ');

// ---------------------------------------------------------------------------------------
// From aggregated rows to the Overview's numbers
// ---------------------------------------------------------------------------------------

const OUTCOMES: EvalOutcome[] = ['pass', 'fail', 'error', 'neutral'];
const asOutcome = (v: unknown): EvalOutcome =>
  OUTCOMES.includes(v as EvalOutcome) ? (v as EvalOutcome) : 'neutral';
const strOf = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));
const numOf = (v: unknown) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

interface AggRow {
  name: string;
  level?: string;
  source?: string;
  label?: string;
  direction?: 'maximize' | 'minimize';
  scoreMin?: number;
  scoreMax?: number;
  outcome: EvalOutcome;
  count: number;
  valueCount: number;
  valueSum: number;
  valueMin?: number;
  valueMax?: number;
  time?: number;
}

export const toAggRows = (records: PplRecord[]): AggRow[] =>
  records.map((r) => {
    const direction = strOf(r[EVAL_FIELDS.direction])?.toLowerCase();
    return {
      name: strOf(r[EVAL_FIELDS.name]) ?? '(unnamed)',
      level: strOf(r[EVAL_FIELDS.level])?.toLowerCase(),
      source: strOf(r[EVAL_FIELDS.source]),
      label: strOf(r[EVAL_FIELDS.label]),
      direction: direction === 'minimize' || direction === 'maximize' ? direction : undefined,
      scoreMin: numOf(r[EVAL_FIELDS.scoreMin]),
      scoreMax: numOf(r[EVAL_FIELDS.scoreMax]),
      outcome: asOutcome(r[VERDICT_COLUMN]),
      count: numOf(r.n) ?? 0,
      valueCount: numOf(r.nv) ?? 0,
      valueSum: numOf(r.sv) ?? 0,
      valueMin: numOf(r.vmin),
      valueMax: numOf(r.vmax),
      time: r.t === undefined ? undefined : parseEvalTime(String(r.t)),
    };
  });

/**
 * Score range and direction for a group of results: what the results declare, else a known
 * evaluator's scale; values seen within 0..1 read as 0..1.
 */
export const groupScale = (
  row: Pick<AggRow, 'name' | 'direction' | 'scoreMin' | 'scoreMax' | 'valueMin' | 'valueMax'>
): { min: number; max: number; direction: 'maximize' | 'minimize' } | undefined => {
  const builtin = builtinRange(row.name);
  let min = row.scoreMin ?? builtin?.min;
  let max = row.scoreMax ?? builtin?.max;
  if (
    min === undefined &&
    max === undefined &&
    row.valueMin !== undefined &&
    row.valueMax !== undefined &&
    row.valueMin >= 0 &&
    row.valueMax <= 1
  ) {
    min = 0;
    max = 1;
  }
  if (min === undefined || max === undefined || max <= min) return undefined;
  return { min, max, direction: row.direction ?? 'maximize' };
};

/** Normalized mean (0..1, higher is better) of a group, when its scale is known. */
const normalizedSum = (row: AggRow): number | undefined => {
  if (row.valueCount === 0) return undefined;
  const scale = groupScale(row);
  if (!scale) return undefined;
  const mean = row.valueSum / row.valueCount;
  const n = Math.min(1, Math.max(0, (mean - scale.min) / (scale.max - scale.min)));
  return (scale.direction === 'minimize' ? 1 - n : n) * row.valueCount;
};

/** Per-evaluation summaries from the summary aggregation. */
export const summariesFromAgg = (rows: AggRow[]): EvaluatorSummary[] => {
  const byName = new Map<string, AggRow[]>();
  rows.forEach((r) => byName.set(r.name, [...(byName.get(r.name) ?? []), r]));
  return sortSummaries(
    Array.from(byName.entries()).map(([name, list]) => {
      const total = (pick: (r: AggRow) => number) => list.reduce((s, r) => s + pick(r), 0);
      const count = (o: EvalOutcome) => total((r) => (r.outcome === o ? r.count : 0));
      const valueCount = total((r) => r.valueCount);
      let normCount = 0;
      let normSum = 0;
      list.forEach((r) => {
        const n = normalizedSum(r);
        if (n !== undefined) {
          normSum += n;
          normCount += r.valueCount;
        }
      });
      return {
        name,
        levels: Array.from(new Set(list.map((r) => r.level).filter((l): l is string => !!l))),
        sources: Array.from(new Set(list.map((r) => r.source).filter((s): s is string => !!s))),
        count: total((r) => r.count),
        passCount: count('pass'),
        failCount: count('fail'),
        errorCount: count('error'),
        neutralCount: count('neutral'),
        mean: valueCount ? total((r) => r.valueSum) / valueCount : undefined,
        normalizedMean: normCount ? normSum / normCount : undefined,
        labels: labelCounts(
          list
            .filter((r) => !!r.label)
            .map((r) => ({ label: r.label as string, outcome: r.outcome, count: r.count }))
        ),
        direction: list.some((r) => r.direction === 'minimize') ? 'minimize' : 'maximize',
      };
    })
  );
};

/** KPIs from the summaries and the distinct counts. */
export const kpisFromAgg = (
  summaries: EvaluatorSummary[],
  distinct: PplRecord | undefined
): EvalKpis => {
  const sum = (pick: (s: EvaluatorSummary) => number) => summaries.reduce((n, s) => n + pick(s), 0);
  const pass = sum((s) => s.passCount);
  const fail = sum((s) => s.failCount);
  return {
    results: sum((s) => s.count),
    evaluators: summaries.length,
    passRate: pass + fail > 0 ? pass / (pass + fail) : undefined,
    failing: fail,
    errors: sum((s) => s.errorCount),
    scored: sum((s) => s.neutralCount),
    traces: numOf(distinct?.traces) ?? 0,
    sessions: numOf(distinct?.sessions) ?? 0,
  };
};

/** Outcome buckets (all evaluations, and per evaluation) from the trend aggregation. */
export const bucketsFromAgg = (
  rows: AggRow[]
): { all: OutcomeBucket[]; byName: Map<string, OutcomeBucket[]> } => {
  const add = (map: Map<string, OutcomeBucket>, x: number, outcome: EvalOutcome, n: number) => {
    const key = `${x}|${outcome}`;
    const b = map.get(key) ?? { x, outcome, count: 0 };
    b.count += n;
    map.set(key, b);
  };
  const all = new Map<string, OutcomeBucket>();
  const byName = new Map<string, Map<string, OutcomeBucket>>();
  rows.forEach((r) => {
    if (r.time === undefined || !Number.isFinite(r.time)) return;
    add(all, r.time, r.outcome, r.count);
    const own = byName.get(r.name) ?? new Map<string, OutcomeBucket>();
    add(own, r.time, r.outcome, r.count);
    byName.set(r.name, own);
  });
  const sorted = (m: Map<string, OutcomeBucket>) =>
    Array.from(m.values()).sort((a, b) => a.x - b.x);
  return {
    all: sorted(all),
    byName: new Map(Array.from(byName.entries()).map(([k, v]) => [k, sorted(v)])),
  };
};

/** Normalized mean per evaluation and bucket, for evaluations with a known scale. */
export const trendFromAgg = (rows: AggRow[]): TrendPoint[] => {
  const sums = new Map<string, { x: number; name: string; sum: number; count: number }>();
  rows.forEach((r) => {
    if (r.time === undefined || !Number.isFinite(r.time)) return;
    const n = normalizedSum(r);
    if (n === undefined) return;
    const key = `${r.name}|${r.time}`;
    const e = sums.get(key) ?? { x: r.time, name: r.name, sum: 0, count: 0 };
    e.sum += n;
    e.count += r.valueCount;
    sums.set(key, e);
  });
  return Array.from(sums.values())
    .map(({ x, name, sum, count }) => ({ x, name, value: sum / count, count }))
    .sort((a, b) => a.x - b.x || a.name.localeCompare(b.name));
};

/** Literal list for a PPL `in (...)`. */
export const pplList = (values: string[]) => values.map(quote).join(', ');

// ---------------------------------------------------------------------------------------
// Results table: server-side paging and sorting
// ---------------------------------------------------------------------------------------

export type ResultsSortField = 'time' | 'name' | 'level' | 'result';
export interface ResultsSort {
  field: ResultsSortField;
  direction: 'asc' | 'desc';
}
export const DEFAULT_RESULTS_SORT: ResultsSort = { field: 'time', direction: 'desc' };

/**
 * Page sizes of the Results table. They divide 10,000: on OpenSearch 3.9 a PPL page that
 * straddles offset 10,000 (`plugins.query.size_limit`) is cut there; pages on either side of
 * it are complete.
 */
export const RESULTS_PAGE_SIZES = [25, 50, 100];

/**
 * One page of results under the filters, in the given order. By Result, the caller pages
 * each verdict apart (`ctx.verdictWhere` keeps one) and this sorts by value then time.
 */
export const buildResultsPageQuery = (
  filters: EvalFilters,
  sort: ResultsSort,
  from: number,
  size: number,
  ctx: QueryContext = {}
): string => {
  const missing = ctx.missing ?? new Set<string>();
  const commands = baseCommands(filters, ctx);
  const dir = sort.direction === 'desc' ? '- ' : '';
  const time = field(EVAL_FIELDS.time);
  let sortBy: string;
  if (sort.field === 'result') {
    sortBy = [
      ...(missing.has(EVAL_FIELDS.value) ? [] : [`${dir}${field(EVAL_FIELDS.value)}`]),
      `- ${time}`,
    ].join(', ');
  } else if (sort.field === 'time') {
    sortBy = `${dir}${time}`;
  } else {
    const f = sort.field === 'name' ? EVAL_FIELDS.name : EVAL_FIELDS.level;
    sortBy = missing.has(f) ? `- ${time}` : `${dir}${field(f)}, - ${time}`;
  }
  commands.push(`sort ${sortBy}`);
  commands.push(from > 0 ? `head ${size} from ${from}` : `head ${size}`);
  return commands.join(' | ');
};

const RANK: Record<EvalOutcome, number> = { fail: 0, error: 1, neutral: 2, pass: 3 };

/** The browser's order of results, the same as the query's. */
export const compareResults =
  (sort: ResultsSort) =>
  (a: EvalResult, b: EvalResult): number => {
    const sign = sort.direction === 'desc' ? -1 : 1;
    const byTime = parseEvalTime(b.time) - parseEvalTime(a.time);
    const cmp = (x: string | number | undefined, y: string | number | undefined) => {
      if (x === y) return 0;
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      return x < y ? -1 : 1;
    };
    switch (sort.field) {
      case 'time':
        return -sign * byTime || 0;
      case 'name':
        return sign * cmp(a.name, b.name) || byTime;
      case 'level':
        return sign * cmp(a.level, b.level) || byTime;
      case 'result':
        return sign * (RANK[a.outcome] - RANK[b.outcome]) || sign * cmp(a.value, b.value) || byTime;
    }
  };

export interface ResultsPage {
  rows: EvalResult[];
}

/** Verdicts in the Result column's ascending order. */
const RESULT_ORDER: EvalOutcome[] = ['fail', 'error', 'neutral', 'pass'];

/**
 * One page of the Results table, sorted and paged in PPL. Without a verdict filter or
 * Result sort it is one query. Otherwise the verdict groups are read first: a verdict filter
 * becomes a `where` on them, and by Result each verdict is a segment of the order (its count
 * known from the groups), paged on its own.
 */
export const fetchResultsPage = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  sort: ResultsSort,
  pageIndex: number,
  pageSize: number
): Promise<ResultsPage> => {
  const from = pageIndex * pageSize;
  const page = (start: number, size: number, where?: string) =>
    executeEvalPpl(ppl, index, (missing, source) =>
      buildResultsPageQuery(filters, sort, start, size, {
        index: source,
        missing,
        verdictWhere: where,
      })
    );
  const outcomes = outcomesFilter(filters);
  if (!outcomes && sort.field !== 'result') {
    return { rows: (await page(from, pageSize)).map(recordToEvalResult) };
  }
  const groups = await fetchVerdictGroups(ppl, index, filters);
  if (sort.field !== 'result') {
    const where = whereForOutcomes(groups, outcomes ?? []);
    if (where === MATCH_NONE) return { rows: [] };
    return { rows: (await page(from, pageSize, where)).map(recordToEvalResult) };
  }
  const counts = new Map<EvalOutcome, number>();
  groups.rows.forEach((r) => {
    const o = r[VERDICT_COLUMN] as EvalOutcome;
    counts.set(o, (counts.get(o) ?? 0) + (numOf(r.n) ?? 0));
  });
  const order = (sort.direction === 'desc' ? [...RESULT_ORDER].reverse() : RESULT_ORDER).filter(
    (o) => !outcomes || outcomes.includes(o)
  );
  const rows: PplRecord[] = [];
  let offset = 0;
  for (const outcome of order) {
    const count = counts.get(outcome) ?? 0;
    const start = Math.max(0, from - offset);
    const end = Math.min(count, from + pageSize - offset);
    offset += count;
    if (end <= start) continue;
    const where = whereForOutcomes(groups, [outcome]);
    if (where !== MATCH_NONE) rows.push(...(await page(start, end - start, where)));
    if (offset >= from + pageSize) break;
  }
  return { rows: rows.map(recordToEvalResult) };
};
