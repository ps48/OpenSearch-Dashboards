/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { KPI_SPECS, KpiCards, kpiChange } from './suite_detail';
import type { RunSummary } from './eval_aggregations';

const run = (runId: string, started: number, passed: number, previousRunId?: string) =>
  ({
    runId,
    suiteName: 'golden',
    started,
    ended: started + 1,
    results: 8,
    cases: 8,
    casesPassed: passed,
    casesFailed: 8 - passed,
    casesErrored: 0,
    fromCaseEvents: true,
    evaluators: {},
    regressedEvaluators: [],
    passRateDropped: false,
    previousRunId,
  }) as RunSummary;

const spec = (id: string) => KPI_SPECS.find((s) => s.id === id)!;

describe('suite_detail', () => {
  it('colors a change by which way is better', () => {
    expect(kpiChange(spec('casesPassed'), 7, 8)).toEqual({ text: '↘ 1', change: 'regressed' });
    expect(kpiChange(spec('latencyP50'), 1000, 2000).change).toBe('improved');
    expect(kpiChange(spec('evaluatorErrors'), 2, 0).change).toBe('regressed');
    expect(kpiChange(spec('tokens'), 5, 5).change).toBe('unchanged');
    expect(kpiChange(spec('tokens'), undefined, 5)).toEqual({});
  });

  it('shows the latest run against the run before it, and leaves out unknown cards', () => {
    const runs = [run('a', 1, 8), run('b', 2, 7, 'a')];
    const byRun = new Map([
      ['a', { runId: 'a', latencyP50Ms: 1000, evaluatorErrors: 0 }],
      ['b', { runId: 'b', latencyP50Ms: 2500, evaluatorErrors: 1 }],
    ]);
    render(<KpiCards runs={runs} kpis={{ loading: false, byRun }} />);
    expect(screen.getByTestId('agtEvlKpi-casesPassed').textContent).toContain('7 / 8');
    expect(screen.getByTestId('agtEvlKpiDelta-casesPassed').getAttribute('data-change')).toBe(
      'regressed'
    );
    expect(screen.getByTestId('agtEvlKpiDelta-latencyP50').getAttribute('data-change')).toBe(
      'regressed'
    );
    expect(screen.getByTestId('agtEvlKpi-evaluatorErrors')).toBeTruthy();
    // No span data: no tokens or tool call cards.
    expect(screen.queryByTestId('agtEvlKpi-tokens')).toBeNull();
    expect(screen.queryByTestId('agtEvlKpi-toolCalls')).toBeNull();
  });
});
