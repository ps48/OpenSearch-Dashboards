/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { CompareRuns } from './compare_runs';
import { TEST_INDEX, fakePpl, renderWithContext } from './eval_test_utils';
import { buildCompareRunsQuery, buildSuiteRunsQuery } from './eval_ppl';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));
const mockFlyout = jest.fn();
jest.mock('./trace_compare_flyout', () => ({
  TraceCompareFlyout: (props: unknown) => {
    mockFlyout(props);
    return <div data-test-subj="traceCompare" />;
  },
}));

const A = 'run_20261026_aaaa1111';
const B = 'run_20261028_bbbb2222';
const row = (run: string, caseId: string, name: string, verdict: string) => ({
  n: 1,
  started: run === A ? '2026-10-26 07:00:00' : '2026-10-28 07:00:00',
  'attributes.test.suite.run.id': run,
  'attributes.test.suite.name': 'golden',
  'attributes.gen_ai.agent.name': 'tp',
  'attributes.gen_ai.agent.version': run === A ? 'v1' : 'v2',
  'attributes.test.case.id': caseId,
  'attributes.test.case.name': `Case ${caseId}`,
  'attributes.gen_ai.evaluation.name': name,
  verdict,
  traceId: `${run}-${caseId}`,
});

describe('CompareRuns', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockFlyout.mockClear();
    mockPpl.answer((q) =>
      q.includes(' or ')
        ? [
            row(A, 'c1', 'accuracy', 'pass'),
            row(A, 'c2', 'accuracy', 'fail'),
            row(A, 'c3', 'accuracy', 'pass'),
            row(B, 'c1', 'accuracy', 'fail'),
            row(B, 'c2', 'accuracy', 'pass'),
            row(B, 'c3', 'accuracy', 'pass'),
          ]
        : [
            {
              n: 1,
              started: '2026-10-25 07:00:00',
              'attributes.test.suite.run.id': 'run_x_zzzz9999',
              verdict: 'pass',
            },
          ]
    );
  });

  it('runs one aggregation over both runs and shows changed cases first', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildCompareRunsQuery(TEST_INDEX, A, B)]));
    expect(screen.getByTestId('agtEvlRunCard-Run A')).toHaveTextContent('2 / 3 cases passed');
    expect(screen.getByTestId('agtEvlRunCard-Run B')).toHaveTextContent('67% result pass rate');
    const cases = screen.getByTestId('agtEvlCompareCases');
    expect(within(cases).getByText('Regressed')).toBeInTheDocument();
    expect(within(cases).getByText('Fixed')).toBeInTheDocument();
    expect(within(cases).queryByText('Case c3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlAllCases'));
    expect(within(cases).getByText('Case c3')).toBeInTheDocument();
    expect(within(cases).getByText('Same')).toBeInTheDocument();
    expect(screen.getAllByText('Run A · v1').length).toBeGreaterThan(0);
  });

  it('opens Compare traces for a case', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    fireEvent.click(screen.getByTestId('agtEvlCompareTraces-c1'));
    expect(mockFlyout).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'c1',
        traceA: `${A}-c1`,
        traceB: `${B}-c1`,
        versionA: 'v1',
      })
    );
  });

  it('swaps A and B, and picks another run from the suite when the picker opens', () => {
    const { ctx } = renderWithContext(<CompareRuns runA={A} runB={B} />);
    fireEvent.click(screen.getByTestId('agtEvlSwapRuns'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'compare', runA: B, runB: A });
    fireEvent.click(screen.getByTestId('agtEvlPickRun-a'));
    expect(mockPpl.queries).toContain(buildSuiteRunsQuery(TEST_INDEX, 'golden'));
    fireEvent.click(screen.getByText('zzzz9999'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'compare', runA: 'run_x_zzzz9999', runB: B });
  });
});
