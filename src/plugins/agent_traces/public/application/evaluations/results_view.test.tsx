/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { ResultsView } from './results_view';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import {
  DEFAULT_RESULTS_SORT,
  EMPTY_RESULTS_FILTERS,
  buildFacetQuery,
  buildResultsCountQuery,
  buildResultsPageQuery,
} from './eval_ppl';

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

const doc = (i: number, extra: Record<string, unknown> = {}) => ({
  '@timestamp': `2026-10-28 07:00:0${i}`,
  traceId: `t${i}`,
  attributes: {
    gen_ai: {
      evaluation: {
        name: 'accuracy',
        score: { value: 0.25 * i, label: i % 2 ? 'fail' : 'pass' },
        explanation: `Why ${i}`,
      },
      agent: { name: 'tp', version: 'v2' },
    },
    ...extra,
  },
});

describe('ResultsView', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockPpl.answer((q) => {
      if (q.endsWith('stats count() as total')) return [{ total: 60 }];
      if (q.includes('sort - n'))
        return [{ n: 40, 'attributes.gen_ai.evaluation.name': 'accuracy' }];
      return [
        doc(1, { test: { suite: { name: 'g', run: { id: 'run_20261028_abcd1234' } } } }),
        doc(2),
      ];
    });
  });

  it('runs a page query and a count; filter menus load nothing until opened', () => {
    renderWithContext(<ResultsView />);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([
        buildResultsPageQuery(TEST_INDEX, EMPTY_RESULTS_FILTERS, DEFAULT_RESULTS_SORT, 0),
        buildResultsCountQuery(TEST_INDEX, EMPTY_RESULTS_FILTERS),
      ])
    );
    const table = screen.getByTestId('agtEvlResultsTable');
    expect(within(table).getByText('Why 1')).toBeInTheDocument();
    expect(within(table).getByText('abcd1234')).toBeInTheDocument();
    expect(within(table).getByText('online')).toBeInTheDocument();
    expect(within(table).getByText('Fail')).toBeInTheDocument();
    expect(within(table).getByText('0.25')).toBeInTheDocument();
  });

  it('a filter menu loads its values when opened and updates the filter', () => {
    const { ctx } = renderWithContext(<ResultsView />);
    fireEvent.click(screen.getByTestId('agtEvlFacet-names'));
    expect(mockPpl.queries).toContain(buildFacetQuery(TEST_INDEX, EMPTY_RESULTS_FILTERS, 'names'));
    fireEvent.click(within(screen.getByTestId('agtEvlFacetList-names')).getByText('accuracy'));
    expect(ctx.setState).toHaveBeenCalledWith({
      results: { ...EMPTY_RESULTS_FILTERS, names: ['accuracy'] },
    });
  });

  it('pushes stored filters into the page and count queries, with chips to remove them', () => {
    const results = { ...EMPTY_RESULTS_FILTERS, verdicts: ['fail'], source: 'offline' as const };
    const ctx = testContext({ state: { ...testContext().state, results } });
    renderWithContext(<ResultsView />, ctx);
    expect(mockPpl.queries).toContain(
      buildResultsPageQuery(TEST_INDEX, results, DEFAULT_RESULTS_SORT, 0)
    );
    expect(mockPpl.queries).toContain(buildResultsCountQuery(TEST_INDEX, results));
    expect(screen.getByTestId('agtEvlChip-verdicts-fail')).toHaveTextContent('Verdict: Fail');
    fireEvent.click(screen.getByTestId('agtEvlClearChips'));
    expect(ctx.setState).toHaveBeenCalledWith({ results: { ...results, verdicts: [] } });
  });

  it('sorts and pages on the server', () => {
    renderWithContext(<ResultsView />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Score/ })[0]);
    expect(mockPpl.queries).toContain(
      buildResultsPageQuery(
        TEST_INDEX,
        EMPTY_RESULTS_FILTERS,
        { field: 'score', direction: 'asc' },
        0
      )
    );
    fireEvent.click(screen.getByTestId('pagination-button-next'));
    expect(mockPpl.queries).toContain(
      buildResultsPageQuery(
        TEST_INDEX,
        EMPTY_RESULTS_FILTERS,
        { field: 'score', direction: 'asc' },
        1
      )
    );
  });

  it('opens a result on a row click', () => {
    const { ctx } = renderWithContext(<ResultsView />);
    fireEvent.click(screen.getByText('Why 2'));
    expect(ctx.openResult).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 't2', verdict: 'pass' })
    );
  });
});
