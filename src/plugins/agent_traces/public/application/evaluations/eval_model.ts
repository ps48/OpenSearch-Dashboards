/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { F, NO_AGENT } from './eval_ppl';

/**
 * What each screen's query returns, shaped for its tables. Aggregated rows carry a `verdict`
 * computed in PPL (`VERDICT_EVAL`); result documents get the same rule here (`verdictOf`).
 */

export type PplRecord = Record<string, unknown>;
export type Verdict = 'pass' | 'fail' | 'error' | 'scored';
export const VERDICTS: Verdict[] = ['pass', 'fail', 'error', 'scored'];

export interface Tally {
  pass: number;
  fail: number;
  error: number;
  scored: number;
  n: number;
}

export const emptyTally = (): Tally => ({ pass: 0, fail: 0, error: 0, scored: 0, n: 0 });

const isVerdict = (v: unknown): v is Verdict => VERDICTS.includes(v as Verdict);

export const addToTally = (t: Tally, verdict: unknown, n = 1): Tally => {
  const v: Verdict = isVerdict(verdict) ? verdict : 'scored';
  t[v] += n;
  t.n += n;
  return t;
};

export const mergeTallies = (tallies: Tally[]): Tally =>
  tallies.reduce((acc, t) => {
    VERDICTS.forEach((v) => (acc[v] += t[v]));
    acc.n += t.n;
    return acc;
  }, emptyTally());

/** pass / (pass + fail); undefined without results that have a pass rule. */
export const passRate = (t: Tally): number | undefined =>
  t.pass + t.fail > 0 ? t.pass / (t.pass + t.fail) : undefined;

/** b - a, when both are known. */
export const rateDelta = (a?: number, b?: number): number | undefined =>
  a === undefined || b === undefined ? undefined : b - a;

/** The verdict rule of `VERDICT_EVAL`, for result documents. */
export const verdictOf = (r: { errorType?: string; label?: string }): Verdict =>
  r.errorType ? 'error' : r.label === 'pass' ? 'pass' : r.label === 'fail' ? 'fail' : 'scored';

/** Case status from its results: an evaluator error, else a failed result, else passed. */
export type CaseStatus = 'error' | 'fail' | 'pass';
export const caseStatusOf = (t: Tally): CaseStatus =>
  t.error ? 'error' : t.fail ? 'fail' : 'pass';

// ---------------------------------------------------------------------- record access

/** A field of a record: a column named by its path (aggregations) or nested (documents). */
export const get = (row: unknown, path: string): unknown => {
  if (row === null || typeof row !== 'object') return undefined;
  const record = row as Record<string, unknown>;
  if (path in record) return record[path];
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    const obj = current as Record<string, unknown>;
    current = part in obj ? obj[part] : undefined;
  }
  return current;
};

export const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

export const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** PPL timestamps are UTC without a zone (`2026-10-30 23:27:07.092156928`). */
export const parseTime = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = str(v);
  if (!s) return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    s
  );
  if (!m) return Date.parse(s);
  const frac = m[3] ? m[3].slice(0, 4) : '';
  return Date.parse(`${m[1]}T${m[2]}${frac}${m[4] ?? 'Z'}`);
};

const agentKey = (row: PplRecord) => str(get(row, F.agentName)) ?? NO_AGENT;
const minT = (a: number, b: number) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b));
const maxT = (a: number, b: number) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b));

// ---------------------------------------------------------------------- Agents and versions

export interface VersionStat {
  /** Undefined: results without `gen_ai.agent.version`. */
  version?: string;
  first: number;
  last: number;
  tally: Tally;
}

export interface AgentRow {
  agent: string;
  latest: VersionStat;
  previous?: VersionStat;
  rate?: number;
  previousRate?: number;
  delta?: number;
  n: number;
  last: number;
  /** Every version, by first result. */
  versions: VersionStat[];
}

