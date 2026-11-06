/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { SuitePage, ciLabel, compareOrder, runVersionMarkers } from './suite_page';
import { TEST_INDEX, fakePpl, renderWithContext } from './eval_test_utils';
import { buildRunNamesQuery, buildSuiteRunCasesQuery, buildSuiteRunsQuery } from './eval_ppl';
import { RunRow, emptyTally } from './eval_model';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));
jest.mock('./pass_rate_chart', () => ({ PassRateChart: () => <div /> }));

const run = (
  id: string,
  day: number,
  version: string,
  verdict: string,
  n: number,
  ci?: string
) => ({
  n,
  started: `2026-10-${day} 07:00:00`,
  'attributes.test.suite.run.id': id,
  'attributes.gen_ai.agent.name': 'tp',
  'attributes.gen_ai.agent.version': version,
  'attributes.cicd.pipeline.run.url.full': ci ?? null,
  verdict,
});

describe('SuitePage', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockPpl.answer((q) =>
      q.includes('as cases')
        ? [
            { 'attributes.test.suite.run.id': 'run_20261028_cccc3333', cases: 12, passed: 7 },
            { 'attributes.test.suite.run.id': 'run_20261027_bbbb2222', cases: 4, passed: 4 },
          ]
        : [
            run('run_20261026_aaaa1111', 26, 'v1', 'pass', 8),
            run('run_20261027_bbbb2222', 27, 'v1', 'pass', 6),
            run('run_20261027_bbbb2222', 27, 'v1', 'error', 2),
            run(
              'run_20261028_cccc3333',
              28,
              'v2',
              'fail',
              4,
              'https://github.com/o/r/actions/runs/1793'
            ),
            run(
              'run_20261028_cccc3333',
              28,
              'v2',
              'pass',
              4,
              'https://github.com/o/r/actions/runs/1793'
            ),
          ]
    );
  });

  it('runs the runs, cases and run names queries and lists runs with errors and CI links', () => {
    renderWithContext(<SuitePage suite="golden" />);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([
        buildSuiteRunsQuery(TEST_INDEX, 'golden'),
        buildSuiteRunCasesQuery(TEST_INDEX, 'golden'),
        // The latest runs first.
        buildRunNamesQuery(TEST_INDEX, [
          'run_20261028_cccc3333',
          'run_20261027_bbbb2222',
          'run_20261026_aaaa1111',
        ]),
      ])
    );
    expect(screen.getByTestId('agtEvlSuiteMeta')).toHaveTextContent('tp');
    const c = screen.getByTestId('agtEvlRunRow-run_20261028_cccc3333');
    expect(within(c).getByText('cccc3333')).toBeInTheDocument();
    expect(within(c).getByText('50%')).toBeInTheDocument();
    expect(within(c).getByText('#1793')).toBeInTheDocument();
    const b = screen.getByTestId('agtEvlRunRow-run_20261027_bbbb2222');
    expect(within(b).getByText('2')).toBeInTheDocument();
  });

  it('shows cases passed per run next to the result pass rate', () => {
    renderWithContext(<SuitePage suite="golden" />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers.some((h) => h.includes('Cases passed'))).toBe(true);
    expect(headers.some((h) => h.includes('Result pass rate'))).toBe(true);
    const c = screen.getByTestId('agtEvlRunCases-run_20261028_cccc3333');
    expect(c).toHaveTextContent('7 / 12');
    // The bar only: the number is the count.
    expect(c).not.toHaveTextContent('%');
    expect(c.querySelector('.agtEvlRate__fill')).toHaveStyle('width: 58%');
    expect(screen.getByTestId('agtEvlRunCases-run_20261027_bbbb2222')).toHaveTextContent('4 / 4');
    // No cases row for the run: a dash.
    const a = screen.getByTestId('agtEvlRunRow-run_20261026_aaaa1111');
    expect(within(a).queryByTestId(/^agtEvlRunCases-/)).not.toBeInTheDocument();
  });

  it('compares two selected runs, older as Run A', () => {
    const { ctx } = renderWithContext(<SuitePage suite="golden" />);
    const button = screen.getByTestId('agtEvlCompareButton');
    expect(button).toBeDisabled();
    const boxes = screen.getAllByRole('checkbox').filter((b) => b.closest('tbody'));
    // At most two runs: no select-all checkbox in the header.
    expect(screen.getAllByRole('checkbox').filter((b) => b.closest('thead'))).toHaveLength(0);
    // Newest first: c, b, a.
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[2]);
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Compare 2 runs');
    // Two picked: the third waits for a Clear.
    expect(screen.getByTestId('agtEvlSelectRun-run_20261027_bbbb2222')).toBeDisabled();
    fireEvent.click(button);
    expect(ctx.navigate).toHaveBeenCalledWith({
      page: 'compare',
      runA: 'run_20261026_aaaa1111',
      runB: 'run_20261028_cccc3333',
    });
  });

  it('opens a run on a row click', () => {
    const { ctx } = renderWithContext(<SuitePage suite="golden" />);
    fireEvent.click(
      within(screen.getByTestId('agtEvlRunRow-run_20261026_aaaa1111')).getByText('v1')
    );
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'run', runId: 'run_20261026_aaaa1111' });
  });

  it('helpers: CI label, version markers, compare order', () => {
    expect(ciLabel('https://ci/runs/42/')).toBe('#42');
    const r = (runId: string, started: number, version: string): RunRow => ({
      runId,
      started,
      version,
      tally: emptyTally(),
    });
    expect(runVersionMarkers([r('a', 1, 'v1'), r('b', 2, 'v1'), r('c', 3, 'v2')])).toEqual([
      { t: 3, label: 'v2' },
    ]);
    expect(compareOrder([r('new', 5, 'v2'), r('old', 1, 'v1')])).toEqual(['old', 'new']);
  });
});
