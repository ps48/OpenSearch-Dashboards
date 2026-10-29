/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeResult, makeRunEvent, twoRunEventsFixture, twoRunFixture } from './eval_test_fixtures';
import {
  buildCompareGrid,
  comparabilityOf,
  durationChange,
  filterCases,
  formatAggregateDelta,
  formatDurationDelta,
  formatPointsDelta,
  passRateChange,
  runVerdictOf,
  sortCases,
} from './eval_compare';

describe('buildCompareGrid', () => {
  it('letters the runs, marks the baseline and counts changes against it', () => {
    const grid = buildCompareGrid(twoRunFixture(), undefined, ['run-1', 'run-2'], 'run-1');
    expect(grid.runs.map((r) => [r.letter, r.isBaseline])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    expect(grid.runs[0].changes).toBeUndefined();
    expect(grid.runs[1].changes).toEqual({ regressed: 1, improved: 1, unchanged: 0, shared: 2 });
    expect(grid.shared).toBe(2);
    expect(grid.counts).toEqual({ all: 3, improved: 1, regressed: 1, new: 1, missing: 0 });
    expect(grid.cases[0].caseId).toBe('b');
    expect(grid.cases[0].regressedEvaluations).toEqual(['accuracy']);
  });

  it('measures every run against the chosen baseline', () => {
    const grid = buildCompareGrid(twoRunFixture(), undefined, ['run-1', 'run-2'], 'run-2');
    expect(grid.runs[0].isBaseline).toBe(false);
    const b = grid.cases.find((c) => c.caseId === 'b');
    expect(b?.improvedEvaluations).toEqual(['accuracy']);
    // Case c is not in run-1: missing there against run-2.
    expect(grid.counts.missing).toBe(1);
  });

  it('takes pass rates from the run events and flags status regressions', () => {
    const grid = buildCompareGrid(
      twoRunFixture(),
      twoRunEventsFixture(),
      ['run-1', 'run-2'],
      'run-1'
    );
    expect(grid.runs[0].passRate).toBeCloseTo(2 / 3);
    expect(grid.runs[1].passRateDelta).toBeCloseTo(0.5 - 2 / 3);
    const d = grid.cases.find((c) => c.caseId === 'd');
    expect(d?.kinds.has('regressed')).toBe(true);
    expect(d?.regression).toBeGreaterThanOrEqual(1);
  });

  it('sorts and filters cases', () => {
    const grid = buildCompareGrid(twoRunFixture(), undefined, ['run-1', 'run-2'], 'run-1');
    expect(sortCases(grid.cases, 'improvement')[0].caseId).toBe('a');
    expect(sortCases(grid.cases, 'name').map((c) => c.caseId)).toEqual(['a', 'b', 'c']);
    expect(filterCases(grid.cases, 'new').map((c) => c.caseId)).toEqual(['c']);
  });
});

describe('delta formats', () => {
  const agg = (mean?: number, extra: Record<string, number> = {}) => ({
    name: 'x',
    count: 1,
    mean,
    ...extra,
  });
  it('uses score units, and points for 0..1 scores and pass rates', () => {
    expect(formatAggregateDelta(agg(4, { min: 3, max: 5 }), agg(4.25, { min: 4, max: 5 }))).toBe(
      '↑0.25'
    );
    expect(
      formatAggregateDelta(agg(0.9, { min: 0.9, max: 0.9 }), agg(0.2, { min: 0.2, max: 0.2 }))
    ).toBe('↓70 pp');
    expect(
      formatAggregateDelta(agg(undefined, { passRate: 0.5 }), agg(undefined, { passRate: 0.25 }))
    ).toBe('↓25 pp');
    expect(formatAggregateDelta(undefined, agg(1))).toBeUndefined();
    expect(formatPointsDelta(0)).toBe('±0 pp');
  });
  it('formats durations and says whether they got better', () => {
    expect(formatDurationDelta(-1200)).toBe('↓1.20 s');
    expect(formatDurationDelta(850)).toBe('↑850 ms');
    expect(durationChange(1000, 800)).toBe('improved');
    expect(durationChange(1000, 1030)).toBe('unchanged');
    expect(durationChange(1000, 1300)).toBe('regressed');
    expect(passRateChange(-0.08)).toBe('regressed');
    expect(passRateChange(0)).toBe('unchanged');
  });
});

describe('comparabilityOf', () => {
  const meta = (s?: { metadata?: Record<string, string> }) => ({
    agentVersion: s?.metadata?.['agent.version'],
    model: s?.metadata?.['agent.model'],
  });

  it('reports test cases only one run has', () => {
    const results = twoRunFixture();
    const grid = buildCompareGrid(results, undefined, ['run-1', 'run-2'], 'run-1');
    const c = comparabilityOf(grid, results, meta);
    expect(c.coverage).toEqual({ shared: 2, onlyIn: [{ letter: 'B', count: 1 }], missingFrom: [] });
    expect(c.hasWarnings).toBe(true);
  });

  it('reports evaluator versions, missing pass rules and agent changes', () => {
    const grade = (runId: string, extra: Record<string, unknown>) =>
      makeResult({
        runId,
        suiteName: 's',
        caseId: 'a',
        name: 'tone',
        value: 3,
        time: runId === 'r1' ? '2026-10-25 10:00:00.000' : '2026-10-26 10:00:00.000',
        ...extra,
      });
    const results = [
      grade('r1', { evaluatorVersion: '1.0' }),
      grade('r2', { evaluatorVersion: '1.1', assessment: 'pass' }),
    ];
    const events = {
      cases: [],
      runs: [
        makeRunEvent({ runId: 'r1', suiteName: 's', metadata: { 'agent.version': 'v1' } }),
        makeRunEvent({ runId: 'r2', suiteName: 's', metadata: { 'agent.version': 'v2' } }),
      ],
    };
    const grid = buildCompareGrid(results, events, ['r1', 'r2'], 'r1');
    const c = comparabilityOf(grid, results, meta);
    expect(c.coverage).toBeUndefined();
    expect(c.evaluators).toEqual([
      {
        name: 'tone',
        what: 'version',
        values: [
          { letter: 'A', value: '1.0' },
          { letter: 'B', value: '1.1' },
        ],
      },
    ]);
    expect(c.missingRules).toEqual([{ letter: 'A', names: ['tone'] }]);
    expect(c.changes).toEqual([
      {
        what: 'agentVersion',
        values: [
          { letter: 'A', value: 'v1' },
          { letter: 'B', value: 'v2' },
        ],
      },
    ]);
  });

  it('has nothing to say about identical runs', () => {
    const results = twoRunFixture().filter((r) => r.caseId !== 'c');
    const grid = buildCompareGrid(results, undefined, ['run-1', 'run-2'], 'run-1');
    const c = comparabilityOf(grid, results, meta);
    expect(c).toMatchObject({ evaluators: [], missingRules: [], changes: [], hasWarnings: false });
  });
});

describe('runVerdictOf', () => {
  const grade = (runId: string, name: string, caseId: string, value: number) =>
    makeResult({
      runId,
      suiteName: 's',
      caseId,
      name,
      value,
      scoreMin: 0,
      scoreMax: 1,
      time: runId === 'r1' ? '2026-10-25 10:00:00.000' : '2026-10-26 10:00:00.000',
    });
  const verdict = (results: Array<ReturnType<typeof grade>>) =>
    runVerdictOf(buildCompareGrid(results, undefined, ['r1', 'r2'], 'r1').runs[1]);

  it('is a tradeoff when one mean rises and another falls', () => {
    const v = verdict([
      grade('r1', 'accuracy', 'a', 0.5),
      grade('r1', 'helpfulness', 'a', 0.9),
      grade('r2', 'accuracy', 'a', 0.9),
      grade('r2', 'helpfulness', 'a', 0.5),
    ]);
    expect(v).toMatchObject({ verdict: 'tradeoff', better: ['accuracy'], worse: ['helpfulness'] });
  });

  it('is an improvement or a regression when means move one way', () => {
    expect(
      verdict([grade('r1', 'accuracy', 'a', 0.5), grade('r2', 'accuracy', 'a', 0.9)])?.verdict
    ).toBe('improvement');
    expect(
      verdict([grade('r1', 'accuracy', 'a', 0.9), grade('r2', 'accuracy', 'a', 0.5)])?.verdict
    ).toBe('regression');
  });

  it('falls back to case counts, and is a tie when nothing moved', () => {
    // Means cancel out (0.5 and 0.5), but one case improved and one regressed: a tie.
    const v = verdict([
      grade('r1', 'accuracy', 'a', 0.2),
      grade('r1', 'accuracy', 'b', 0.8),
      grade('r2', 'accuracy', 'a', 0.8),
      grade('r2', 'accuracy', 'b', 0.2),
    ]);
    expect(v).toMatchObject({ verdict: 'tie', improvedCases: 1, regressedCases: 1 });
    expect(
      verdict([grade('r1', 'accuracy', 'a', 0.5), grade('r2', 'accuracy', 'a', 0.52)])?.verdict
    ).toBe('tie');
  });

  it('has no verdict for the baseline', () => {
    const grid = buildCompareGrid(twoRunFixture(), undefined, ['run-1', 'run-2'], 'run-1');
    expect(runVerdictOf(grid.runs[0])).toBeUndefined();
  });
});