/** Versions of rows that carry `first`, `last`, a version and a verdict, by first result. */
const versionsOf = (rows: PplRecord[]): VersionStat[] => {
  const byVersion = new Map<string, VersionStat>();
  rows.forEach((row) => {
    const version = str(get(row, F.agentVersion));
    const key = version ?? '';
    const v = byVersion.get(key) ?? {
      version,
      first: NaN,
      last: NaN,
      tally: emptyTally(),
    };
    v.first = minT(v.first, parseTime(row.first));
    v.last = maxT(v.last, parseTime(row.last ?? row.first));
    addToTally(v.tally, row.verdict, num(row.n) ?? 0);
    byVersion.set(key, v);
  });
  return [...byVersion.values()].sort((a, b) => a.first - b.first);
};

const agentRowOf = (agent: string, rows: PplRecord[]): AgentRow => {
  const versions = versionsOf(rows);
  const latest = versions[versions.length - 1];
  const previous = versions.length > 1 ? versions[versions.length - 2] : undefined;
  const rate = passRate(latest.tally);
  const previousRate = previous ? passRate(previous.tally) : undefined;
  return {
    agent,
    latest,
    previous,
    rate,
    previousRate,
    delta: rateDelta(previousRate, rate),
    n: versions.reduce((s, v) => s + v.tally.n, 0),
    last: versions.reduce((m, v) => maxT(m, v.last), NaN),
    versions,
  };
};

/** Agents table rows from `buildAgentsQuery`. */
export const agentRows = (rows: PplRecord[]): AgentRow[] => {
  const byAgent = new Map<string, PplRecord[]>();
  rows.forEach((row) => {
    const key = agentKey(row);
    byAgent.set(key, [...(byAgent.get(key) ?? []), row]);
  });
  return [...byAgent.entries()].map(([agent, list]) => agentRowOf(agent, list));
};

// ---------------------------------------------------------------------- Agent page

export interface EvaluationRow {
  name: string;
  latestRate?: number;
  previousRate?: number;
  delta?: number;
  n: number;
  /** Some result has a pass rule (pass or fail); otherwise the evaluation only scores. */
  hasPassRule: boolean;
}

export interface AgentEvaluations {
  /** The agent across its evaluations (versions, totals) for the page's header. */
  summary?: AgentRow;
  rows: EvaluationRow[];
}

/** From `buildAgentEvaluationsQuery`: the latest version against the one before it. */
export const agentEvaluations = (agent: string, rows: PplRecord[]): AgentEvaluations => {
  if (!rows.length) return { rows: [] };
  const summary = agentRowOf(agent, rows);
  const latest = summary.latest.version ?? '';
  const previous = summary.previous ? (summary.previous.version ?? '') : undefined;
  const byName = new Map<string, { latest: Tally; previous: Tally; all: Tally }>();
  rows.forEach((row) => {
    const name = str(get(row, F.name)) ?? '';
    const t = byName.get(name) ?? {
      latest: emptyTally(),
      previous: emptyTally(),
      all: emptyTally(),
    };
    const version = str(get(row, F.agentVersion)) ?? '';
    const n = num(row.n) ?? 0;
    if (version === latest) addToTally(t.latest, row.verdict, n);
    if (previous !== undefined && version === previous) addToTally(t.previous, row.verdict, n);
    addToTally(t.all, row.verdict, n);
    byName.set(name, t);
  });
  return {
    summary,
    rows: [...byName.entries()].map(([name, t]) => {
      const latestRate = passRate(t.latest);
      const previousRate = previous !== undefined ? passRate(t.previous) : undefined;
      return {
        name,
        latestRate,
        previousRate,
        delta: rateDelta(previousRate, latestRate),
        n: t.all.n,
        hasPassRule: t.all.pass + t.all.fail > 0,
      };
    }),
  };
};

export interface TrendPoint {
  t: number;
  rate: number;
}

/** From `buildAgentTrendQuery`: pass rate per bucket. */
export const trendPoints = (rows: PplRecord[]): TrendPoint[] => {
  const byT = new Map<number, Tally>();
  rows.forEach((row) => {
    const t = parseTime(row.t);
    if (Number.isNaN(t)) return;
    byT.set(t, addToTally(byT.get(t) ?? emptyTally(), row.verdict, num(row.n) ?? 0));
  });
  return [...byT.entries()]
    .map(([t, tally]) => ({ t, rate: passRate(tally) }))
    .filter((p): p is TrendPoint => p.rate !== undefined)
    .sort((a, b) => a.t - b.t);
};

