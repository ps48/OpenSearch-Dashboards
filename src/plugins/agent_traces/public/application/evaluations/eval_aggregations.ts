/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EMPTY_RUN_EVENTS,
  EvalOutcome,
  EvalResult,
  RunEvents,
  SuiteRunEvent,
  TestCaseEvent,
  directionOf,
  normalizedScore,
} from './eval_data';

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

// ---------------------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------------------

export interface EvalKpis {
  results: number;
  evaluators: number;
  /** Share of pass among pass and fail results (neutral excluded); undefined without any. */
  passRate?: number;
  failing: number;
  /** Evaluator errors. */
  errors: number;
  /** Results no pass rule decided. */
  scored: number;
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
    errors: results.filter((r) => r.outcome === 'error').length,
    scored: results.filter((r) => r.outcome === 'neutral').length,
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
  /** Lowest and highest raw score value. */
  min?: number;
  max?: number;
  /** `minimize` when any result says lower is better. */
  direction?: 'maximize' | 'minimize';
  passCount?: number;
  failCount?: number;
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
    min: values.length ? Math.min(...values) : undefined,
    max: values.length ? Math.max(...values) : undefined,
    direction: directionOf(name, results),
    passCount: results.filter((r) => r.outcome === 'pass').length,
    failCount: results.filter((r) => r.outcome === 'fail').length,
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

export type CaseStatus = 'pass' | 'fail' | 'error' | 'unknown';

/**
 * A test case passes when its reported status says so; without a status, when every
 * evaluation of the case passed (any failing evaluation fails it).
 */
export const caseStatusOf = (results: EvalResult[]): CaseStatus => {
  const reported = results.map((r) => r.caseStatus?.toLowerCase()).find((s) => !!s);
  if (reported === 'pass' || reported === 'passed') return 'pass';
  if (reported === 'fail' || reported === 'failed') return 'fail';
  if (reported === 'error' || reported === 'errored') return 'error';
  if (results.some((r) => r.outcome === 'fail')) return 'fail';
  if (results.some((r) => r.outcome === 'pass')) return 'pass';
  return 'unknown';
};

/** Normalized-score drop that counts as a regression or an improvement. */
export const CHANGE_THRESHOLD = 0.05;

export interface RunSummary {
  runId: string;
  suiteName?: string;
  /** Run start and end (epoch millis): from the run event when present, else event times. */
  started: number;
  ended: number;
  /** From the run event, else the span of the case events; unknown for grades-only runs. */
  durationMs?: number;
  /** `success` or `failure`, from the run event. */
  status?: string;
  results: number;
  cases: number;
  casesPassed: number;
  casesFailed: number;
  casesErrored: number;
  /** Test cases come from `opensearch.test_case.result` events; else they are derived from grades. */
  fromCaseEvents: boolean;
  agentName?: string;
  serviceName?: string;
  /** Run metadata from the run event (else the first case event), e.g. `agent.version`. */
  metadata?: Record<string, string>;
  evaluators: Record<string, EvaluatorAggregate>;
  /** The previous run of the same suite (by start time), if any. */
  previousRunId?: string;
  /** Evaluations whose normalized mean dropped vs the previous run. */
  regressedEvaluators: string[];
  /** Fewer cases passed than in the previous run (as a share of cases). */
  passRateDropped: boolean;
}

const caseKey = (r: EvalResult) => r.caseId ?? r.caseName ?? r.traceId ?? r.id;
const caseEventKey = (e: TestCaseEvent) => e.caseId ?? e.caseName ?? e.traceId ?? e.time;

/** The latest case event per test case of one run. */
const caseEventsOf = (events: RunEvents, runId: string): Map<string, TestCaseEvent> => {
  const byCase = new Map<string, TestCaseEvent>();
  events.cases
    .filter((e) => e.runId === runId)
    .forEach((e) => {
      const key = caseEventKey(e);
      const seen = byCase.get(key);
      if (!seen || parseEvalTime(e.time) > parseEvalTime(seen.time)) byCase.set(key, e);
    });
  return byCase;
};

const runEventOf = (events: RunEvents, runId: string): SuiteRunEvent | undefined =>
  events.runs
    .filter((e) => e.runId === runId)
    .sort((a, b) => parseEvalTime(b.time) - parseEvalTime(a.time))[0];

/** Status of a case on one side: its case event when present, else its grades. */
const sideStatus = (event: TestCaseEvent | undefined, grades: EvalResult[]): CaseStatus => {
  if (event?.status) return event.status;
  return caseStatusOf(grades);
};

/**
 * One row per evaluation run, newest first, with a regression check vs the previous run.
 * Runs with case and run events (current SDKs) take their cases, statuses, counts and timing
 * from those events; runs without them (older SDKs, Agent Health) are derived from grades.
 */
export const summarizeRuns = (
  results: EvalResult[],
  events: RunEvents = EMPTY_RUN_EVENTS
): RunSummary[] => {
  const grades = groupBy(
    results.filter((r) => !!r.runId),
    (r) => r.runId as string
  );
  const runIds = new Set<string>([
    ...grades.keys(),
    ...events.cases.map((e) => e.runId),
    ...events.runs.map((e) => e.runId),
  ]);
  const runs = Array.from(runIds)
    .map((runId) => {
      const list = grades.get(runId) ?? [];
      const caseEvents = caseEventsOf(events, runId);
      const runEvent = runEventOf(events, runId);
      const fromCaseEvents = caseEvents.size > 0;
      const gradeCases = groupBy(list, caseKey);
      const keys = new Set([...caseEvents.keys(), ...gradeCases.keys()]);
      const statuses = Array.from(keys).map((key) =>
        sideStatus(caseEvents.get(key), gradeCases.get(key) ?? [])
      );
      const evaluators: Record<string, EvaluatorAggregate> = {};
      groupBy(list, (r) => r.name).forEach((group, name) => {
        evaluators[name] = aggregateEvaluator(name, group);
      });
      const first = <T>(values: Array<T | undefined>) => values.find((v) => v !== undefined);
      const caseList = Array.from(caseEvents.values());

      // Start and end: the run event knows both; else case end times minus their durations.
      const starts = [
        ...list.map((r) => parseEvalTime(r.time)),
        ...caseList.map((e) => parseEvalTime(e.time) - (e.durationMs ?? 0)),
      ].filter(Number.isFinite);
      const ends = [
        ...list.map((r) => parseEvalTime(r.time)),
        ...caseList.map((e) => parseEvalTime(e.time)),
      ].filter(Number.isFinite);
      const runEnd = runEvent ? parseEvalTime(runEvent.time) : NaN;
      const ended = Number.isFinite(runEnd) ? runEnd : ends.length ? Math.max(...ends) : NaN;
      const started =
        Number.isFinite(runEnd) && runEvent?.durationMs !== undefined
          ? runEnd - runEvent.durationMs
          : starts.length
            ? Math.min(...starts)
            : ended;
      const durationMs =
        runEvent?.durationMs ??
        (fromCaseEvents && Number.isFinite(ended - started) ? ended - started : undefined);

      const counted = {
        cases: statuses.length,
        casesPassed: statuses.filter((c) => c === 'pass').length,
        casesFailed: statuses.filter((c) => c === 'fail').length,
        casesErrored: statuses.filter((c) => c === 'error').length,
      };
      const summary: RunSummary = {
        runId,
        suiteName: first([
          runEvent?.suiteName,
          ...caseList.map((e) => e.suiteName),
          ...list.map((r) => r.suiteName),
        ]),
        started,
        ended,
        durationMs,
        status: runEvent?.status,
        results: list.length,
        // The run event counts every case, also those outside the time range.
        cases: runEvent?.caseCount ?? counted.cases,
        casesPassed: runEvent?.passCount ?? counted.casesPassed,
        casesFailed: runEvent?.failCount ?? counted.casesFailed,
        casesErrored: runEvent?.errorCount ?? counted.casesErrored,
        fromCaseEvents,
        agentName: first([...list.map((r) => r.agentName), ...caseList.map((e) => e.agentName)]),
        serviceName: first([
          ...list.map((r) => r.serviceName),
          ...caseList.map((e) => e.serviceName),
        ]),
        metadata: runEvent?.metadata ?? caseList.find((e) => e.metadata)?.metadata,
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

export type ChangeKind = 'improved' | 'regressed' | 'unchanged' | 'new' | 'missing';

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
  /** The case events, when the runs emitted them (input, expected, output, error, duration). */
  baselineCase?: TestCaseEvent;
  candidateCase?: TestCaseEvent;
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
  if (!candidate) return { baseline, change: 'missing' };
  const b = baseline.normalizedMean;
  const c = candidate.normalizedMean;
  if (b === undefined || c === undefined) return { baseline, candidate, change: 'unchanged' };
  const delta = c - b;
  const change =
    delta > CHANGE_THRESHOLD ? 'improved' : delta < -CHANGE_THRESHOLD ? 'regressed' : 'unchanged';
  return { baseline, candidate, delta, change };
};

const isBad = (s: CaseStatus) => s === 'fail' || s === 'error';

/** A case regressed if any evaluation (or its status) regressed, improved if any improved. */
const caseChange = (
  values: ValueComparison[],
  baselineStatus?: CaseStatus,
  candidateStatus?: CaseStatus
): ChangeKind => {
  if (!baselineStatus) return 'new';
  if (!candidateStatus) return 'missing';
  if (baselineStatus === 'pass' && isBad(candidateStatus)) return 'regressed';
  if (values.some((v) => v.change === 'regressed')) return 'regressed';
  if (isBad(baselineStatus) && candidateStatus === 'pass') return 'improved';
  if (values.some((v) => v.change === 'improved')) return 'improved';
  return 'unchanged';
};

/**
 * Per-evaluation and per-test-case comparison of a candidate run against a baseline run.
 * Cases, their status and trace come from case events when a run has them; score deltas
 * always come from grades.
 */
export const compareRuns = (
  results: EvalResult[],
  baselineRunId: string,
  candidateRunId: string,
  events: RunEvents = EMPTY_RUN_EVENTS
): RunComparison => {
  const baseline = results.filter((r) => r.runId === baselineRunId);
  const candidate = results.filter((r) => r.runId === candidateRunId);
  const evaluatorNames = Array.from(new Set([...baseline, ...candidate].map((r) => r.name))).sort();
  const baselineCases = groupBy(baseline, caseKey);
  const candidateCases = groupBy(candidate, caseKey);
  const baselineEvents = caseEventsOf(events, baselineRunId);
  const candidateEvents = caseEventsOf(events, candidateRunId);
  const caseIds = Array.from(
    new Set([
      ...baselineEvents.keys(),
      ...candidateEvents.keys(),
      ...baselineCases.keys(),
      ...candidateCases.keys(),
    ])
  );

  const cases: CaseComparison[] = caseIds.map((caseId) => {
    const b = baselineCases.get(caseId) ?? [];
    const c = candidateCases.get(caseId) ?? [];
    const be = baselineEvents.get(caseId);
    const ce = candidateEvents.get(caseId);
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
    const baselineStatus = be || b.length ? sideStatus(be, b) : undefined;
    const candidateStatus = ce || c.length ? sideStatus(ce, c) : undefined;
    return {
      caseId,
      caseName: [ce?.caseName, be?.caseName, ...[...c, ...b].map((r) => r.caseName)].find(
        (n) => !!n
      ),
      baselineStatus,
      candidateStatus,
      baselineTraceId: be?.traceId ?? b.find((r) => r.traceId)?.traceId,
      candidateTraceId: ce?.traceId ?? c.find((r) => r.traceId)?.traceId,
      baselineCase: be,
      candidateCase: ce,
      evaluators,
      change: caseChange(Object.values(evaluators), baselineStatus, candidateStatus),
    };
  });

  const order: Record<ChangeKind, number> = {
    regressed: 0,
    improved: 1,
    new: 2,
    missing: 3,
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
    missing: 0,
  };
  cases.forEach((c) => {
    counts[c.change] += 1;
  });
  return { evaluatorNames, evaluators, cases, counts };
};

// ---------------------------------------------------------------------------------------
// One run: its test cases and its suite's history
// ---------------------------------------------------------------------------------------

export interface RunCaseRow {
  caseId: string;
  caseName?: string;
  status: CaseStatus;
  errorType?: string;
  /** The case event, when the run emitted one (input, expected, output, duration). */
  event?: TestCaseEvent;
  traceId?: string;
  durationMs?: number;
  /** Epoch millis the case finished (case event), else its first grade. */
  timeMs: number;
  /** Grades of the case by evaluation name. */
  grades: Record<string, EvalResult[]>;
  evaluators: Record<string, EvaluatorAggregate>;
}

/** The test cases of one run with their status, grades and trace, failures first. */
export const runCases = (results: EvalResult[], events: RunEvents, runId: string): RunCaseRow[] => {
  const grades = groupBy(
    results.filter((r) => r.runId === runId),
    caseKey
  );
  const caseEvents = caseEventsOf(events, runId);
  const keys = Array.from(new Set([...caseEvents.keys(), ...grades.keys()]));
  const rank: Record<CaseStatus, number> = { error: 0, fail: 1, unknown: 2, pass: 3 };
  return keys
    .map((caseId) => {
      const event = caseEvents.get(caseId);
      const list = grades.get(caseId) ?? [];
      const byName: Record<string, EvalResult[]> = {};
      const evaluators: Record<string, EvaluatorAggregate> = {};
      groupBy(list, (r) => r.name).forEach((group, name) => {
        byName[name] = group;
        evaluators[name] = aggregateEvaluator(name, group);
      });
      const eventTime = parseEvalTime(event?.time);
      const gradeTimes = list.map((r) => parseEvalTime(r.time)).filter(Number.isFinite);
      return {
        caseId,
        caseName: event?.caseName ?? list.find((r) => r.caseName)?.caseName,
        status: sideStatus(event, list),
        errorType: event?.errorType,
        event,
        traceId: event?.traceId ?? list.find((r) => r.traceId)?.traceId,
        durationMs: event?.durationMs,
        timeMs: Number.isFinite(eventTime)
          ? eventTime
          : gradeTimes.length
            ? Math.min(...gradeTimes)
            : NaN,
        grades: byName,
        evaluators,
      };
    })
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.caseName ?? a.caseId).localeCompare(b.caseName ?? b.caseId)
    );
};

export interface SuiteTrendPoint {
  runId: string;
  /** Run start, epoch millis. */
  x: number;
  /** Share of test cases that passed, 0..1. */
  passRate?: number;
  /** Normalized mean (0..1, higher is better) per evaluation. */
  evaluators: Record<string, number>;
}

/** The runs of one suite in time order, for a trend with one point per run. */
export const suiteTrend = (runs: RunSummary[], suiteName: string | undefined): SuiteTrendPoint[] =>
  runs
    .filter((r) => (r.suiteName ?? '') === (suiteName ?? '') && Number.isFinite(r.started))
    .map((r) => {
      const evaluators: Record<string, number> = {};
      Object.values(r.evaluators).forEach((e) => {
        if (e.normalizedMean !== undefined) evaluators[e.name] = e.normalizedMean;
      });
      return {
        runId: r.runId,
        x: r.started,
        passRate: r.cases > 0 ? r.casesPassed / r.cases : undefined,
        evaluators,
      };
    })
    .sort((a, b) => a.x - b.x);

/** Union of two result sets by id (the second wins), and of two event sets. */
export const mergeRunData = (
  a: { results: EvalResult[]; events: RunEvents },
  b?: { results: EvalResult[]; events: RunEvents }
): { results: EvalResult[]; events: RunEvents } => {
  if (!b || (b.results.length === 0 && b.events.cases.length + b.events.runs.length === 0)) {
    return a;
  }
  const byId = new Map(a.results.map((r) => [r.id, r]));
  b.results.forEach((r) => byId.set(r.id, r));
  const caseKeyOf = (e: TestCaseEvent) => `${e.runId}|${caseEventKey(e)}|${e.time}`;
  const cases = new Map(a.events.cases.map((e) => [caseKeyOf(e), e]));
  b.events.cases.forEach((e) => cases.set(caseKeyOf(e), e));
  const runKeyOf = (e: SuiteRunEvent) => `${e.runId}|${e.time}`;
  const runs = new Map(a.events.runs.map((e) => [runKeyOf(e), e]));
  b.events.runs.forEach((e) => runs.set(runKeyOf(e), e));
  return {
    results: Array.from(byId.values()),
    events: { cases: Array.from(cases.values()), runs: Array.from(runs.values()) },
  };
};
