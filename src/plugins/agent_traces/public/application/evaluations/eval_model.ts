/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { F, NO_AGENT } from './ppl_queries';

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

/**
 * Case status from its results: an evaluator error, else a failed result, else passed when a
 * result passed, else scored (only scores without a pass rule: neither pass nor fail).
 */
export type CaseStatus = 'error' | 'fail' | 'pass' | 'scored';
export const caseStatusOf = (t: Tally): CaseStatus =>
  t.error ? 'error' : t.fail ? 'fail' : t.pass ? 'pass' : 'scored';

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

/** Under this many results with a pass rule on either side, a change is shown greyed. */
export const MIN_N = 30;

/** One evaluation within one version. */
export interface EvalStat {
  tally: Tally;
  /** pass / (pass + fail). */
  rate?: number;
  /** Some result has a pass rule (pass or fail). */
  hasPassRule: boolean;
  /** Average score of the results that carry one (evaluator errors left out). */
  avg?: number;
  /** Results behind `avg`. */
  nv: number;
  /** Most common label of the scored results, and its share of all results. */
  top?: { label: string; share: number };
  /** `opensearch.gen_ai.evaluation.score.direction`: `minimize` means lower is better. */
  direction?: string;
}

export interface VersionStat {
  /** Undefined: results without `gen_ai.agent.version`. */
  version?: string;
  first: number;
  last: number;
  tally: Tally;
  /** Share of the version's results with a pass rule that passed: pass / (pass + fail). */
  rate?: number;
  /** Results with a pass rule (pass + fail). */
  decided: number;
  evaluations: Map<string, EvalStat>;
}

interface EvalAcc {
  tally: Tally;
  sum: number;
  nv: number;
  labels: Map<string, number>;
  direction?: string;
}

const finishEval = (a: EvalAcc): EvalStat => {
  const top = [...a.labels.entries()].sort((x, y) => y[1] - x[1])[0];
  return {
    tally: a.tally,
    rate: passRate(a.tally),
    hasPassRule: a.tally.pass + a.tally.fail > 0,
    avg: a.nv ? a.sum / a.nv : undefined,
    nv: a.nv,
    top: top && a.tally.n ? { label: top[0], share: top[1] / a.tally.n } : undefined,
    direction: a.direction,
  };
};

/**
 * Versions of aggregated rows (a version, an evaluation name, a verdict, `n`, `first` and
 * `last`; the Evaluations table adds a label, a direction, `nv` and `avg_score`), by first
 * result.
 */
export const versionsOf = (rows: PplRecord[]): VersionStat[] => {
  const byVersion = new Map<string, { v: VersionStat; evals: Map<string, EvalAcc> }>();
  rows.forEach((row) => {
    const version = str(get(row, F.agentVersion));
    const key = version ?? '';
    const entry = byVersion.get(key) ?? {
      v: {
        version,
        first: NaN,
        last: NaN,
        tally: emptyTally(),
        decided: 0,
        evaluations: new Map(),
      },
      evals: new Map<string, EvalAcc>(),
    };
    const n = num(row.n) ?? 0;
    entry.v.first = minT(entry.v.first, parseTime(row.first));
    entry.v.last = maxT(entry.v.last, parseTime(row.last ?? row.first));
    addToTally(entry.v.tally, row.verdict, n);
    const name = str(get(row, F.name)) ?? '';
    const acc = entry.evals.get(name) ?? {
      tally: emptyTally(),
      sum: 0,
      nv: 0,
      labels: new Map<string, number>(),
    };
    addToTally(acc.tally, row.verdict, n);
    const nv = num(row.nv) ?? 0;
    const avg = num(row.avg_score);
    if (row.verdict !== 'error' && nv > 0 && avg !== undefined) {
      acc.sum += avg * nv;
      acc.nv += nv;
    }
    const label = str(get(row, F.label));
    if (label && row.verdict === 'scored') acc.labels.set(label, (acc.labels.get(label) ?? 0) + n);
    acc.direction = acc.direction ?? str(get(row, F.scoreDirection));
    entry.evals.set(name, acc);
    byVersion.set(key, entry);
  });
  return [...byVersion.values()]
    .map(({ v, evals }) => {
      const evaluations = new Map([...evals.entries()].map(([k, a]) => [k, finishEval(a)]));
      return {
        ...v,
        evaluations,
        rate: passRate(v.tally),
        decided: v.tally.pass + v.tally.fail,
      };
    })
    .sort((a, b) => a.first - b.first);
};

