/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EMPTY_RUN_EVENTS, EvalResult, RunEvents } from './eval_data';
import {
  CaseComparison,
  ChangeKind,
  EvaluatorAggregate,
  EvaluatorComparison,
  RunCaseRow,
  RunComparison,
  RunSummary,
  compareRuns,
  runCases,
  summarizeRuns,
} from './eval_aggregations';

/**
 * Compare grid: up to five runs of a suite as lettered columns, each measured against one
 * baseline run. Per run and per case, the comparison with the baseline is phase 1's
 * `compareRuns` (normalized-score deltas, the same change threshold); this module lines the
 * pairs up into one grid.
 */

export const RUN_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export interface GridRun {
  runId: string;
  letter: string;
  isBaseline: boolean;
  /** Undefined when the run has no data (deleted, or the id is wrong). */
  summary?: RunSummary;
  /** Test cases of the run by case key. */
  cases: Map<string, RunCaseRow>;
  /** This run against the baseline; undefined for the baseline. */
  comparison?: RunComparison;
  /** Share of test cases that passed, 0..1. */
  passRate?: number;
  /** Pass rate minus the baseline's, 0..1 (undefined for the baseline). */
  passRateDelta?: number;
  /** Cases in both this run and the baseline, by how they changed (undefined for the baseline). */
  changes?: { regressed: number; improved: number; unchanged: number; shared: number };
}

export interface GridCase {
  caseId: string;
  caseName?: string;
  /** The case in each run, by run id (absent when the run did not have it). */
  cells: Record<string, RunCaseRow | undefined>;
  /** The case against the baseline, by non-baseline run id. */
  vs: Record<string, CaseComparison | undefined>;
  /** Evaluations that regressed (or improved) in at least one run. */
  regressedEvaluations: string[];
  improvedEvaluations: string[];
  /** Sort keys: summed normalized drops (rises) vs the baseline, plus 1 per status flip. */
  regression: number;
  improvement: number;
  /** How the case changed in the runs, for the filter chips. */
  kinds: Set<ChangeKind>;
  /** Present in every compared run. */
  shared: boolean;
}

export type CaseFilter = 'all' | 'improved' | 'regressed' | 'new' | 'missing';
export type CaseSort = 'regression' | 'improvement' | 'name';

export interface CompareGrid {
  baselineId: string;
  runs: GridRun[];
  evaluatorNames: string[];
  cases: GridCase[];
  /** Cases present in every run. */
  shared: number;
  counts: Record<CaseFilter, number>;
}

const isBad = (s?: string) => s === 'fail' || s === 'error';