/** A dashed marker where each version after the first in range starts. */
export const versionMarkers = (versions: VersionStat[]) =>
  versions.slice(1).map((v) => ({ t: v.first, label: v.version ?? '' }));

// ---------------------------------------------------------------------- Runs and suites

export interface RunRow {
  runId: string;
  suite?: string;
  agent?: string;
  version?: string;
  ciUrl?: string;
  started: number;
  tally: Tally;
  rate?: number;
}

const runsOf = (rows: PplRecord[]): RunRow[] => {
  const byRun = new Map<string, RunRow>();
  rows.forEach((row) => {
    const runId = str(get(row, F.runId));
    if (!runId) return;
    const r: RunRow = byRun.get(runId) ?? { runId, started: NaN, tally: emptyTally() };
    r.suite = r.suite ?? str(get(row, F.suiteName));
    r.agent = r.agent ?? str(get(row, F.agentName));
    r.version = r.version ?? str(get(row, F.agentVersion));
    r.ciUrl = r.ciUrl ?? str(get(row, F.ciUrl));
    r.started = minT(r.started, parseTime(row.started));
    addToTally(r.tally, row.verdict, num(row.n) ?? 0);
    byRun.set(runId, r);
  });
  return [...byRun.values()]
    .map((r) => ({ ...r, rate: passRate(r.tally) }))
    .sort((a, b) => a.started - b.started);
};

/** Suite page runs (oldest first) from `buildSuiteRunsQuery`. */
export const suiteRuns = (rows: PplRecord[]): RunRow[] => runsOf(rows);

export interface SuiteRow {
  suite: string;
  runs: number;
  last: RunRow;
  previous?: RunRow;
  delta?: number;
}

/** Agent Suites tab rows from `buildAgentSuitesQuery`. */
export const agentSuites = (rows: PplRecord[]): SuiteRow[] => {
  const bySuite = new Map<string, RunRow[]>();
  runsOf(rows).forEach((r) => {
    const suite = r.suite ?? '';
    bySuite.set(suite, [...(bySuite.get(suite) ?? []), r]);
  });
  return [...bySuite.entries()].map(([suite, runs]) => {
    const last = runs[runs.length - 1];
    const previous = runs.length > 1 ? runs[runs.length - 2] : undefined;
    return {
      suite,
      runs: runs.length,
      last,
      previous,
      delta: rateDelta(previous?.rate, last.rate),
    };
  });
};

// ---------------------------------------------------------------------- Run page

export interface CaseRow {
  caseId: string;
  caseName?: string;
  traceId?: string;
  /** First result time, for the trace link's range. */
  at: number;
  tally: Tally;
  status: CaseStatus;
  failed: string[];
  errored: string[];
  /** Tally per evaluation. */
  byEvaluation: Map<string, Tally>;
}

const casesOf = (rows: PplRecord[]): CaseRow[] => {
  const byCase = new Map<string, CaseRow>();
  rows.forEach((row) => {
    const caseId = str(get(row, F.caseId)) ?? '';
    const c: CaseRow = byCase.get(caseId) ?? {
      caseId,
      at: NaN,
      tally: emptyTally(),
      status: 'pass' as CaseStatus,
      failed: [],
      errored: [],
      byEvaluation: new Map<string, Tally>(),
    };
    c.caseName = c.caseName ?? str(get(row, F.caseName));
    c.traceId = c.traceId ?? str(get(row, F.traceId));
    c.at = minT(c.at, parseTime(row.t0 ?? row.started));
    const n = num(row.n) ?? 0;
    addToTally(c.tally, row.verdict, n);
    const name = str(get(row, F.name)) ?? '';
    c.byEvaluation.set(name, addToTally(c.byEvaluation.get(name) ?? emptyTally(), row.verdict, n));
    byCase.set(caseId, c);
  });
  return [...byCase.values()].map((c) => {
    const names = [...c.byEvaluation.entries()];
    return {
      ...c,
      status: caseStatusOf(c.tally),
      failed: names.filter(([, t]) => t.fail > 0).map(([name]) => name),
      errored: names.filter(([, t]) => t.error > 0).map(([name]) => name),
    };
  });
};

