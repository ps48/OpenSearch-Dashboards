/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { DataPublicPluginStart } from '../../../../data/public';
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
import {
  Clause,
  RuleEntry,
  VERDICT_COLUMN,
  builtinRange,
  getActiveClauses,
  getActiveRuleEntries,
  ruleFor,
  verdictCasePpl,
} from './eval_verdict';
import type { EvalKpis, OutcomeBucket, TrendPoint } from './eval_aggregations';
import { parseEvalTime } from './eval_aggregations';

/**
 * Exact numbers for the Overview: server-side PPL aggregations on the evaluation index.
 * Each result's verdict is computed in the query (`eval evl_verdict = case(...)`) from the
 * same clauses the browser uses, then counted with `stats ... by`, so counts, pass rates,
 * means, label splits and time buckets hold at any volume.
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
 * Indices queried together: they hold the same optional fields. PPL resolves fields on the
 * whole `source`, and an `eval` script naming a field that some of the indices do not map
 * silently loses those indices' documents (seen on OpenSearch 3.9 with daily indices and
 * dynamic mappings). So each aggregation runs once per group of indices, naming only the
 * fields every index of the group holds, and the rows are added up.
 */
export interface IndexGroup {
  source: string;
  missing: ReadonlySet<string>;
}

const OPTIONAL_LIST = Array.from(OPTIONAL_FIELDS);

/** Groups of indices by the optional fields their documents in the range hold. */
export const groupsFromProbe = (response: unknown): IndexGroup[] => {
  const raw = (response as { rawResponse?: unknown })?.rawResponse ?? response;
  const buckets =
    (
      raw as {
        aggregations?: { idx?: { buckets?: Array<Record<string, unknown>> } };
      }
    )?.aggregations?.idx?.buckets ?? [];
  const bySignature = new Map<string, { indices: string[]; missing: Set<string> }>();
  buckets.forEach((b) => {
    const missing = new Set(
      OPTIONAL_LIST.filter((_, i) => !((b[`f${i}`] as { doc_count?: number })?.doc_count ?? 0))
    );
    const key = Array.from(missing).sort().join('|');
    const group = bySignature.get(key) ?? { indices: [], missing };
    group.indices.push(String(b.key));
    bySignature.set(key, group);
  });
  return Array.from(bySignature.values()).map((g) => ({
    source: g.indices.sort().join(','),
    missing: g.missing,
  }));
};