/** One grid from the grades and events of the compared runs. */
export const buildCompareGrid = (
  results: EvalResult[],
  events: RunEvents = EMPTY_RUN_EVENTS,
  runIds: string[],
  baselineId: string
): CompareGrid => {
  const summaries = new Map(summarizeRuns(results, events).map((s) => [s.runId, s]));
  const passRateOf = (s?: RunSummary) => (s && s.cases > 0 ? s.casesPassed / s.cases : undefined);
  const baselinePassRate = passRateOf(summaries.get(baselineId));
  const runs: GridRun[] = runIds.map((runId, i) => {
    const summary = summaries.get(runId);
    const isBaseline = runId === baselineId;
    const comparison = isBaseline ? undefined : compareRuns(results, baselineId, runId, events);
    const passRate = passRateOf(summary);
    return {
      runId,
      letter: RUN_LETTERS[i] ?? String(i + 1),
      isBaseline,
      summary,
      cases: new Map(runCases(results, events, runId).map((c) => [c.caseId, c])),
      comparison,
      passRate,
      passRateDelta:
        !isBaseline && passRate !== undefined && baselinePassRate !== undefined
          ? passRate - baselinePassRate
          : undefined,
      changes: comparison && {
        regressed: comparison.counts.regressed,
        improved: comparison.counts.improved,
        unchanged: comparison.counts.unchanged,
        shared:
          comparison.counts.regressed + comparison.counts.improved + comparison.counts.unchanged,
      },
    };
  });

  const evaluatorNames = Array.from(
    new Set(runs.flatMap((r) => Object.keys(r.summary?.evaluators ?? {})))
  ).sort();
  const caseIds = Array.from(new Set(runs.flatMap((r) => Array.from(r.cases.keys()))));
  const others = runs.filter((r) => !r.isBaseline);

  const cases: GridCase[] = caseIds.map((caseId) => {
    const cells: Record<string, RunCaseRow | undefined> = {};
    const vs: Record<string, CaseComparison | undefined> = {};
    runs.forEach((r) => {
      cells[r.runId] = r.cases.get(caseId);
    });
    const regressed = new Set<string>();
    const improved = new Set<string>();
    const kinds = new Set<ChangeKind>();
    let regression = 0;
    let improvement = 0;
    others.forEach((r) => {
      const c = r.comparison?.cases.find((x) => x.caseId === caseId);
      vs[r.runId] = c;
      if (!c) return;
      kinds.add(c.change);
      Object.entries(c.evaluators).forEach(([name, v]) => {
        if (v.change === 'regressed') regressed.add(name);
        if (v.change === 'improved') improved.add(name);
        if (v.delta !== undefined && v.delta < 0) regression += -v.delta;
        if (v.delta !== undefined && v.delta > 0) improvement += v.delta;
      });
      if (c.baselineStatus === 'pass' && isBad(c.candidateStatus)) regression += 1;
      if (isBad(c.baselineStatus) && c.candidateStatus === 'pass') improvement += 1;
    });
    const caseName = runs.map((r) => cells[r.runId]?.caseName).find((n) => !!n);
    return {
      caseId,
      caseName,
      cells,
      vs,
      regressedEvaluations: Array.from(regressed).sort(),
      improvedEvaluations: Array.from(improved).sort(),
      regression,
      improvement,
      kinds,
      shared: runs.every((r) => !!cells[r.runId]),
    };
  });

  const counts: Record<CaseFilter, number> = {
    all: cases.length,
    improved: cases.filter((c) => c.kinds.has('improved')).length,
    regressed: cases.filter((c) => c.kinds.has('regressed')).length,
    new: cases.filter((c) => c.kinds.has('new')).length,
    missing: cases.filter((c) => c.kinds.has('missing')).length,
  };
  return {
    baselineId,
    runs,
    evaluatorNames,
    cases: sortCases(cases, 'regression'),
    shared: cases.filter((c) => c.shared).length,
    counts,
  };
};

const caseLabel = (c: GridCase) => c.caseName ?? c.caseId;

/** Biggest regression first (default), most improved first, or by name. */
export const sortCases = (cases: GridCase[], sort: CaseSort): GridCase[] =>
  [...cases].sort((a, b) => {
    const byName = caseLabel(a).localeCompare(caseLabel(b));
    if (sort === 'regression') return b.regression - a.regression || byName;
    if (sort === 'improvement') return b.improvement - a.improvement || byName;
    return byName;
  });

export const filterCases = (cases: GridCase[], filter: CaseFilter): GridCase[] =>
  filter === 'all' ? cases : cases.filter((c) => c.kinds.has(filter));

/** The comparison of one evaluation in a run against the baseline. */
export const evaluatorVs = (run: GridRun, name: string): EvaluatorComparison | undefined =>
  run.comparison?.evaluators.find((e) => e.name === name);

const arrow = (d: number) => (d > 0 ? '↑' : d < 0 ? '↓' : '±');

/** Scores reported on 0..1 by both sides: deltas read as points. */
const unitScale = (a?: EvaluatorAggregate, b?: EvaluatorAggregate) =>
  [a, b].every((x) => x?.min !== undefined && x.max !== undefined && x.min >= 0 && x.max <= 1);

