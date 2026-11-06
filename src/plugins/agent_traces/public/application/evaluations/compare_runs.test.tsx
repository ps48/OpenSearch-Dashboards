/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { CompareRuns, filterCompareCases } from './compare_runs';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import {
  buildCaseResultsQuery,
  buildCompareRunsQuery,
  buildRootSpansQuery,
  buildSuiteRunsQuery,
  buildRunNamesQuery,
} from './eval_ppl';
import { shortId } from './eval_components';

// jsdom has no layout: AutoSizer would measure 0x0 and EuiSelectable would list no rows.
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: { children: (size: { width: number; height: number }) => unknown }) =>
    children({ width: 400, height: 400 }),
}));

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

const IN = 'attributes.gen_ai.input.messages';
const OUT = 'attributes.gen_ai.output.messages';
const msg = (role: string, content: string) =>
  JSON.stringify([{ role, parts: [{ type: 'text', content }] }]);
const doc = (run: string, caseId: string, name: string, label: string, why: string) => ({
  '@timestamp': '2026-10-28 07:00:01',
  traceId: `${run}-${caseId}`,
  attributes: {
    gen_ai: { evaluation: { name, score: { label }, explanation: why } },
    test: { suite: { run: { id: run } }, case: { id: caseId } },
    opensearch: { test: { case: { expected: 'Paris, with flights' } } },
  },
});