/** Index names safe to list in a PPL `source`. */
const SAFE_INDEX = /^[^\s|'"`,]+$/;

/**
 * One DSL aggregation: the indices with results in the range and, per index, which optional
 * fields any result holds. Undefined when the probe fails (then the pattern is queried as is).
 */
export const probeIndexGroups = async (
  data: DataPublicPluginStart,
  index: string,
  timeRange?: { from: string; to: string },
  signal?: AbortSignal
): Promise<IndexGroup[] | undefined> => {
  const aggs: Record<string, unknown> = {};
  OPTIONAL_LIST.forEach((f, i) => {
    aggs[`f${i}`] = { filter: { exists: { field: f } } };
  });
  try {
    const response = await data.search
      .search(
        {
          params: {
            index,
            body: {
              size: 0,
              query: timeRange
                ? {
                    range: {
                      [EVAL_FIELDS.time]: {
                        gte: timeRange.from,
                        lte: timeRange.to,
                        format: 'strict_date_optional_time',
                      },
                    },
                  }
                : { match_all: {} },
              aggs: { idx: { terms: { field: '_index', size: 1000 }, aggs } },
            },
          },
        },
        { abortSignal: signal }
      )
      .toPromise();
    const groups = groupsFromProbe(response);
    if (groups.some((g) => g.source.split(',').some((i) => !SAFE_INDEX.test(i)))) return undefined;
    return groups;
  } catch {
    return undefined;
  }
};

/** Fields found missing per index pattern (safety net when no probe ran). */
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

const runGroup = async (ppl: PPLService, group: IndexGroup, build: Build) => {
  let missing = new Set([...group.missing, ...missingOf(group.source)]);
  for (let attempt = 0; attempt <= OPTIONAL_FIELDS.size; attempt++) {
    try {
      return pplResponseToRecords(
        await ppl.executeQuery(evalsDataset(group.source), build(missing, group.source))
      );
    } catch (error) {
      // PPL rejects a field no index of the source maps: drop it and retry.
      const f = missingFieldOf(error);
      if (!f || !OPTIONAL_FIELDS.has(f) || missing.has(f)) throw error;
      missing = new Set([...missing, f]);
      missingByIndex.set(group.source, { at: Date.now(), fields: missing });
    }
  }
  throw new Error('Evaluation query failed');
};

/**
 * Runs `build(missing, source)` once per index group (or once on the pattern without
 * groups) and returns all rows. Aggregated rows of several groups are added up by the
 * `*FromAgg` helpers.
 */
export const executeEvalPpl = async (
  ppl: PPLService,
  index: string,
  build: Build,
  groups?: IndexGroup[]
): Promise<PplRecord[]> => {
  const list = groups?.length ? groups : [{ source: index, missing: new Set<string>() }];
  const rows = await Promise.all(list.map((g) => runGroup(ppl, g, build)));
  return rows.flat();
};

export interface QueryContext {
  index?: string;
  clauses?: Clause[];
  missing?: ReadonlySet<string>;
  /** No verdict column (the query needs none, and then needs no script). */
  withoutVerdict?: boolean;
}

const present = (missing: ReadonlySet<string>) => (f: string) => !missing.has(f);

/** `source`, the filters, the verdict column and the verdict filter. */
export const baseCommands = (filters: EvalFilters, ctx: QueryContext = {}): string[] =>
  buildEvalCommands(filters, ctx.index ?? AGENT_EVALS_INDEX_PATTERN, {
    missing: ctx.missing,
    clauses: ctx.clauses,
    withVerdict: !ctx.withoutVerdict,
  });

/** Results under the filters, newest first, with optional fields dropped when unmapped. */
export const fetchEvalResultsWith = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  limit: number,
  groups?: IndexGroup[]
): Promise<EvalResult[]> =>
  (
    await executeEvalPpl(
      ppl,
      index,
      (missing, source) => buildEvalResultsQuery(filters, limit, source, missing),
      groups
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

/** Counts and value sums per evaluation, level, source, label, verdict and declared scale. */
export const buildSummaryAggQuery = (filters: EvalFilters, ctx: QueryContext = {}): string => {
  const missing = ctx.missing ?? new Set<string>();
  const groups = SUMMARY_GROUPS.filter(present(missing)).map(field);
  return [
    ...baseCommands(filters, ctx),
    `stats count() as n${valueStats(missing)} by ${[...groups, VERDICT_COLUMN].join(', ')}`,
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

/** Counts and value sums per time bucket, evaluation, verdict and declared scale. */
export const buildTrendAggQuery = (
  filters: EvalFilters,
  intervalMs: number,
  ctx: QueryContext = {}
): string => {
  const missing = ctx.missing ?? new Set<string>();
  const groups = TREND_GROUPS.filter(present(missing)).map(field);
  return [
    ...baseCommands(filters, ctx),
    `stats count() as n${valueStats(missing)} by span(${field(EVAL_FIELDS.time)}, ${spanUnit(
      intervalMs
    )}) as t, ${[...groups, VERDICT_COLUMN].join(', ')}`,
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
 * Score range and direction for a group of results: the rules setting, else what the
 * results declare, else a known evaluator's scale; values seen within 0..1 read as 0..1.
 */
export const groupScale = (
  row: Pick<AggRow, 'name' | 'direction' | 'scoreMin' | 'scoreMax' | 'valueMin' | 'valueMax'>,
  rules: RuleEntry[] = getActiveRuleEntries()
): { min: number; max: number; direction: 'maximize' | 'minimize' } | undefined => {
  const rule = ruleFor(rules, row.name);
  const builtin = builtinRange(row.name);
  let min = rule?.min ?? row.scoreMin ?? builtin?.min;
  let max = rule?.max ?? row.scoreMax ?? builtin?.max;
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
  return { min, max, direction: rule?.direction ?? row.direction ?? 'maximize' };
};

/** Normalized mean (0..1, higher is better) of a group, when its scale is known. */
const normalizedSum = (row: AggRow, rules: RuleEntry[]): number | undefined => {
  if (row.valueCount === 0) return undefined;
  const scale = groupScale(row, rules);
  if (!scale) return undefined;
  const mean = row.valueSum / row.valueCount;
  const n = Math.min(1, Math.max(0, (mean - scale.min) / (scale.max - scale.min)));
  return (scale.direction === 'minimize' ? 1 - n : n) * row.valueCount;
};

/** Per-evaluation summaries from the summary aggregation. */
export const summariesFromAgg = (
  rows: AggRow[],
  rules: RuleEntry[] = getActiveRuleEntries()
): EvaluatorSummary[] => {
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
        const n = normalizedSum(r, rules);
        if (n !== undefined) {
          normSum += n;
          normCount += r.valueCount;
        }
      });
      const rule = ruleFor(rules, name);
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
        direction:
          rule?.direction ??
          (list.some((r) => r.direction === 'minimize') ? 'minimize' : 'maximize'),
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
export const trendFromAgg = (
  rows: AggRow[],
  rules: RuleEntry[] = getActiveRuleEntries()
): TrendPoint[] => {
  const sums = new Map<string, { x: number; name: string; sum: number; count: number }>();
  rows.forEach((r) => {
    if (r.time === undefined || !Number.isFinite(r.time)) return;
    const n = normalizedSum(r, rules);
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

/** Sort key of the Result column: failures, errors, scored, passes; then the value. */
export const RANK_COLUMN = 'evl_rank';

/**
 * Page sizes of the Results table. They divide 10,000: on OpenSearch 3.9 a PPL page that
 * straddles offset 10,000 (`plugins.query.size_limit`) is cut there; pages on either side of
 * it are complete.
 */
export const RESULTS_PAGE_SIZES = [25, 50, 100];

/**
 * Rows a merged page may reach: when the query needs the verdict script and the indices fall
 * into several mapping groups, each group returns its first `offset + size` rows and the
 * page is merged in the browser.
 */
export const MERGED_PAGE_LIMIT = 10000;

/** One page of results under the filters, in the given order. */
export const buildResultsPageQuery = (
  filters: EvalFilters,
  sort: ResultsSort,
  from: number,
  size: number,
  ctx: QueryContext = {}
): string => {
  const missing = ctx.missing ?? new Set<string>();
  const byResult = sort.field === 'result';
  const commands = buildEvalCommands(filters, ctx.index ?? AGENT_EVALS_INDEX_PATTERN, {
    missing,
    clauses: ctx.clauses,
  });
  const dir = sort.direction === 'desc' ? '- ' : '';
  const time = field(EVAL_FIELDS.time);
  let sortBy: string;
  if (byResult) {
    // The rank is its own case(): naming evl_verdict would inline the verdict once per use.
    commands.push(
      `eval ${RANK_COLUMN} = ${verdictCasePpl(ctx.clauses ?? getActiveClauses(), missing, {
        fail: '0',
        error: '1',
        neutral: '2',
        pass: '3',
      })}`
    );
    sortBy = [
      `${dir}${RANK_COLUMN}`,
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

/** The browser's order for merged pages, the same as the query's. */
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
  /** The page lies beyond what a merged page can reach (see `MERGED_PAGE_LIMIT`). */
  beyondLimit: boolean;
}

/**
 * One page of the Results table. Without the verdict script (no verdict filter, not sorted by
 * Result) one query pages the whole pattern. With it, one query per index group: a single
 * group pages in PPL; several groups each return their first rows and the page is merged.
 */
export const fetchResultsPage = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  sort: ResultsSort,
  pageIndex: number,
  pageSize: number,
  groups?: IndexGroup[]
): Promise<ResultsPage> => {
  const from = pageIndex * pageSize;
  const needsScript = !!outcomesFilter(filters) || sort.field === 'result';
  if (!needsScript || !groups || groups.length <= 1) {
    const rows = await executeEvalPpl(
      ppl,
      index,
      (missing, source) =>
        buildResultsPageQuery(filters, sort, from, pageSize, { index: source, missing }),
      needsScript ? groups : undefined
    );
    return { rows: rows.map(recordToEvalResult), beyondLimit: false };
  }
  if (from + pageSize > MERGED_PAGE_LIMIT) return { rows: [], beyondLimit: true };
  const rows = await executeEvalPpl(
    ppl,
    index,
    (missing, source) =>
      buildResultsPageQuery(filters, sort, 0, from + pageSize, { index: source, missing }),
    groups
  );
  return {
    rows: rows
      .map(recordToEvalResult)
      .sort(compareResults(sort))
      .slice(from, from + pageSize),
    beyondLimit: false,
  };
};
