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
  mergeRunData,
  parseEvalTime,
  pickInterval,
  previousPeriod,
  runCases,
  scoreTrend,
  suiteTrend,
  summarizeRuns,
} from './eval_aggregations';
import { EMPTY_RUN_EVENTS } from './eval_data';
import {
  makeCaseEvent,
  makeResult,
  twoRunEventsFixture,
  twoRunFixture,
} from './eval_test_fixtures';

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
      missing: 0,
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
  it('reports missing cases when the candidate lacks them', () => {
    const comparison = compareRuns(twoRunFixture(), 'run-2', 'run-1');
    expect(comparison.cases.find((c) => c.caseId === 'c')?.change).toBe('missing');
  });
});

describe('summarizeRuns with case and run events', () => {
  it('takes cases, counts, timing and status from the events', () => {
    const [latest, first] = summarizeRuns(twoRunFixture(), twoRunEventsFixture());
    expect(latest.runId).toBe('run-2');
    expect(latest.fromCaseEvents).toBe(true);
    expect(latest.status).toBe('failure');
    expect(latest.cases).toBe(4);
    expect(latest.casesPassed).toBe(2);
    expect(latest.casesFailed).toBe(1);
    expect(latest.casesErrored).toBe(1);
    expect(latest.durationMs).toBe(8000);
    expect(latest.ended).toBe(Date.parse('2026-10-26T10:00:05.000Z'));
    expect(latest.started).toBe(Date.parse('2026-10-26T09:59:57.000Z'));
    expect(latest.evaluators.accuracy.count).toBe(3);
    expect(first.casesErrored).toBe(0);
    expect(first.status).toBe('success');
  });

  it('counts from case events when the run event is missing', () => {
    const events = twoRunEventsFixture();
    const [latest] = summarizeRuns(twoRunFixture(), { cases: events.cases, runs: [] });
    expect(latest.cases).toBe(4);
    expect(latest.casesErrored).toBe(1);
    expect(latest.status).toBeUndefined();
    // first case start (10:00:00 - 1.5 s) to last case end (10:00:03)
    expect(latest.durationMs).toBe(4500);
  });

  it('lists runs that only have events (every case errored, no grades)', () => {
    const runs = summarizeRuns([], {
      cases: [makeCaseEvent({ runId: 'run-x', caseId: 'a', status: 'error' })],
      runs: [],
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].casesErrored).toBe(1);
    expect(runs[0].suiteName).toBe('travel-suite');
  });

  it('keeps the latest event of a repeated case', () => {
    const runs = summarizeRuns([], {
      cases: [
        makeCaseEvent({ caseId: 'a', status: 'fail', time: '2026-10-26 10:00:00' }),
        makeCaseEvent({ caseId: 'a', status: 'pass', time: '2026-10-26 10:00:09' }),
      ],
      runs: [],
    });
    expect(runs[0].cases).toBe(1);
    expect(runs[0].casesPassed).toBe(1);
  });

  it('falls back to grades for runs without events', () => {
    const [latest] = summarizeRuns(twoRunFixture(), { cases: [], runs: [] });
    expect(latest.fromCaseEvents).toBe(false);
    expect(latest.durationMs).toBeUndefined();
    expect(latest.casesErrored).toBe(0);
    expect(latest.cases).toBe(3);
  });
});

describe('compareRuns with case events', () => {
  it('uses case status, traces and content from the events, scores from grades', () => {
    const comparison = compareRuns(twoRunFixture(), 'run-1', 'run-2', twoRunEventsFixture());
    const byId = Object.fromEntries(comparison.cases.map((c) => [c.caseId, c]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(byId.d.baselineStatus).toBe('pass');
    expect(byId.d.candidateStatus).toBe('error');
    expect(byId.d.change).toBe('regressed');
    expect(byId.d.candidateCase?.errorType).toBe('TimeoutError');
    expect(byId.a.candidateTraceId).toBe('run-2-trace-a');
    expect(byId.a.baselineCase?.output).toBe('old a');
    expect(byId.a.evaluators.accuracy.delta).toBeCloseTo(0.4);
    expect(byId.c.change).toBe('new');
    expect(comparison.counts.regressed).toBe(2);
  });

  it('reports a case missing from the candidate by its case event', () => {
    const events = twoRunEventsFixture();
    const comparison = compareRuns([], 'run-2', 'run-1', events);
    const byId = Object.fromEntries(comparison.cases.map((c) => [c.caseId, c]));
    expect(byId.c.change).toBe('missing');
    expect(byId.d.change).toBe('improved');
  });

  it('treats a reported error status on grades as errored', () => {
    expect(caseStatusOf([makeResult({ caseStatus: 'error' })])).toBe('error');
  });
});

describe('one run', () => {
  it('lists its cases errored and failed first, with grades and the case trace', () => {
    const cases = runCases(twoRunFixture(), twoRunEventsFixture(), 'run-2');
    expect(cases.map((c) => [c.caseId, c.status])).toEqual([
      ['d', 'error'],
      ['b', 'fail'],
      ['a', 'pass'],
      ['c', 'pass'],
    ]);
    expect(cases[1].traceId).toBe('run-2-trace-b');
    expect(cases[1].grades.accuracy).toHaveLength(1);
    expect(cases[1].evaluators.accuracy.mean).toBeCloseTo(0.2);
    expect(cases[0].errorType).toBe('TimeoutError');
  });

  it('derives cases from grades when the run has no events', () => {
    const cases = runCases(twoRunFixture(), EMPTY_RUN_EVENTS, 'run-1');
    expect(cases.map((c) => c.caseId)).toEqual(['a', 'b']);
    expect(cases[0].status).toBe('fail');
  });

  it('reports min, max and direction per evaluation', () => {
    const [run2] = summarizeRuns(twoRunFixture());
    expect(run2.evaluators.accuracy).toMatchObject({ min: 0.2, max: 0.8, direction: 'maximize' });
  });

  it('builds a trend with one point per run of the suite', () => {
    const runs = summarizeRuns(twoRunFixture(), twoRunEventsFixture());
    const trend = suiteTrend(runs, 'travel-suite');
    expect(trend.map((p) => p.runId)).toEqual(['run-1', 'run-2']);
    expect(trend[1].passRate).toBe(0.5);
    expect(trend[0].evaluators.accuracy).toBeCloseTo(0.65);
    expect(suiteTrend(runs, 'other')).toEqual([]);
  });

  it('merges a run loaded on its own into the runs of the time range', () => {
    const all = twoRunFixture();
    const merged = mergeRunData(
      { results: all.slice(0, 2), events: EMPTY_RUN_EVENTS },
      { results: all.slice(1), events: twoRunEventsFixture() }
    );
    expect(merged.results).toHaveLength(all.length);
    expect(merged.events.cases).toHaveLength(twoRunEventsFixture().cases.length);
    const unchanged = { results: all, events: EMPTY_RUN_EVENTS };
    expect(mergeRunData(unchanged, undefined)).toBe(unchanged);
  });

  it('takes run metadata from the run event', () => {
    const events = twoRunEventsFixture();
    events.runs[1].metadata = { 'agent.version': 'v2' };
    const [run2] = summarizeRuns(twoRunFixture(), events);
    expect(run2.metadata).toEqual({ 'agent.version': 'v2' });
  });
});