describe('CompareRuns', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockFlyout.mockClear();
    mockPpl.answer((q) => {
      if (q.includes('`parentSpanId`'))
        return [
          {
            traceId: `${A}-c1`,
            [IN]: msg('user', 'Capital of France?'),
            [OUT]: msg('assistant', 'Paris'),
          },
          { traceId: `${B}-c1`, [OUT]: msg('assistant', 'Lyon') },
        ];
      if (q.endsWith('head 100'))
        return [
          doc(A, 'c1', 'accuracy', 'pass', 'Right city'),
          doc(B, 'c1', 'accuracy', 'fail', 'Wrong city'),
          doc(B, 'c1', 'tone', 'pass', 'Polite'),
        ];
      if (q.includes(' or '))
        return [
          row(A, 'c1', 'accuracy', 'pass'),
          row(A, 'c2', 'accuracy', 'fail'),
          row(A, 'c3', 'accuracy', 'pass'),
          row(B, 'c1', 'accuracy', 'fail'),
          row(B, 'c2', 'accuracy', 'pass'),
          row(B, 'c3', 'accuracy', 'pass'),
          row(B, 'c4', 'accuracy', 'pass'),
        ];
      return [
        {
          n: 1,
          started: '2026-10-25 07:00:00',
          'attributes.test.suite.run.id': 'run_x_zzzz9999',
          verdict: 'pass',
        },
      ];
    });
  });

  it('runs one aggregation over both runs and shows changed cases first', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([buildCompareRunsQuery(TEST_INDEX, A, B), buildRunNamesQuery(TEST_INDEX, [A, B])])
    );
    // Without run names, each card names its run by its short id.
    expect(screen.getByTestId('agtEvlRunCardName-Run A')).toHaveTextContent(shortId(A));
    expect(screen.getByTestId('agtEvlRunCard-Run A')).toHaveTextContent('2 / 3 cases passed');
    expect(screen.getByTestId('agtEvlRunCard-Run B')).toHaveTextContent('75% result pass rate');
    const cases = screen.getByTestId('agtEvlCompareCases');
    expect(within(cases).getByText('Regressed')).toBeInTheDocument();
    expect(within(cases).getByText('Fixed')).toBeInTheDocument();
    expect(within(cases).getByText('Only in B')).toBeInTheDocument();
    expect(within(cases).getByText('Not in run')).toBeInTheDocument();
    expect(within(cases).queryByText('Case c3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-all'));
    expect(within(cases).getByText('Case c3')).toBeInTheDocument();
    expect(within(cases).getByText('Same')).toBeInTheDocument();
    expect(screen.getAllByText('Run A · v1').length).toBeGreaterThan(0);
  });

  it('names a run without results instead of comparing against nothing', () => {
    renderWithContext(<CompareRuns runA={A} runB="run_unknown" />);
    expect(screen.getByTestId('agtEvlCompareRunNotFound')).toHaveTextContent(
      'No results for run run_unknown in the range'
    );
  });

  it('has no run-not-found callout when both runs have results', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    expect(screen.queryByTestId('agtEvlCompareRunNotFound')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlTruncated')).not.toBeInTheDocument();
  });

  it('filters Changed, Regressed, Fixed, Only in one run and All, with counts', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    expect(screen.getByTestId('agtEvlCaseFilter-changed')).toHaveTextContent('3');
    expect(screen.getByTestId('agtEvlCaseFilter-regressed')).toHaveTextContent('1');
    expect(screen.getByTestId('agtEvlCaseFilter-fixed')).toHaveTextContent('1');
    expect(screen.getByTestId('agtEvlCaseFilter-only')).toHaveTextContent('1');
    expect(screen.getByTestId('agtEvlCaseFilter-all')).toHaveTextContent('4');
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-regressed'));
    const cases = screen.getByTestId('agtEvlCompareCases');
    expect(within(cases).getByText('Case c1')).toBeInTheDocument();
    expect(within(cases).queryByText('Case c2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-only'));
    expect(within(cases).getByText('Case c4')).toBeInTheDocument();
    expect(within(cases).queryByText('Case c1')).not.toBeInTheDocument();
    // Only in one run is offered only when some case is.
    expect(filterCompareCases([], 'only')).toEqual([]);
  });

  it('shows n with each evaluation change', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    expect(screen.getByTestId('agtEvlCompareEvaluations')).toHaveTextContent('n 4/3');
  });

  it('expands a case: input, expected, both outputs and every result of each run', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    fireEvent.click(screen.getByTestId('agtEvlCompareRow-c1'));
    expect(mockPpl.queries).toContain(buildCaseResultsQuery(TEST_INDEX, [A, B], 'c1'));
    expect(mockPpl.queries).toContain(buildRootSpansQuery('spans-*', [`${A}-c1`, `${B}-c1`]));
    const detail = screen.getByTestId('agtEvlCompareCase-c1');
    const io = within(detail).getByTestId('agtEvlCompareIO');
    const input = within(io).getByTestId('agtEvlIO-input');
    expect(input).toHaveTextContent('User');
    expect(input).toHaveTextContent('Capital of France?');
    expect(within(io).getByTestId('agtEvlIO-expected')).toHaveTextContent('Paris, with flights');
    expect(within(io).getByTestId('agtEvlIO-expected')).toHaveTextContent(
      'opensearch.test.case.expected'
    );
    const sideA = within(detail).getByTestId('agtEvlCompareSide-a');
    const sideB = within(detail).getByTestId('agtEvlCompareSide-b');
    const outA = within(sideA).getByTestId('agtEvlIO-output-a');
    expect(outA).toHaveTextContent('Run A (v1)');
    expect(outA).toHaveTextContent('Assistant');
    expect(outA).toHaveTextContent('Paris');
    const outB = within(sideB).getByTestId('agtEvlIO-output-b');
    expect(outB).toHaveTextContent('Run B (v2)');
    expect(outB).toHaveTextContent('Lyon');
    // Every result of the run, failing first, passing ones too.
    const resultsA = within(sideA).getByTestId('agtEvlCompareResults-a');
    expect(resultsA).toHaveTextContent('Right city');
    expect(within(resultsA).getByTestId('agtEvlVerdict-pass')).toBeInTheDocument();
    const resultsB = within(sideB).getByTestId('agtEvlCompareResults-b');
    expect(resultsB).toHaveTextContent(/Wrong city.*Polite/);
    expect(
      within(resultsB)
        .getAllByTestId(/^agtEvlVerdict-/)
        .map((el) => el.getAttribute('data-test-subj'))
    ).toEqual(['agtEvlVerdict-fail', 'agtEvlVerdict-pass']);
    fireEvent.click(within(detail).getByTestId('agtEvlCompareTracesDetail-c1'));
    expect(mockFlyout).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'c1' }));
  });

  it('opens a result from a side', () => {
    const { ctx } = renderWithContext(<CompareRuns runA={A} runB={B} />);
    fireEvent.click(screen.getByTestId('agtEvlCompareRow-c1'));
    fireEvent.click(within(screen.getByTestId('agtEvlCompareResults-b')).getByText('tone'));
    expect(ctx.openResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tone', verdict: 'pass' })
    );
  });

  it('says Not in run for a side without the case', () => {
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-only'));
    fireEvent.click(screen.getByTestId('agtEvlCompareRow-c4'));
    const sideA = screen.getByTestId('agtEvlCompareSide-a');
    expect(within(sideA).queryByTestId('agtEvlCompareResults-a')).not.toBeInTheDocument();
    expect(sideA).toHaveTextContent('Not in run');
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
    const list = screen.getByTestId('agtEvlPickRunList-a');
    fireEvent.click(within(list).getByTestId('agtEvlRunOption-run_x_zzzz9999'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'compare', runA: 'run_x_zzzz9999', runB: B });
  });

  it('reads the suite runs for the picker over the browse range', () => {
    const browseRange = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' };
    renderWithContext(<CompareRuns runA={A} runB={B} />, testContext({ browseRange }));
    fireEvent.click(screen.getByTestId('agtEvlPickRun-a'));
    expect(mockPpl.ranges.get(buildSuiteRunsQuery(TEST_INDEX, 'golden'))).toEqual(browseRange);
  });

  it('names each run card by its run name, with its description', () => {
    const names = [
      {
        'attributes.test.suite.run.id': B,
        'attributes.opensearch.test.suite.run.name': 'v5 shorter prompt',
        'attributes.opensearch.test.suite.run.description': 'Trimmed the system prompt',
      },
    ];
    const answerOf = (q: string) =>
      q === buildRunNamesQuery(TEST_INDEX, [A, B]) ? names : undefined;
    const base = mockPpl.hook;
    const hook = jest.spyOn(mockPpl, 'hook').mockImplementation((d, q, t) => {
      const named = q ? answerOf(q) : undefined;
      return named ? { rows: named, loading: false, loaded: true } : base(d, q, t);
    });
    renderWithContext(<CompareRuns runA={A} runB={B} />);
    expect(screen.getByTestId('agtEvlRunCardName-Run B')).toHaveTextContent('v5 shorter prompt');
    expect(screen.getByTestId('agtEvlRunCard-Run B')).toHaveTextContent(shortId(B));
    expect(screen.getByTestId('agtEvlRunCardDescription-Run B')).toHaveTextContent(
      'Trimmed the system prompt'
    );
    expect(screen.getByTestId('agtEvlRunCardName-Run A')).toHaveTextContent(shortId(A));
    hook.mockRestore();
  });
});