/** Versions with the most recent result first. */
export const byRecent = (versions: VersionStat[]): VersionStat[] =>
  [...versions].sort((a, b) => b.last - a.last);

export interface AgentRow {
  agent: string;
  /** Every version, most recent result first. */
  versions: VersionStat[];
  /** Over every version (agents without a version show one pass rate). */
  rate?: number;
  n: number;
  last: number;
}

const agentRowOf = (agent: string, rows: PplRecord[]): AgentRow => {
  const versions = byRecent(versionsOf(rows));
  const all = versionsOf(rows.map((row) => ({ ...row, [F.agentVersion]: null })))[0];
  return {
    agent,
    versions,
    rate: all?.rate,
    n: versions.reduce((s, v) => s + v.tally.n, 0),
    last: versions.reduce((m, v) => maxT(m, v.last), NaN),
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

/** An Agents table row: one version of an agent. */
export interface AgentVersionRow {
  /** `<agent>/<version key>`. */
  id: string;
  agent: string;
  /** Undefined: results without `gen_ai.agent.version`. */
  version?: string;
  /** Share of the version's results with a pass rule that passed: pass / (pass + fail). */
  rate?: number;
  /** Results with a pass rule (pass + fail). */
  decided: number;
  n: number;
  last: number;
}

/** Agents table rows from `buildAgentsQuery`: one row per agent and version. */
export const agentVersionRows = (rows: PplRecord[]): AgentVersionRow[] =>
  agentRows(rows).flatMap((agent) =>
    agent.versions.map((v) => ({
      id: `${agent.agent}/${versionKey(v)}`,
      agent: agent.agent,
      version: v.version,
      rate: v.rate,
      decided: v.decided,
      n: v.tally.n,
      last: v.last,
    }))
  );

// ---------------------------------------------------------------------- Agent page

/** The version key of a version stat ('' when the results carry none). */
export const versionKey = (v?: VersionStat) => v?.version ?? '';

export interface EvaluationRow {
  name: string;
  /** Version B (the one compared) and version A (the baseline). */
  b?: EvalStat;
  a?: EvalStat;
  hasPassRule: boolean;
  /** b - a: pass rate, else average score (raw, see `direction`); undefined otherwise. */
  delta?: number;
}

/**
 * Every result of the row (in each version it has) is an evaluator error: there is no score, label
 * or pass rule to describe, so the row shows its errors only.
 */
export const allErrored = (r: Pick<EvaluationRow, 'a' | 'b'>): boolean => {
  const sides = [r.b, r.a].filter((s): s is EvalStat => !!s);
  return sides.length > 0 && sides.every((s) => s.tally.n > 0 && s.tally.error === s.tally.n);
};

export interface AgentEvaluations {
  /** The agent across its evaluations (versions, totals) for the page's header. */
  summary?: AgentRow;
  versions: VersionStat[];
}

/**
 * Offline rows (grouped by run too): each version's latest run only, so versions compare run
 * against run rather than one run against the average of many.
 */
export const latestRunPerVersion = (rows: PplRecord[]): PplRecord[] => {
  const versionOf = (row: PplRecord) => str(get(row, F.agentVersion)) ?? '';
  // A run's start: its earliest result; per version, the run that started last.
  const starts = new Map<string, { version: string; started: number }>();
  rows.forEach((row) => {
    const runId = str(get(row, F.runId));
    if (!runId) return;
    const cur = starts.get(runId);
    starts.set(runId, {
      version: versionOf(row),
      started: minT(cur?.started ?? NaN, parseTime(row.first)),
    });
  });
  const latest = new Map<string, { runId: string; started: number }>();
  starts.forEach(({ version, started }, runId) => {
    const cur = latest.get(version);
    if (!cur || started > cur.started) latest.set(version, { runId, started });
  });
  return rows.filter((row) => {
    const runId = str(get(row, F.runId));
    return !runId || latest.get(versionOf(row))?.runId === runId;
  });
};

/** From `buildAgentEvaluationsQuery`: every version of the agent with its evaluations. */
export const agentEvaluations = (agent: string, rows: PplRecord[]): AgentEvaluations =>
  rows.length
    ? { summary: agentRowOf(agent, rows), versions: byRecent(versionsOf(rows)) }
    : { versions: [] };

/** The default pair: the two versions with the most recent results (B the newer). */
export const defaultVersionPair = (
  versions: VersionStat[],
  picked: { b?: string; a?: string } = {}
): { b?: string; a?: string } => {
  const keys = byRecent(versions).map(versionKey);
  const b = picked.b !== undefined && keys.includes(picked.b) ? picked.b : keys[0];
  const a =
    picked.a !== undefined && keys.includes(picked.a) && picked.a !== b
      ? picked.a
      : keys.find((k) => k !== b);
  return { b, a };
};

/** The Evaluations table: every evaluation of the agent, version B against version A. */
export const evaluationRows = (
  versions: VersionStat[],
  b?: string,
  a?: string
): EvaluationRow[] => {
  const vb = versions.find((v) => versionKey(v) === b);
  const va = a === undefined ? undefined : versions.find((v) => versionKey(v) === a);
  const names = [...new Set(versions.flatMap((v) => [...v.evaluations.keys()]))];
  return names.map((name) => {
    const sb = vb?.evaluations.get(name);
    const sa = va?.evaluations.get(name);
    const hasPassRule = !!(sb ?? sa)?.hasPassRule;
    const delta = !sa || !sb ? undefined : hasPassRule ? rateDelta(sa.rate, sb.rate) : undefined;
    return { name, b: sb, a: sa, hasPassRule, delta };
  });
};

export interface TrendSeries {
  version?: string;
  points: Array<{ t: number; rate: number; n: number }>;
  /** Results with a pass rule in the range. */
  n: number;
}

export const TREND_VERSIONS = 5;

/** From `buildAgentTrendQuery`: pass rate per bucket, one series per version (top 5 by results). */
export const trendSeries = (rows: PplRecord[], limit = TREND_VERSIONS): TrendSeries[] => {
  const byVersion = new Map<string, { version?: string; byT: Map<number, Tally> }>();
  rows.forEach((row) => {
    const t = parseTime(row.t);
    if (Number.isNaN(t)) return;
    const version = str(get(row, F.agentVersion));
    const entry = byVersion.get(version ?? '') ?? { version, byT: new Map<number, Tally>() };
    entry.byT.set(t, addToTally(entry.byT.get(t) ?? emptyTally(), row.verdict, num(row.n) ?? 0));
    byVersion.set(version ?? '', entry);
  });
  return [...byVersion.values()]
    .map(({ version, byT }) => {
      const points = [...byT.entries()]
        .map(([t, tally]) => ({ t, rate: passRate(tally), n: tally.pass + tally.fail }))
        .filter((p): p is { t: number; rate: number; n: number } => p.rate !== undefined)
        .sort((x, y) => x.t - y.t);
      return { version, points, n: points.reduce((s, p) => s + p.n, 0) };
    })
    .filter((s) => s.points.length)
    .sort((x, y) => y.n - x.n)
    .slice(0, limit);
};

// ---------------------------------------------------------------------- Runs and suites

export interface RunRow {
  runId: string;
  suite?: string;
  agent?: string;
  version?: string;
  started: number;
  tally: Tally;
  rate?: number;
  /** `opensearch.test.suite.run.name` / `.description`, from `withRunNames`. */
  name?: string;
  description?: string;
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

/** Eval runs tab rows (latest first) from `buildEvalRunsQuery`. */
export const evalRuns = (rows: PplRecord[]): RunRow[] => runsOf(rows).reverse();

/** Two runs that compare: the same suite and the same agent, not the same run. */
export const isCompatibleRun = (
  a: Pick<RunRow, 'runId' | 'suite' | 'agent'>,
  b: Pick<RunRow, 'runId' | 'suite' | 'agent'>
): boolean =>
  a.runId !== b.runId && a.suite !== undefined && a.suite === b.suite && a.agent === b.agent;

/** Cases (and cases passed) per run, from `buildSuiteRunCasesQuery`. */
export const runCases = (rows: PplRecord[]): Map<string, { cases: number; passed: number }> =>
  new Map(
    rows
      .map((row): [string | undefined, { cases: number; passed: number }] => [
        str(get(row, F.runId)),
        { cases: num(row.cases) ?? 0, passed: num(row.passed) ?? 0 },
      ])
      .filter((e): e is [string, { cases: number; passed: number }] => !!e[0])
  );

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
  started: number;
  /** max - min `@timestamp` of the run's results. */
  durationMs: number;
  tally: Tally;
  rate?: number;
  cases: CaseRow[];
  /** Cases that passed. */
  casesPassed: number;
  /** Evaluation names, sorted. */
  evaluations: string[];
}

/**
 * Run page from `buildRunCasesQuery` (rows of other runs are left out). Undefined when the run
 * has no results in range. Case names come from `caseNamesOf` (`withCaseNames`).
 */
export const runDetail = (runId: string, allRows: PplRecord[]): RunDetail | undefined => {
  const rows = allRows.filter((row) => {
    const id = str(get(row, F.runId));
    return id === undefined || id === runId;
  });
  if (!rows.length) return undefined;
  let started = NaN;
  let ended = NaN;
  const tally = emptyTally();
  const first = (path: string) =>
    rows.map((row) => str(get(row, path))).find((v) => v !== undefined);
  const cases = casesOf(rows);
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
    started,
    durationMs: Number.isNaN(ended - started) ? 0 : ended - started,
    tally,
    rate: passRate(tally),
    cases,
    casesPassed: cases.filter((c) => c.status === 'pass').length,
    evaluations: [...new Set(rows.map((row) => str(get(row, F.name)) ?? ''))].sort(),
  };
};

export interface RunRef {
  runId: string;
  suite?: string;
  agent?: string;
  started: number;
}

const runRefsOf = (rows: PplRecord[]): RunRef[] =>
  rows.map((row) => ({
    runId: str(get(row, F.runId)) ?? '',
    suite: str(get(row, F.suiteName)),
    agent: str(get(row, F.agentName)),
    started: parseTime(row.started),
  }));

/** `buildRunsLookupQuery` runs other than `runId` of its suite and agent, and `runId`'s own. */
const sameSuiteAndAgent = (rows: PplRecord[], runId: string) => {
  const runs = runRefsOf(rows);
  const self = runs.find((r) => r.runId === runId);
  return { self, others: self ? runs.filter((r) => isCompatibleRun(self, r)) : [] };
};

/**
 * From `buildRunsLookupQuery`: the run of the same suite and agent that started last before
 * `runId` (another agent's run of the suite does not compare).
 */
export const runBefore = (rows: PplRecord[], runId: string): RunRef | undefined => {
  const { self, others } = sameSuiteAndAgent(rows, runId);
  if (!self) return undefined;
  return others.filter((r) => r.started < self.started).sort((a, b) => b.started - a.started)[0];
};

/** The number of other runs of a run's suite and agent in `buildRunsLookupQuery` rows. */
export const otherRunsOfSuite = (rows: PplRecord[], runId: string): number =>
  sameSuiteAndAgent(rows, runId).others.length;

// ---------------------------------------------------------------------- Run names

/** A run's optional name and description, and its CI run link. */
export interface RunName {
  name?: string;
  description?: string;
  /** `cicd.pipeline.run.url.full`, the run page header's CI link. */
  ciUrl?: string;
}

/**
 * Name, description and CI link per run, from `buildRunNamesQuery` documents (runs with none
 * of them: none).
 */
export const runNamesOf = (rows: PplRecord[]): Map<string, RunName> => {
  const out = new Map<string, RunName>();
  rows.forEach((row) => {
    const runId = str(get(row, F.runId));
    if (!runId || out.has(runId)) return;
    const name = str(get(row, F.runName))?.trim() || undefined;
    const description = str(get(row, F.runDescription))?.trim() || undefined;
    const ciUrl = str(get(row, F.ciUrl))?.trim() || undefined;
    if (name || description || ciUrl) out.set(runId, { name, description, ciUrl });
  });
  return out;
};

/** The name of each case (`test.case.name`), from `buildCaseNamesQuery` documents. */
export const caseNamesOf = (rows: PplRecord[]): Map<string, string> => {
  const out = new Map<string, string>();
  rows.forEach((row) => {
    const caseId = str(get(row, F.caseId));
    const name = str(get(row, F.caseName))?.trim();
    if (caseId && name && !out.has(caseId)) out.set(caseId, name);
  });
  return out;
};

/** The cases (run page, Compare runs) with their names, when there is one. */
export const withCaseNames = <T extends { caseId: string; caseName?: string }>(
  cases: T[],
  names: Map<string, string>
): T[] =>
  names.size === 0
    ? cases
    : cases.map((c) => (names.has(c.caseId) ? { ...c, caseName: names.get(c.caseId) } : c));

/** The runs with their names (when there is one). */
export const withRunNames = <T extends { runId: string }>(
  runs: T[],
  names: Map<string, RunName>
): Array<T & RunName> =>
  names.size === 0
    ? runs
    : runs.map((r) => {
        const n = names.get(r.runId);
        return n ? { ...r, name: n.name, description: n.description } : r;
      });

// ---------------------------------------------------------------------- Compare runs

/** `onlyA` / `onlyB`: the case has results in one run only. */
export type CaseChange = 'regressed' | 'fixed' | 'changed' | 'onlyA' | 'onlyB' | 'same';

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
  /** Results with a pass rule in each run. */
  nA: number;
  nB: number;
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
  if (a === undefined) return 'onlyB';
  if (b === undefined) return 'onlyA';
  const bad = (s: CaseStatus) => s === 'fail' || s === 'error';
  if (a === 'pass' && bad(b)) return 'regressed';
  if (b === 'pass' && bad(a)) return 'fixed';
  // Between fail and error, or to or from scored (no pass rule): changed, not a regression.
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
      const ta = evalTally(casesA, name);
      const tb = evalTally(casesB, name);
      const a = passRate(ta);
      const b = passRate(tb);
      return { name, a, b, delta: rateDelta(a, b), nA: ta.pass + ta.fail, nB: tb.pass + tb.fail };
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
  /** `gen_ai.evaluation.score.label`: the verdict (`pass` / `fail`), or the judge's label. */
  label?: string;
  /**
   * The judge's own label (`opensearch.gen_ai.evaluation.judge_label`), set by the SDKs when
   * `label` holds the pass/fail verdict. Display only: the verdict never reads it.
   */
  judgeLabel?: string;
  explanation?: string;
  errorType?: string;
  agentName?: string;
  agentVersion?: string;
  traceId?: string;
  spanId?: string;
  /** `opensearch.gen_ai.evaluation.level`, else span when there is a span id, else trace. */
  level: string;
  evaluatorName?: string;
  evaluatorType?: string;
  evaluatorVersion?: string;
  /** What the evaluator checks (`opensearch.gen_ai.evaluation.evaluator.description`). */
  evaluatorDescription?: string;
  /** The LLM judge's model (`gen_ai.request.model`). */
  judgeModel?: string;
  /** The judge prompt template (`gen_ai.prompt.name` / `gen_ai.prompt.version`). */
  promptName?: string;
  promptVersion?: string;
  /** The judge's system prompt (`gen_ai.system_instructions`), opt-in in the SDKs. */
  systemInstructions?: string;
  systemInstructionsTruncated: boolean;
  scoreMin?: number;
  scoreMax?: number;
  scoreThreshold?: number;
  scoreDirection?: string;
  /** The judge's own trace (`opensearch.gen_ai.evaluation.judge.trace_id`). */
  judgeTraceId?: string;
  /** Expected output of the case (`opensearch.test.case.expected`), offline only. */
  expected?: string;
  expectedTruncated: boolean;
  suiteName?: string;
  runId?: string;
  /** `opensearch.test.suite.run.name` / `.description`, offline only. */
  runName?: string;
  runDescription?: string;
  caseId?: string;
  caseName?: string;
  /** `cicd.pipeline.run.url.full`, offline only. */
  ciUrl?: string;
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
    judgeLabel: s(F.judgeLabel),
    explanation: s(F.explanation),
    errorType,
    agentName: s(F.agentName),
    agentVersion: s(F.agentVersion),
    traceId,
    spanId,
    level: levelOf(s(F.level), spanId),
    evaluatorName: s(F.evaluatorName),
    evaluatorType: s(F.evaluatorType),
    evaluatorVersion: s(F.evaluatorVersion),
    evaluatorDescription: s(F.evaluatorDescription),
    judgeModel: s(F.judgeModel),
    promptName: s(F.promptName),
    promptVersion: s(F.promptVersion),
    systemInstructions: s(F.systemInstructions),
    systemInstructionsTruncated: String(get(row, F.systemInstructionsTruncated)) === 'true',
    scoreMin: num(get(row, F.scoreMin)),
    scoreMax: num(get(row, F.scoreMax)),
    scoreThreshold: num(get(row, F.scoreThreshold)),
    scoreDirection: s(F.scoreDirection),
    judgeTraceId: s(F.judgeTraceId),
    expected: s(F.caseExpected),
    expectedTruncated: String(get(row, F.caseExpectedTruncated)) === 'true',
    suiteName: s(F.suiteName),
    runId: s(F.runId),
    runName: s(F.runName),
    runDescription: s(F.runDescription),
    caseId: s(F.caseId),
    caseName: s(F.caseName),
    ciUrl: s(F.ciUrl),
    conversationId: s(F.conversationId),
    scope: s(F.scope),
    raw: row,
  };
};

