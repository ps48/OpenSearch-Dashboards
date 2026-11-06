/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { ResultsView } from './results_view';
import { EvalContext } from './eval_context';
import { shortId } from './eval_components';
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
  usePplRows: (...args: [unknown, string | undefined, unknown]) => mockPpl.hook(...args),
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

  it('has a Version filter: values load on open, and it is pushed down', () => {
    mockPpl.answer((q) =>
      q.includes('sort - n') ? [{ n: 7, 'attributes.gen_ai.agent.version': 'v2' }, { n: 2 }] : []
    );
    const results = { ...EMPTY_RESULTS_FILTERS, versions: ['v1'] };
    const ctx = testContext({ state: { ...testContext().state, results } });
    renderWithContext(<ResultsView lockAgent="tp" />, ctx);
    const filters = { ...results, lockAgent: 'tp' };
    expect(mockPpl.queries).toContain(
      buildResultsPageQuery(TEST_INDEX, filters, DEFAULT_RESULTS_SORT, 0)
    );
    expect(mockPpl.queries).toContain(buildResultsCountQuery(TEST_INDEX, filters));
    expect(screen.getByTestId('agtEvlChip-versions-v1')).toHaveTextContent('Version: v1');
    expect(mockPpl.queries).not.toContain(buildFacetQuery(TEST_INDEX, filters, 'versions'));
    fireEvent.click(screen.getByTestId('agtEvlFacet-versions'));
    expect(mockPpl.queries).toContain(buildFacetQuery(TEST_INDEX, filters, 'versions'));
    const list = screen.getByTestId('agtEvlFacetList-versions');
    expect(within(list).getByText('(no version)')).toBeInTheDocument();
    fireEvent.click(within(list).getByText('v2'));
    expect(ctx.setState).toHaveBeenCalledWith({ results: { ...results, versions: ['v2', 'v1'] } });
  });

  it('reads only a clicked chart slice, says so, and goes back to the range', () => {
    const slice = { from: Date.UTC(2026, 9, 28, 3), to: Date.UTC(2026, 9, 28, 6) };
    const results = { ...EMPTY_RESULTS_FILTERS, verdicts: ['fail'] };
    const ctx = testContext({ state: { ...testContext().state, results, slice } });
    renderWithContext(<ResultsView lockAgent="tp" />, ctx);
    const page = buildResultsPageQuery(
      TEST_INDEX,
      { ...results, lockAgent: 'tp' },
      DEFAULT_RESULTS_SORT,
      0
    );
    expect(mockPpl.ranges.get(page)).toEqual({
      from: '2026-10-28T03:00:00.000Z',
      to: '2026-10-28T06:00:00.000Z',
    });
    expect(screen.getByTestId('agtEvlSliceCallout')).toHaveTextContent(
      'Showing the slice you clicked on the chart:'
    );
    fireEvent.click(screen.getByTestId('agtEvlClearSlice'));
    expect(screen.getByTestId('agtEvlClearSlice')).toHaveTextContent('Back to Last 7 days');
    expect(ctx.setState).toHaveBeenCalledWith({ slice: undefined });
  });

  it('sorts and pages on the server, the sort kept in the app state', () => {
    const { ctx } = renderWithContext(<ResultsView />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Score/ })[0]);
    expect(ctx.setState).toHaveBeenCalledWith({
      resultsSort: { field: 'score', direction: 'asc' },
    });
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

  it('opens with the stored sort', () => {
    const ctx = testContext({
      state: { ...testContext().state, resultsSort: { field: 'agent', direction: 'asc' } },
    });
    renderWithContext(<ResultsView />, ctx);
    expect(mockPpl.queries).toContain(
      buildResultsPageQuery(
        TEST_INDEX,
        EMPTY_RESULTS_FILTERS,
        { field: 'agent', direction: 'asc' },
        0
      )
    );
  });

  it('home: a titled panel with the total and what a row is; none on the agent page', () => {
    renderWithContext(<ResultsView />);
    const panel = screen.getByTestId('agtEvlResultsPanel');
    expect(panel).toHaveTextContent('Eval results');
    expect(panel).toHaveTextContent(
      'Every evaluation result, online and offline: one row per verdict on a span, trace or session'
    );
  });

  it('agent page: no panel of its own (the page has its header)', () => {
    renderWithContext(<ResultsView lockAgent="tp" />);
    expect(screen.queryByTestId('agtEvlResultsPanel')).not.toBeInTheDocument();
  });

  it('opens a result on a row click', () => {
    const { ctx } = renderWithContext(<ResultsView />);
    fireEvent.click(screen.getByText('Why 2'));
    expect(ctx.openResult).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 't2', verdict: 'pass' })
    );
  });

  it('opens a result from the keyboard: the evaluation name is a link', () => {
    const { ctx } = renderWithContext(<ResultsView />);
    const links = screen.getAllByTestId('agtEvlResultOpen');
    expect(links[1].tagName).toBe('BUTTON');
    fireEvent.click(links[1]);
    expect(ctx.openResult).toHaveBeenCalledTimes(1);
    expect(ctx.openResult).toHaveBeenCalledWith(expect.objectContaining({ traceId: 't2' }));
  });

  it('keeps the page on Refresh, goes back to page 1 on a new range', () => {
    const ctx = testContext();
    const page = (p: number) =>
      buildResultsPageQuery(TEST_INDEX, EMPTY_RESULTS_FILTERS, DEFAULT_RESULTS_SORT, p);
    const { rerender } = renderWithContext(<ResultsView />, ctx);
    fireEvent.click(screen.getByTestId('pagination-button-next'));
    expect(mockPpl.queries).toContain(page(1));
    const rerenderWith = (patch: Partial<typeof ctx>) =>
      rerender(
        <I18nProvider>
          <EvalContext.Provider value={{ ...ctx, ...patch }}>
            <ResultsView />
          </EvalContext.Provider>
        </I18nProvider>
      );
    // Refresh: a relative range resolves to new bounds, and refreshKey changes.
    const refreshed = { from: '2026-10-28T00:00:01.000Z', to: '2026-10-29T00:00:01.000Z' };
    mockPpl.queries.length = 0;
    rerenderWith({ timeRange: refreshed, refreshKey: 1 });
    expect(mockPpl.queries).toContain(page(1));
    expect(mockPpl.queries).not.toContain(page(0));
    // A new range: page 1 again.
    rerenderWith({
      timeRange: { from: '2026-10-01T00:00:00.000Z', to: refreshed.to },
      refreshKey: 1,
    });
    expect(mockPpl.queries).toContain(page(0));
  });

  it('goes back to page 1 on a new range after a Refresh that kept the same bounds', () => {
    const ctx = testContext();
    const page = (p: number) =>
      buildResultsPageQuery(TEST_INDEX, EMPTY_RESULTS_FILTERS, DEFAULT_RESULTS_SORT, p);
    const { rerender } = renderWithContext(<ResultsView />, ctx);
    fireEvent.click(screen.getByTestId('pagination-button-next'));
    const rerenderWith = (patch: Partial<typeof ctx>) =>
      rerender(
        <I18nProvider>
          <EvalContext.Provider value={{ ...ctx, ...patch }}>
            <ResultsView />
          </EvalContext.Provider>
        </I18nProvider>
      );
    // Refresh over an absolute range: refreshKey changes, the bounds do not.
    rerenderWith({ refreshKey: 1 });
    mockPpl.queries.length = 0;
    // A new range is a filter change, not a refresh: page 1 again.
    rerenderWith({
      timeRange: { from: '2026-10-01T00:00:00.000Z', to: ctx.timeRange.to },
      refreshKey: 1,
    });
    expect(mockPpl.queries).toContain(page(0));
  });

  it('searches a filter menu', () => {
    mockPpl.answer((q) =>
      q.includes('sort - n')
        ? [
            { n: 40, 'attributes.gen_ai.evaluation.name': 'accuracy' },
            { n: 9, 'attributes.gen_ai.evaluation.name': 'tone' },
          ]
        : []
    );
    renderWithContext(<ResultsView />);
    fireEvent.click(screen.getByTestId('agtEvlFacet-names'));
    const list = screen.getByTestId('agtEvlFacetList-names');
    expect(within(list).getByText('tone')).toBeInTheDocument();
    fireEvent.change(within(list).getByTestId('agtEvlFacetSearch-names'), {
      target: { value: 'acc' },
    });
    // The match is highlighted inside the option: compare the options' text.
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([expect.stringContaining('accuracy')]);
  });

  it('shows what each result judged, linked in a new tab when the context gives a URL', () => {
    mockPpl.answer((q) =>
      q.endsWith('stats count() as total')
        ? [{ total: 3 }]
        : [
            doc(1),
            doc(2, { opensearch: { gen_ai: { evaluation: { level: 'span' } } } }),
            doc(3, {
              opensearch: { gen_ai: { evaluation: { level: 'session' } } },
              gen_ai: {
                evaluation: { name: 'goal', score: { label: 'pass' } },
                conversation: { id: 'conv-0123456789' },
              },
            }),
          ].map((d, i) => (i === 1 ? { ...d, spanId: 'span-abcdef12' } : d))
    );
    const hrefOf = jest.fn((r: { traceId?: string }) =>
      r.traceId === 't1' ? 'https://osd/app/agentTraces#t1' : undefined
    );
    const ctx = testContext({ hrefOf });
    renderWithContext(<ResultsView />, ctx);
    const table = screen.getByTestId('agtEvlResultsTable');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent ?? '');
    expect(headers.some((h) => h.includes('Judged'))).toBe(true);
    const trace = within(table).getByTestId('agtEvlTarget-trace');
    expect(trace).toHaveTextContent('Trace t1');
    expect(trace).toHaveAttribute('href', 'https://osd/app/agentTraces#t1');
    expect(trace).toHaveAttribute('target', '_blank');
    // The link opens the target, not the result.
    fireEvent.click(trace);
    expect(ctx.openResult).not.toHaveBeenCalled();
    // No URL: the target as text.
    const span = within(table).getByTestId('agtEvlTarget-span');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveTextContent(`Span ${shortId('span-abcdef12')}`);
    expect(within(table).getByTestId('agtEvlTarget-session')).toHaveTextContent('Session');
  });

  it('shows the error type when an evaluator error has no explanation', () => {
    mockPpl.answer((q) =>
      q.endsWith('stats count() as total')
        ? [{ total: 1 }]
        : [
            {
              '@timestamp': '2026-10-28 07:00:01',
              traceId: 't9',
              attributes: {
                gen_ai: { evaluation: { name: 'accuracy' }, agent: { name: 'tp' } },
                error: { type: 'ThrottlingException' },
              },
            },
          ]
    );
    renderWithContext(<ResultsView />);
    const code = within(screen.getByTestId('agtEvlResultsTable')).getByText('ThrottlingException');
    expect(code.tagName).toBe('CODE');
  });

  it('offers Clear filters on an empty table when filters are set', () => {
    mockPpl.answer(() => []);
    const results = { ...EMPTY_RESULTS_FILTERS, verdicts: ['fail'], names: ['tone'] };
    const ctx = testContext({ state: { ...testContext().state, results } });
    renderWithContext(<ResultsView />, ctx);
    expect(screen.getByTestId('agtEvlResultsEmpty')).toHaveTextContent(
      'No results match these filters in the range.'
    );
    fireEvent.click(screen.getByTestId('agtEvlResultsEmptyClear'));
    expect(ctx.setState).toHaveBeenCalledWith({
      results: { ...results, agents: [], names: [], versions: [], verdicts: [] },
    });
  });

  it('has no Clear filters link on an empty table without filters', () => {
    mockPpl.answer(() => []);
    renderWithContext(<ResultsView />);
    expect(screen.getByTestId('agtEvlResultsEmpty')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlResultsEmptyClear')).not.toBeInTheDocument();
  });
});
