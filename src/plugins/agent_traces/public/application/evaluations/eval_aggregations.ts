/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvalOutcome, EvalResult, normalizedScore } from './eval_data';

/**
 * Client-side rollups of evaluation results for the Agent Evaluations pages: KPIs, time
 * buckets, evaluation runs and run comparison. Inputs are the results fetched for the
 * current filters; outputs are plain data the views render.
 */

/**
 * Epoch millis of a PPL or ISO timestamp. PPL returns `2026-10-26 09:03:33.255342898` in UTC
 * without a zone; ISO strings keep theirs. NaN when unparseable.
 */
export const parseEvalTime = (time: string | undefined): number => {
  if (!time) return NaN;
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      time.trim()
    );
  if (!match) return Date.parse(time);
  const [, date, clock, fraction = '', zone = 'Z'] = match;
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
  return Date.parse(`${date}T${clock}${millis}${zone}`);
};

export interface TimeBoundsMs {
  from: number;
  to: number;
}

/** The equal-length period right before `bounds`, for deltas. */
export const previousPeriod = ({ from, to }: TimeBoundsMs): TimeBoundsMs => ({
  from: from - (to - from),
  to: from,
});

/** Results passing the client-side filters (the outcome is computed in the browser). */
export const applyClientFilters = (
  results: EvalResult[],
  { failingOnly }: { failingOnly?: boolean }
): EvalResult[] => (failingOnly ? results.filter((r) => r.outcome === 'fail') : results);

// ---------------------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------------------

export interface EvalKpis {
  results: number;
  evaluators: number;
  /** Share of pass among pass and fail results (neutral excluded); undefined without any. */
  passRate?: number;
  failing: number;
  traces: number;
  sessions: number;
}

export const computeKpis = (results: EvalResult[]): EvalKpis => {
  const pass = results.filter((r) => r.outcome === 'pass').length;
  const fail = results.filter((r) => r.outcome === 'fail').length;
  const distinct = (values: Array<string | undefined>) =>
    new Set(values.filter((v): v is string => !!v)).size;
  return {
    results: results.length,
    evaluators: distinct(results.map((r) => r.name)),
    passRate: pass + fail > 0 ? pass / (pass + fail) : undefined,
    failing: fail,
    traces: distinct(results.map((r) => r.traceId)),
    sessions: distinct(results.map((r) => r.sessionId)),
  };
};

/** Pass rate of a set of results, ignoring neutral ones. */
export const passRateOf = (results: EvalResult[]): number | undefined =>
  computeKpis(results).passRate;

// ---------------------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------------------

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NICE_INTERVALS = [
  MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  7 * DAY,
  30 * DAY,
];

/** A round bucket size giving at most about `target` buckets over the range. */
export const pickInterval = ({ from, to }: TimeBoundsMs, target = 30): number => {
  const raw = Math.max(1, to - from) / target;
  return NICE_INTERVALS.find((i) => i >= raw) ?? NICE_INTERVALS[NICE_INTERVALS.length - 1];
};

const bucketOf = (time: number, interval: number) => Math.floor(time / interval) * interval;

export interface OutcomeBucket {
  x: number;
  outcome: EvalOutcome;
  count: number;
}

/** Result counts per time bucket and outcome, for stacked bars. Empty buckets are omitted. */
export const bucketOutcomes = (results: EvalResult[], interval: number): OutcomeBucket[] => {
  const counts = new Map<string, OutcomeBucket>();
  results.forEach((r) => {
    const t = parseEvalTime(r.time);
    if (!Number.isFinite(t)) return;
    const x = bucketOf(t, interval);
    const key = `${x}|${r.outcome}`;
    const bucket = counts.get(key) ?? { x, outcome: r.outcome, count: 0 };
    bucket.count += 1;
    counts.set(key, bucket);
  });
  return Array.from(counts.values()).sort((a, b) => a.x - b.x);
};

export interface TrendPoint {
  x: number;
  name: string;
  /** Mean normalized score 0..1 (higher is better) of the evaluation in the bucket. */
  value: number;
  count: number;
}