export const recordsToResults = (rows: PplRecord[]): EvalResult[] => rows.map(recordToResult);

/**
 * What a case's input and output are read from, for its trace: the span its trace-level results
 * point to, else the span most of its results point to (the SDK points offline results at the
 * agent span), else none, and the trace's AI root is read.
 */
export const caseSpanOf = (
  results: Array<Pick<EvalResult, 'traceId' | 'spanId' | 'level'>>,
  traceId?: string
): { traceId?: string; spanId?: string } => {
  const own = results.filter((r) => r.spanId && (!traceId || r.traceId === traceId));
  const top = (list: typeof own) => {
    const counts = new Map<string, number>();
    list.forEach((r) => r.spanId && counts.set(r.spanId, (counts.get(r.spanId) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return {
    traceId: traceId ?? own[0]?.traceId,
    spanId: top(own.filter((r) => r.level === 'trace')) ?? top(own),
  };
};

/** Trace-level results mark the root span; span results mark their span. */
export const isSpanResult = (r: Pick<EvalResult, 'level' | 'spanId'>) =>
  !!r.spanId && r.level !== 'trace';

export const tallyOf = (results: Array<Pick<EvalResult, 'verdict'>>): Tally =>
  results.reduce((t, r) => addToTally(t, r.verdict), emptyTally());

/** Facet values from `buildFacetQuery`. */
export const facetValues = (rows: PplRecord[], key: string): Array<{ value: string; n: number }> =>
  rows.map((row) => ({ value: str(get(row, key)) ?? NO_AGENT, n: num(row.n) ?? 0 }));
