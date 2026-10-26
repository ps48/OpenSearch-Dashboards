/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  applyClientFilters,
  bucketOutcomes,
  caseStatusOf,
  compareRuns,
  computeKpis,
  isRegression,
  parseEvalTime,
  pickInterval,
  previousPeriod,
  scoreTrend,
  summarizeRuns,
} from './eval_aggregations';
import { makeResult, twoRunFixture } from './eval_test_fixtures';

describe('parseEvalTime', () => {
  it('reads PPL timestamps as UTC and truncates nanoseconds', () => {
    expect(parseEvalTime('2026-10-26 09:03:33.255342898')).toBe(
      Date.UTC(2026, 9, 26, 9, 3, 33, 255)
    );
  });
  it('keeps an explicit zone and handles missing fractions', () => {
    expect(parseEvalTime('2026-10-26T09:03:33Z')).toBe(Date.UTC(2026, 9, 26, 9, 3, 33));
    expect(parseEvalTime('2026-10-26T09:03:33.5+01:00')).toBe(Date.UTC(2026, 9, 26, 8, 3, 33, 500));
  });
  it('returns NaN for empty or invalid input', () => {
    expect(parseEvalTime(undefined)).toBeNaN();
    expect(parseEvalTime('not a date')).toBeNaN();
  });
});

describe('periods and intervals', () => {
  it('computes the previous equal period', () => {
    expect(previousPeriod({ from: 100, to: 300 })).toEqual({ from: -100, to: 100 });
  });
  it('picks a round interval', () => {
    expect(pickInterval({ from: 0, to: 15 * 60 * 1000 })).toBe(60 * 1000);
    expect(pickInterval({ from: 0, to: 24 * 3600 * 1000 })).toBe(3600 * 1000);
    expect(pickInterval({ from: 0, to: 365 * 24 * 3600 * 1000 })).toBe(30 * 24 * 3600 * 1000);
  });
});

describe('computeKpis', () => {
  it('counts results, names, pass rate, failures, traces and sessions', () => {
    const results = [
      makeResult({ name: 'a', label: 'pass', traceId: 't1', sessionId: 's1' }),
      makeResult({ name: 'a', label: 'fail', traceId: 't1' }),
      makeResult({ name: 'b', value: 0.9, traceId: 't2', sessionId: 's1' }),
      makeResult({ name: 'b', traceId: 't3' }), // neutral: no score, no label
    ];
    expect(computeKpis(results)).toEqual({
      results: 4,
      evaluators: 2,
      passRate: 2 / 3,
      failing: 1,
      traces: 3,
      sessions: 1,
    });
  });
  it('has no pass rate without judged results', () => {
    expect(computeKpis([]).passRate).toBeUndefined();
  });
});

describe('applyClientFilters', () => {
  it('keeps only failures when asked', () => {
    const results = [makeResult({ label: 'pass' }), makeResult({ label: 'fail' })];
    expect(applyClientFilters(results, { failingOnly: true })).toHaveLength(1);
    expect(applyClientFilters(results, {})).toHaveLength(2);
  });
});

describe('time buckets', () => {
  const minute = 60 * 1000;
  const results = [
    makeResult({ time: '2026-10-26 09:00:10.000', label: 'pass', name: 'a', value: 1 }),
    makeResult({ time: '2026-10-26 09:00:50.000', label: 'fail', name: 'a', value: 0 }),
    makeResult({ time: '2026-10-26 09:01:10.000', label: 'fail', name: 'a', value: 0.5 }),
  ];
  it('counts outcomes per bucket', () => {
    const buckets = bucketOutcomes(results, minute);
    const at9 = Date.UTC(2026, 9, 26, 9, 0);
    expect(buckets).toEqual(
      expect.arrayContaining([
        { x: at9, outcome: 'pass', count: 1 },
        { x: at9, outcome: 'fail', count: 1 },
        { x: at9 + minute, outcome: 'fail', count: 1 },
      ])
    );
  });
  it('averages normalized scores per bucket', () => {
    const points = scoreTrend(results, minute);
    expect(points.map((p) => p.value)).toEqual([0.5, 0.5]);
    expect(points[0].count).toBe(2);
  });
});

describe('caseStatusOf', () => {
  it('prefers the reported status', () => {
    expect(caseStatusOf([makeResult({ label: 'fail', caseStatus: 'pass' })])).toBe('pass');
  });
  it('fails when any evaluation fails, passes when all pass', () => {
    expect(caseStatusOf([makeResult({ label: 'pass' }), makeResult({ label: 'fail' })])).toBe(
      'fail'
    );
    expect(caseStatusOf([makeResult({ label: 'pass' })])).toBe('pass');
    expect(caseStatusOf([makeResult({})])).toBe('unknown');
  });
});

describe('summarizeRuns', () => {
  it('groups by run id, newest first, and flags regressions vs the previous run', () => {
    const runs = summarizeRuns([...twoRunFixture(), makeResult({ name: 'no-run' })]);
    expect(runs.map((r) => r.runId)).toEqual(['run-2', 'run-1']);
    const [latest, first] = runs;
    expect(latest.cases).toBe(3);
    expect(latest.casesPassed).toBe(2);
    expect(latest.casesFailed).toBe(1);
    expect(latest.previousRunId).toBe('run-1');
    expect(latest.evaluators.accuracy.mean).toBeCloseTo((0.8 + 0.2 + 0.7) / 3);
    // run-1 mean 0.65, run-2 mean 0.567: a drop beyond the threshold
    expect(latest.regressedEvaluators).toEqual(['accuracy']);
    expect(isRegression(latest)).toBe(true);
    expect(first.previousRunId).toBeUndefined();
    expect(isRegression(first)).toBe(false);
  });
});

describe('compareRuns', () => {
  it('classifies cases and aggregates per evaluation', () => {
    const comparison = compareRuns(twoRunFixture(), 'run-1', 'run-2');
    const byId = Object.fromEntries(comparison.cases.map((c) => [c.caseId, c]));
    expect(byId.a.change).toBe('improved');
    expect(byId.b.change).toBe('regressed');
    expect(byId.c.change).toBe('new');
    expect(byId.a.evaluators.accuracy.delta).toBeCloseTo(0.4);
    expect(comparison.counts).toEqual({
      improved: 1,
      regressed: 1,
      new: 1,
      removed: 0,
      unchanged: 0,
    });
    // regressed cases first
    expect(comparison.cases[0].caseId).toBe('b');
    const [accuracy] = comparison.evaluators;
    expect(accuracy.name).toBe('accuracy');
    expect(accuracy.improved).toBe(1);
    expect(accuracy.regressed).toBe(1);
    expect(accuracy.change).toBe('regressed');
  });
  it('reports removed cases when the candidate lacks them', () => {
    const comparison = compareRuns(twoRunFixture(), 'run-2', 'run-1');
    expect(comparison.cases.find((c) => c.caseId === 'c')?.change).toBe('removed');
  });
});