/**
 * Signed change of an evaluation between two aggregates, in its own unit: `↑0.25` for scores,
 * `↓8 pp` for scores on 0..1 and for pass rates. Undefined when either side lacks a value.
 */
export const formatAggregateDelta = (
  baseline?: EvaluatorAggregate,
  candidate?: EvaluatorAggregate
): string | undefined => {
  if (!baseline || !candidate) return undefined;
  if (baseline.mean !== undefined && candidate.mean !== undefined) {
    const d = candidate.mean - baseline.mean;
    if (unitScale(baseline, candidate)) return formatPointsDelta(d);
    return formatValueDelta(d);
  }
  if (baseline.passRate !== undefined && candidate.passRate !== undefined) {
    return formatPointsDelta(candidate.passRate - baseline.passRate);
  }
  return undefined;
};

/** A score difference in its unit, two decimals: `↑0.25`, `±0.00` (the arrow follows the rounding). */
export const formatValueDelta = (d: number): string => {
  const rounded = Math.round(d * 100) / 100;
  return `${arrow(rounded)}${Math.abs(rounded).toFixed(2)}`;
};

/** A 0..1 difference as percentage points: `↓8 pp`, `±0 pp`. */
export const formatPointsDelta = (d: number): string => {
  const points = Math.round(d * 100);
  return `${arrow(points)}${Math.abs(points)} pp`;
};

/** A duration difference: `↓1.20 s`, `↑850 ms`. */
export const formatDurationDelta = (d: number): string => {
  const abs = Math.abs(d);
  const text =
    abs < 1000
      ? `${abs.toFixed(0)} ms`
      : abs < 60000
        ? `${(abs / 1000).toFixed(2)} s`
        : `${(abs / 60000).toFixed(1)} min`;
  return `${arrow(d)}${text}`;
};

/** Shorter is better for durations; within 5% it is the same. */
export const durationChange = (baseline?: number, candidate?: number): ChangeKind | undefined => {
  if (baseline === undefined || candidate === undefined || baseline <= 0) return undefined;
  const ratio = (candidate - baseline) / baseline;
  return ratio < -0.05 ? 'improved' : ratio > 0.05 ? 'regressed' : 'unchanged';
};

/** Pass-rate change: one point either way is the same. */
export const passRateChange = (delta?: number): ChangeKind | undefined =>
  delta === undefined
    ? undefined
    : delta > 0.005
      ? 'improved'
      : delta < -0.005
        ? 'regressed'
        : 'unchanged';

// ---------------------------------------------------------------------------------------
// Comparability: what differs between the compared runs besides the agent
// ---------------------------------------------------------------------------------------

export interface CaseCoverage {
  shared: number;
  /** Cases only one run has, by run letter. */
  onlyIn: Array<{ letter: string; count: number }>;
  /** Cases a run lacks that other runs have (not counted in `onlyIn`), by run letter. */
  missingFrom: Array<{ letter: string; count: number }>;
}

export interface EvaluatorDifference {
  name: string;
  what: 'version' | 'judge' | 'evaluator';
  /** Value per run letter, in column order; `undefined` when the run did not record it. */
  values: Array<{ letter: string; value?: string }>;
}

export interface MissingRule {
  letter: string;
  /** Evaluations the run has results for but no pass rule decided any of them. */
  names: string[];
}

export interface ConfigChange {
  what: 'agentVersion' | 'model';
  values: Array<{ letter: string; value?: string }>;
}

export interface Comparability {
  coverage?: CaseCoverage;
  evaluators: EvaluatorDifference[];
  missingRules: MissingRule[];
  /** Agent version and model changes: informational (usually the point of comparing). */
  changes: ConfigChange[];
  /** Anything that makes the deltas less meaningful (all but `changes`). */
  hasWarnings: boolean;
}

const distinctValues = (values: Array<{ value?: string }>) =>
  new Set(values.map((v) => v.value ?? '')).size;