/** Normalized mean score per evaluation name and time bucket. */
export const scoreTrend = (results: EvalResult[], interval: number): TrendPoint[] => {
  const sums = new Map<string, { x: number; name: string; sum: number; count: number }>();
  results.forEach((r) => {
    const t = parseEvalTime(r.time);
    const score = normalizedScore(r);
    if (!Number.isFinite(t) || score === undefined) return;
    const x = bucketOf(t, interval);
    const key = `${r.name}|${x}`;
    const entry = sums.get(key) ?? { x, name: r.name, sum: 0, count: 0 };
    entry.sum += score;
    entry.count += 1;
    sums.set(key, entry);
  });
  return Array.from(sums.values())
    .map(({ x, name, sum, count }) => ({ x, name, value: sum / count, count }))
    .sort((a, b) => a.x - b.x || a.name.localeCompare(b.name));
};

// ---------------------------------------------------------------------------------------
// Evaluation runs (offline experiments grouped by `test.suite.run.id`)
// ---------------------------------------------------------------------------------------

/** Aggregate of one evaluation name over a set of results. */
export interface EvaluatorAggregate {
  name: string;
  count: number;
  /** Mean raw score value, when the evaluation reports numbers. */
  mean?: number;
  /** Mean normalized score 0..1, higher is better. */
  normalizedMean?: number;
  passRate?: number;
  /** Most frequent label. */
  topLabel?: string;
}

export const aggregateEvaluator = (name: string, results: EvalResult[]): EvaluatorAggregate => {
  const values = results.map((r) => r.value).filter((v): v is number => v !== undefined);
  const normalized = results.map(normalizedScore).filter((v): v is number => v !== undefined);
  const labels = new Map<string, number>();
  results.forEach((r) => r.label && labels.set(r.label, (labels.get(r.label) ?? 0) + 1));
  const topLabel = Array.from(labels.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    name,
    count: results.length,
    mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined,
    normalizedMean: normalized.length
      ? normalized.reduce((s, v) => s + v, 0) / normalized.length
      : undefined,
    passRate: passRateOf(results),
    topLabel,
  };
};