export interface RunDetail {
  runId: string;
  suite?: string;
  agent?: string;
  version?: string;
  ciUrl?: string;
  started: number;
  /** max - min `@timestamp` of the run's results. */
  durationMs: number;
  tally: Tally;
  rate?: number;
  cases: CaseRow[];
}

/** Run page from `buildRunCasesQuery`. Undefined when the run has no results in range. */
export const runDetail = (runId: string, rows: PplRecord[]): RunDetail | undefined => {
  if (!rows.length) return undefined;
  let started = NaN;
  let ended = NaN;
  const tally = emptyTally();
  const first = (path: string) =>
    rows.map((row) => str(get(row, path))).find((v) => v !== undefined);
  rows.forEach((row) => {
    started = minT(started, parseTime(row.t0));
    ended = maxT(ended, parseTime(row.t1 ?? row.t0));
    addToTally(tally, row.verdict, num(row.n) ?? 0);
  });
  return {
    runId,
    suite: first(F.suiteName),
    agent: first(F.agentName),
    version: first(F.agentVersion),
    ciUrl: first(F.ciUrl),
    started,
    durationMs: Number.isNaN(ended - started) ? 0 : ended - started,
    tally,
    rate: passRate(tally),
    cases: casesOf(rows),
  };
};

// ---------------------------------------------------------------------- Compare runs

export type CaseChange = 'regressed' | 'fixed' | 'changed' | 'same';

export interface CompareSide {
  runId: string;
  version?: string;
  started: number;
  rate?: number;
  casesPassed: number;
  cases: number;
}

export interface CompareCaseRow {
  caseId: string;
  caseName?: string;
  a?: CaseStatus;
  b?: CaseStatus;
  change: CaseChange;
  traceA?: string;
  traceB?: string;
}

export interface CompareEvalRow {
  name: string;
  a?: number;
  b?: number;
  delta?: number;
}

export interface Comparison {
  suite?: string;
  agent?: string;
  a: CompareSide;
  b: CompareSide;
  cases: CompareCaseRow[];
  evaluations: CompareEvalRow[];
}

export const changeOf = (a?: CaseStatus, b?: CaseStatus): CaseChange => {
  if (a === b) return 'same';
  if (a === 'pass' && b !== undefined) return 'regressed';
  if (b === 'pass' && a !== undefined) return 'fixed';
  return 'changed';
};

/** Compare page from `buildCompareRunsQuery`; cases are matched on `test.case.id`. */
export const comparison = (runA: string, runB: string, rows: PplRecord[]): Comparison => {
  const of = (runId: string) => rows.filter((row) => str(get(row, F.runId)) === runId);
  const side = (runId: string, list: PplRecord[], cases: CaseRow[]): CompareSide => {
    const tally = mergeTallies(cases.map((c) => c.tally));
    return {
      runId,
      version: list.map((row) => str(get(row, F.agentVersion))).find(Boolean),
      started: list.reduce((m, row) => minT(m, parseTime(row.started)), NaN),
      rate: passRate(tally),
      casesPassed: cases.filter((c) => c.status === 'pass').length,
      cases: cases.length,
    };
  };
  const rowsA = of(runA);
  const rowsB = of(runB);
  const casesA = casesOf(rowsA);
  const casesB = casesOf(rowsB);
  const byIdA = new Map(casesA.map((c) => [c.caseId, c]));
  const byIdB = new Map(casesB.map((c) => [c.caseId, c]));
  const ids = [...new Set([...byIdA.keys(), ...byIdB.keys()])];
  const evalTally = (cases: CaseRow[], name: string) =>
    mergeTallies(cases.map((c) => c.byEvaluation.get(name) ?? emptyTally()));
  const names = [
    ...new Set([...casesA, ...casesB].flatMap((c) => [...c.byEvaluation.keys()])),
  ].sort();
  const first = (path: string) =>
    rows.map((row) => str(get(row, path))).find((v) => v !== undefined);
  return {
    suite: first(F.suiteName),
    agent: first(F.agentName),
    a: side(runA, rowsA, casesA),
    b: side(runB, rowsB, casesB),
    cases: ids.map((caseId) => {
      const ca = byIdA.get(caseId);
      const cb = byIdB.get(caseId);
      return {
        caseId,
        caseName: ca?.caseName ?? cb?.caseName,
        a: ca?.status,
        b: cb?.status,
        change: changeOf(ca?.status, cb?.status),
        traceA: ca?.traceId,
        traceB: cb?.traceId,
      };
    }),
    evaluations: names.map((name) => {
      const a = passRate(evalTally(casesA, name));
      const b = passRate(evalTally(casesB, name));
      return { name, a, b, delta: rateDelta(a, b) };
    }),
  };
};

