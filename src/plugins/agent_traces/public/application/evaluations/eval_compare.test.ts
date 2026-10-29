/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { twoRunEventsFixture, twoRunFixture } from './eval_test_fixtures';
import {
  buildCompareGrid,
  durationChange,
  filterCases,
  formatAggregateDelta,
  formatDurationDelta,
  formatPointsDelta,
  passRateChange,
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