const groupBy = <K>(results: EvalResult[], key: (r: EvalResult) => K): Map<K, EvalResult[]> => {
  const groups = new Map<K, EvalResult[]>();
  results.forEach((r) => {
    const k = key(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  });
  return groups;
};

export type CaseStatus = 'pass' | 'fail' | 'unknown';

/**
 * A test case passes when its reported status says so; without a status, when every
 * evaluation of the case passed (any failing evaluation fails it).
 */
export const caseStatusOf = (results: EvalResult[]): CaseStatus => {
  const reported = results.map((r) => r.caseStatus?.toLowerCase()).find((s) => !!s);
  if (reported === 'pass' || reported === 'passed') return 'pass';
  if (reported === 'fail' || reported === 'failed' || reported === 'error') return 'fail';
  if (results.some((r) => r.outcome === 'fail')) return 'fail';
  if (results.some((r) => r.outcome === 'pass')) return 'pass';
  return 'unknown';
};

/** Normalized-score drop that counts as a regression or an improvement. */
export const CHANGE_THRESHOLD = 0.05;

export interface RunSummary {
  runId: string;
  suiteName?: string;
  /** Earliest and latest result time (epoch millis). */
  started: number;
  ended: number;
  results: number;
  cases: number;
  casesPassed: number;
  casesFailed: number;
  agentName?: string;
  serviceName?: string;
  evaluators: Record<string, EvaluatorAggregate>;
  /** The previous run of the same suite (by start time), if any. */
  previousRunId?: string;
  /** Evaluations whose normalized mean dropped vs the previous run. */
  regressedEvaluators: string[];
  /** Fewer cases passed than in the previous run (as a share of cases). */
  passRateDropped: boolean;
}

const caseKey = (r: EvalResult) => r.caseId ?? r.caseName ?? r.traceId ?? r.id;

/** One row per evaluation run, newest first, with a regression check vs the previous run. */
export const summarizeRuns = (results: EvalResult[]): RunSummary[] => {
  const runs = Array.from(
    groupBy(
      results.filter((r) => !!r.runId),
      (r) => r.runId as string
    )
  )
    .map(([runId, list]) => {
      const times = list.map((r) => parseEvalTime(r.time)).filter(Number.isFinite);
      const cases = Array.from(groupBy(list, caseKey).values()).map(caseStatusOf);
      const evaluators: Record<string, EvaluatorAggregate> = {};
      groupBy(list, (r) => r.name).forEach((group, name) => {
        evaluators[name] = aggregateEvaluator(name, group);
      });
      const first = <T>(pick: (r: EvalResult) => T | undefined) =>
        list.map(pick).find((v) => v !== undefined);
      const summary: RunSummary = {
        runId,
        suiteName: first((r) => r.suiteName),
        started: times.length ? Math.min(...times) : NaN,
        ended: times.length ? Math.max(...times) : NaN,
        results: list.length,
        cases: cases.length,
        casesPassed: cases.filter((c) => c === 'pass').length,
        casesFailed: cases.filter((c) => c === 'fail').length,
        agentName: first((r) => r.agentName),
        serviceName: first((r) => r.serviceName),
        evaluators,
        regressedEvaluators: [],
        passRateDropped: false,
      };
      return summary;
    })
    .sort((a, b) => a.started - b.started);

  const lastBySuite = new Map<string, RunSummary>();
  runs.forEach((run) => {
    const suite = run.suiteName ?? '';
    const previous = lastBySuite.get(suite);
    if (previous) {
      run.previousRunId = previous.runId;
      run.regressedEvaluators = Object.keys(run.evaluators).filter((name) => {
        const now = run.evaluators[name].normalizedMean;
        const before = previous.evaluators[name]?.normalizedMean;
        return now !== undefined && before !== undefined && before - now > CHANGE_THRESHOLD;
      });
      const rate = (r: RunSummary) => (r.cases ? r.casesPassed / r.cases : 0);
      run.passRateDropped = rate(previous) - rate(run) > 1e-9;
    }
    lastBySuite.set(suite, run);
  });
  return runs.reverse();
};

export const isRegression = (run: RunSummary) =>
  run.regressedEvaluators.length > 0 || run.passRateDropped;

// ---------------------------------------------------------------------------------------
// Compare runs
// ---------------------------------------------------------------------------------------

export type ChangeKind = 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed';

export interface ValueComparison {
  baseline?: EvaluatorAggregate;
  candidate?: EvaluatorAggregate;
  /** Candidate minus baseline normalized mean (positive is better). */
  delta?: number;
  change: ChangeKind;
}

export interface CaseComparison {
  caseId: string;
  caseName?: string;
  baselineStatus?: CaseStatus;
  candidateStatus?: CaseStatus;
  baselineTraceId?: string;
  candidateTraceId?: string;
  evaluators: Record<string, ValueComparison>;
  change: ChangeKind;
}

export interface EvaluatorComparison extends ValueComparison {
  name: string;
  improved: number;
  regressed: number;
  unchanged: number;
}

export interface RunComparison {
  evaluatorNames: string[];
  evaluators: EvaluatorComparison[];
  cases: CaseComparison[];
  counts: Record<ChangeKind, number>;
}

const compareValues = (
  baseline: EvaluatorAggregate | undefined,
  candidate: EvaluatorAggregate | undefined
): ValueComparison => {
  if (!baseline && !candidate) return { change: 'unchanged' };
  if (!baseline) return { candidate, change: 'new' };
  if (!candidate) return { baseline, change: 'removed' };
  const b = baseline.normalizedMean;
  const c = candidate.normalizedMean;
  if (b === undefined || c === undefined) return { baseline, candidate, change: 'unchanged' };
  const delta = c - b;
  const change =
    delta > CHANGE_THRESHOLD ? 'improved' : delta < -CHANGE_THRESHOLD ? 'regressed' : 'unchanged';
  return { baseline, candidate, delta, change };
};

/** A case regressed if any evaluation (or its status) regressed, improved if any improved. */
const caseChange = (
  values: ValueComparison[],
  baselineStatus?: CaseStatus,
  candidateStatus?: CaseStatus
): ChangeKind => {
  if (!baselineStatus) return 'new';
  if (!candidateStatus) return 'removed';
  if (baselineStatus === 'pass' && candidateStatus === 'fail') return 'regressed';
  if (values.some((v) => v.change === 'regressed')) return 'regressed';
  if (baselineStatus === 'fail' && candidateStatus === 'pass') return 'improved';
  if (values.some((v) => v.change === 'improved')) return 'improved';
  return 'unchanged';
};

/** Per-evaluation and per-test-case comparison of a candidate run against a baseline run. */
export const compareRuns = (
  results: EvalResult[],
  baselineRunId: string,
  candidateRunId: string
): RunComparison => {
  const baseline = results.filter((r) => r.runId === baselineRunId);
  const candidate = results.filter((r) => r.runId === candidateRunId);
  const evaluatorNames = Array.from(new Set([...baseline, ...candidate].map((r) => r.name))).sort();
  const baselineCases = groupBy(baseline, caseKey);
  const candidateCases = groupBy(candidate, caseKey);
  const caseIds = Array.from(new Set([...baselineCases.keys(), ...candidateCases.keys()]));

  const cases: CaseComparison[] = caseIds.map((caseId) => {
    const b = baselineCases.get(caseId) ?? [];
    const c = candidateCases.get(caseId) ?? [];
    const evaluators: Record<string, ValueComparison> = {};
    evaluatorNames.forEach((name) => {
      const bn = b.filter((r) => r.name === name);
      const cn = c.filter((r) => r.name === name);
      if (bn.length === 0 && cn.length === 0) return;
      evaluators[name] = compareValues(
        bn.length ? aggregateEvaluator(name, bn) : undefined,
        cn.length ? aggregateEvaluator(name, cn) : undefined
      );
    });
    const baselineStatus = b.length ? caseStatusOf(b) : undefined;
    const candidateStatus = c.length ? caseStatusOf(c) : undefined;
    return {
      caseId,
      caseName: [...c, ...b].map((r) => r.caseName).find((n) => !!n),
      baselineStatus,
      candidateStatus,
      baselineTraceId: b.find((r) => r.traceId)?.traceId,
      candidateTraceId: c.find((r) => r.traceId)?.traceId,
      evaluators,
      change: caseChange(Object.values(evaluators), baselineStatus, candidateStatus),
    };
  });

  const order: Record<ChangeKind, number> = {
    regressed: 0,
    improved: 1,
    new: 2,
    removed: 3,
    unchanged: 4,
  };
  cases.sort(
    (x, y) =>
      order[x.change] - order[y.change] ||
      (x.caseName ?? x.caseId).localeCompare(y.caseName ?? y.caseId)
  );

  const evaluators: EvaluatorComparison[] = evaluatorNames.map((name) => {
    const bn = baseline.filter((r) => r.name === name);
    const cn = candidate.filter((r) => r.name === name);
    const overall = compareValues(
      bn.length ? aggregateEvaluator(name, bn) : undefined,
      cn.length ? aggregateEvaluator(name, cn) : undefined
    );
    const perCase = cases.map((c) => c.evaluators[name]).filter((v) => !!v);
    return {
      name,
      ...overall,
      improved: perCase.filter((v) => v.change === 'improved').length,
      regressed: perCase.filter((v) => v.change === 'regressed').length,
      unchanged: perCase.filter((v) => v.change === 'unchanged').length,
    };
  });

  const counts: Record<ChangeKind, number> = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    new: 0,
    removed: 0,
  };
  cases.forEach((c) => {
    counts[c.change] += 1;
  });
  return { evaluatorNames, evaluators, cases, counts };
};