// ---------------------------------------------------------------------- Result documents

export interface EvalResult {
  /** Unique within a list: time, trace, span and name. */
  id: string;
  time: number;
  name: string;
  verdict: Verdict;
  value?: number;
  label?: string;
  explanation?: string;
  errorType?: string;
  agentName?: string;
  agentVersion?: string;
  traceId?: string;
  spanId?: string;
  /** `opensearch.evaluation.level`, else span when there is a span id, else trace. */
  level: string;
  evaluatorName?: string;
  evaluatorType?: string;
  scoreMin?: number;
  scoreMax?: number;
  suiteName?: string;
  runId?: string;
  caseId?: string;
  caseName?: string;
  conversationId?: string;
  scope?: string;
  /** The document as read. */
  raw: PplRecord;
}

export const levelOf = (declared: string | undefined, spanId: string | undefined) =>
  (declared ?? (spanId ? 'span' : 'trace')).toLowerCase();

export const recordToResult = (row: PplRecord, index = 0): EvalResult => {
  const s = (path: string) => str(get(row, path));
  const traceId = s(F.traceId);
  const spanId = s(F.spanId);
  const name = s(F.name) ?? '';
  const time = parseTime(row['@timestamp'] ?? row.time);
  const errorType = s(F.errorType);
  const label = s(F.label);
  return {
    id: [String(row['@timestamp'] ?? ''), traceId ?? '', spanId ?? '', name, index].join('|'),
    time,
    name,
    verdict: verdictOf({ errorType, label }),
    value: num(get(row, F.value)),
    label,
    explanation: s(F.explanation),
    errorType,
    agentName: s(F.agentName),
    agentVersion: s(F.agentVersion),
    traceId,
    spanId,
    level: levelOf(s(F.level), spanId),
    evaluatorName: s(F.evaluatorName),
    evaluatorType: s(F.evaluatorType),
    scoreMin: num(get(row, F.scoreMin)),
    scoreMax: num(get(row, F.scoreMax)),
    suiteName: s(F.suiteName),
    runId: s(F.runId),
    caseId: s(F.caseId),
    caseName: s(F.caseName),
    conversationId: s(F.conversationId),
    scope: s(F.scope),
    raw: row,
  };
};

export const recordsToResults = (rows: PplRecord[]): EvalResult[] => rows.map(recordToResult);

/** Trace-level results mark the root span; span results mark their span. */
export const isSpanResult = (r: Pick<EvalResult, 'level' | 'spanId'>) =>
  !!r.spanId && r.level !== 'trace';

export const tallyOf = (results: Array<Pick<EvalResult, 'verdict'>>): Tally =>
  results.reduce((t, r) => addToTally(t, r.verdict), emptyTally());

/** Facet values from `buildFacetQuery`. */
export const facetValues = (rows: PplRecord[], key: string): Array<{ value: string; n: number }> =>
  rows.map((row) => ({ value: str(get(row, key)) ?? NO_AGENT, n: num(row.n) ?? 0 }));