/**
 * What differs between the runs of a grid: test case coverage, evaluator versions, judge
 * models and evaluator identity per evaluation, evaluations without pass rules in some runs,
 * and the agent version and model from the run metadata.
 */
export const comparabilityOf = (
  grid: CompareGrid,
  results: EvalResult[],
  meta: (s?: RunSummary) => { agentVersion?: string; model?: string }
): Comparability => {
  const runs = grid.runs.filter((r) => !!r.summary);
  const letterOf = new Map(grid.runs.map((r) => [r.runId, r.letter]));

  let coverage: CaseCoverage | undefined;
  if (grid.cases.some((c) => !c.shared)) {
    const only = new Map<string, number>();
    const missing = new Map<string, number>();
    grid.cases
      .filter((c) => !c.shared)
      .forEach((c) => {
        const present = runs.filter((r) => !!c.cells[r.runId]);
        if (present.length === 1) {
          only.set(present[0].letter, (only.get(present[0].letter) ?? 0) + 1);
          return;
        }
        runs
          .filter((r) => !c.cells[r.runId])
          .forEach((r) => missing.set(r.letter, (missing.get(r.letter) ?? 0) + 1));
      });
    const list = (m: Map<string, number>) =>
      Array.from(m.entries())
        .map(([letter, count]) => ({ letter, count }))
        .sort((a, b) => a.letter.localeCompare(b.letter));
    coverage = { shared: grid.shared, onlyIn: list(only), missingFrom: list(missing) };
  }

  const evaluators: EvaluatorDifference[] = [];
  grid.evaluatorNames.forEach((name) => {
    const perRun = runs
      .map((r) => ({
        letter: r.letter,
        grades: results.filter((x) => x.runId === r.runId && x.name === name),
      }))
      .filter((r) => r.grades.length > 0);
    if (perRun.length < 2) return;
    const pick = (f: (x: EvalResult) => string | undefined) =>
      perRun.map((r) => {
        const set = Array.from(new Set(r.grades.map(f).filter((v): v is string => !!v))).sort();
        return { letter: r.letter, value: set.length ? set.join(', ') : undefined };
      });
    const check = (what: EvaluatorDifference['what'], f: (x: EvalResult) => string | undefined) => {
      const values = pick(f);
      // Nothing recorded anywhere is no difference.
      if (values.every((v) => v.value === undefined)) return;
      if (distinctValues(values) > 1) evaluators.push({ name, what, values });
    };
    check('evaluator', (x) => x.evaluator);
    check('version', (x) => x.evaluatorVersion);
    check('judge', (x) => x.judgeModel);
  });

  const missingRules: MissingRule[] = [];
  const decidedSomewhere = new Set(
    grid.evaluatorNames.filter((name) =>
      runs.some((r) => {
        const e = r.summary?.evaluators[name];
        return !!e && (e.passCount ?? 0) + (e.failCount ?? 0) > 0;
      })
    )
  );
  runs.forEach((r) => {
    const names = Array.from(decidedSomewhere).filter((name) => {
      const e = r.summary?.evaluators[name];
      return !!e && e.count > 0 && (e.passCount ?? 0) + (e.failCount ?? 0) === 0;
    });
    if (names.length) missingRules.push({ letter: r.letter, names: names.sort() });
  });

  const changes: ConfigChange[] = [];
  const configValues = (
    pickMeta: (m: { agentVersion?: string; model?: string }) => string | undefined
  ) =>
    runs.map((r) => ({
      letter: letterOf.get(r.runId) ?? r.letter,
      value: pickMeta(meta(r.summary)),
    }));
  const versions = configValues((m) => m.agentVersion);
  if (distinctValues(versions) > 1) changes.push({ what: 'agentVersion', values: versions });
  const models = configValues((m) => m.model);
  if (distinctValues(models) > 1) changes.push({ what: 'model', values: models });

  return {
    coverage,
    evaluators,
    missingRules,
    changes,
    hasWarnings: !!coverage || evaluators.length > 0 || missingRules.length > 0,
  };
};
