/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { RunsView } from './runs_view';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import {
  EMPTY_RUNS_FILTERS,
  RunsFilters,
  buildEvalRunCasesQuery,
  buildEvalRunsQuery,
  buildRunsFacetQuery,
  buildRunsLookupQuery,
  buildSuiteRunsQuery,
} from './eval_ppl';
import { PplRecord } from './eval_model';

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

const RUN_ID = 'attributes.test.suite.run.id';
const SUITE = 'attributes.test.suite.name';
const AGENT = 'attributes.gen_ai.agent.name';
const VERSION = 'attributes.gen_ai.agent.version';

const row = (
  runId: string,
  suite: string,
  agent: string,
  version: string,
  day: number,
  verdict: string,
  n: number
): PplRecord => ({
  n,
  started: `2026-10-${day} 07:00:00`,
  [RUN_ID]: runId,
  [SUITE]: suite,
  [AGENT]: agent,
  [VERSION]: version,
  verdict,
});

// golden by tp: three runs; golden by bot: one run; refunds by tp: one run.
const RUNS: PplRecord[] = [
  row('run_g_tp_3', 'golden', 'tp', 'v3', 28, 'pass', 6),
  row('run_g_tp_3', 'golden', 'tp', 'v3', 28, 'fail', 2),
  row('run_g_bot_1', 'golden', 'bot', 'v1', 27, 'pass', 4),
  row('run_g_tp_2', 'golden', 'tp', 'v2', 26, 'pass', 3),
  row('run_r_tp_1', 'refunds', 'tp', 'v2', 25, 'pass', 5),
  row('run_g_tp_1', 'golden', 'tp', 'v1', 24, 'fail', 4),
];

const CASES: PplRecord[] = [
  { [RUN_ID]: 'run_g_tp_3', cases: 4, passed: 3 },
  { [RUN_ID]: 'run_g_tp_2', cases: 4, passed: 4 },
];

const lookupRow = (runId: string, suite: string, agent: string, day: number): PplRecord => ({
  started: `2026-10-${day} 07:00:00`,
  [RUN_ID]: runId,
  [SUITE]: suite,
  [AGENT]: agent,
});

const filtersOf = (patch: Partial<RunsFilters>) => ({ ...EMPTY_RUNS_FILTERS, ...patch });

const contextWith = (runs: Partial<RunsFilters> = {}) =>
  testContext({ state: { ...testContext().state, runs: filtersOf(runs) } });

const answerDefault = (q: string): PplRecord[] => {
  if (q.includes('as cases')) return CASES;
  if (q.includes('dc('))
    return [
      { n: 4, [SUITE]: 'golden' },
      { n: 1, [SUITE]: 'refunds' },
    ];
  // The suite runs the Compare menu reads when it opens: golden only.
  if (q === buildSuiteRunsQuery(TEST_INDEX, 'golden'))
    return RUNS.filter((r) => r[SUITE] === 'golden');
  if (q.includes('as started by')) return RUNS;
  return [];
};

const rowIds = () =>
  Array.from(
    screen.getByTestId('agtEvlRunsTable').querySelectorAll('[data-test-subj^="agtEvlRunsRow-"]')
  ).map((r) => r.getAttribute('data-test-subj'));

describe('RunsView', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockPpl.answer(answerDefault);
  });

  it('runs the runs and cases queries, bounded by the range, and nothing else', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([
        buildEvalRunsQuery(TEST_INDEX, EMPTY_RUNS_FILTERS),
        buildEvalRunCasesQuery(TEST_INDEX, EMPTY_RUNS_FILTERS),
      ])
    );
    expect(mockPpl.ranges.get(buildEvalRunsQuery(TEST_INDEX, EMPTY_RUNS_FILTERS))).toEqual(
      ctx.timeRange
    );
  });

  it('lists one row per run, newest first, with suite, agent, version, cases and pass rate', () => {
    renderWithContext(<RunsView />, contextWith());
    expect(rowIds()).toEqual([
      'agtEvlRunsRow-run_g_tp_3',
      'agtEvlRunsRow-run_g_bot_1',
      'agtEvlRunsRow-run_g_tp_2',
      'agtEvlRunsRow-run_r_tp_1',
      'agtEvlRunsRow-run_g_tp_1',
    ]);
    const r = screen.getByTestId('agtEvlRunsRow-run_g_tp_3');
    expect(r).toHaveTextContent('golden');
    expect(r).toHaveTextContent('tp');
    expect(r).toHaveTextContent('v3');
    expect(within(r).getByTestId('agtEvlRunsCases-run_g_tp_3')).toHaveTextContent('3 / 4');
    // 6 passed, 2 failed results.
    expect(r).toHaveTextContent('75%');
    expect(screen.getByText('Eval runs')).toBeInTheDocument();
  });

  it('links a run to its page and a suite to its page', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    fireEvent.click(screen.getByTestId('agtEvlRunsRunLink-run_g_tp_3'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'run', runId: 'run_g_tp_3' });
    fireEvent.click(within(screen.getByTestId('agtEvlRunsRow-run_r_tp_1')).getByText('refunds'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'suite', suite: 'refunds' });
  });

  it('filters by suite from the menu (its values from a runs count) into the app state', () => {
    const ctx = contextWith({ agents: ['tp'] });
    renderWithContext(<RunsView />, ctx);
    fireEvent.click(screen.getByTestId('agtEvlFacet-runs-suites'));
    expect(mockPpl.queries).toContain(
      buildRunsFacetQuery(TEST_INDEX, filtersOf({ agents: ['tp'] }), 'suites')
    );
    fireEvent.click(within(screen.getByTestId('agtEvlFacetList-runs-suites')).getByText('golden'));
    expect(ctx.setState).toHaveBeenCalledWith({
      runs: { agents: ['tp'], suites: ['golden'], q: '' },
    });
  });

  it('pushes the stored filters into the queries', () => {
    const filters = filtersOf({ agents: ['tp'], suites: ['golden'], q: 'run_g' });
    renderWithContext(<RunsView />, contextWith(filters));
    expect(mockPpl.queries).toContain(buildEvalRunsQuery(TEST_INDEX, filters));
    expect(mockPpl.queries).toContain(buildEvalRunCasesQuery(TEST_INDEX, filters));
    expect(screen.getByTestId('agtEvlRunsSearch')).toHaveValue('run_g');
  });

  it('stores the search on blur', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    const search = screen.getByTestId('agtEvlRunsSearch');
    fireEvent.change(search, { target: { value: 'refunds' } });
    fireEvent.blur(search);
    expect(ctx.setState).toHaveBeenCalledWith({
      runs: { agents: [], suites: [], q: 'refunds' },
    });
  });

  it('Compare lists only the other runs of the same suite and agent, newest first', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    // Unfiltered: compatibility comes from the table's own rows, no lookup.
    expect(mockPpl.queries).not.toContain(buildRunsLookupQuery(TEST_INDEX));
    fireEvent.click(screen.getByTestId('agtEvlRunsCompare-run_g_tp_2'));
    expect(mockPpl.queries).toContain(buildSuiteRunsQuery(TEST_INDEX, 'golden'));
    const list = screen.getByTestId('agtEvlRunsCompare-run_g_tp_2List');
    const options = within(list)
      .getAllByRole('option')
      .map((o) => o.getAttribute('data-test-subj'));
    // Not itself, not golden by bot, not refunds by tp.
    expect(options).toEqual(['agtEvlRunOption-run_g_tp_3', 'agtEvlRunOption-run_g_tp_1']);
    // The row does not open the run when the menu is used.
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('Compare goes to the compare page, the older run as A', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    fireEvent.click(screen.getByTestId('agtEvlRunsCompare-run_g_tp_2'));
    const list = screen.getByTestId('agtEvlRunsCompare-run_g_tp_2List');
    fireEvent.click(within(list).getByTestId('agtEvlRunOption-run_g_tp_3'));
    expect(ctx.navigate).toHaveBeenCalledWith({
      page: 'compare',
      runA: 'run_g_tp_2',
      runB: 'run_g_tp_3',
    });
    (ctx.navigate as jest.Mock).mockClear();
    fireEvent.click(screen.getByTestId('agtEvlRunsCompare-run_g_tp_2'));
    fireEvent.click(
      within(screen.getByTestId('agtEvlRunsCompare-run_g_tp_2List')).getByTestId(
        'agtEvlRunOption-run_g_tp_1'
      )
    );
    expect(ctx.navigate).toHaveBeenCalledWith({
      page: 'compare',
      runA: 'run_g_tp_1',
      runB: 'run_g_tp_2',
    });
  });

  it('disables Compare without another run of the suite and agent, with a tooltip', async () => {
    renderWithContext(<RunsView />, contextWith());
    const button = screen.getByTestId('agtEvlRunsCompare-run_g_bot_1');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('agtEvlRunsCompare-run_r_tp_1')).toBeDisabled();
    expect(screen.getByTestId('agtEvlRunsCompare-run_g_tp_3')).toBeEnabled();
    // EUI opens the tooltip after a delay and a queued state change (real timers).
    fireEvent.mouseOver(button.closest('.euiToolTipAnchor') as HTMLElement);
    expect(
      await screen.findByText('No other run of this suite and agent', undefined, {
        timeout: 5000,
      })
    ).toBeInTheDocument();
  });

  it('filtered: compatible runs come from the runs lookup over the range', () => {
    mockPpl.answer((q) => {
      if (q === buildRunsLookupQuery(TEST_INDEX))
        return [
          lookupRow('run_r_tp_1', 'refunds', 'tp', 25),
          lookupRow('run_r_tp_0', 'refunds', 'tp', 20),
          lookupRow('run_g_bot_1', 'golden', 'bot', 27),
        ];
      if (q.includes('as cases')) return [];
      // The table shows the filtered runs: refunds, and golden by bot.
      if (q.includes('as started by'))
        return RUNS.filter((r) => r[RUN_ID] === 'run_r_tp_1' || r[RUN_ID] === 'run_g_bot_1');
      return [];
    });
    const ctx = contextWith({ q: 'run_' });
    renderWithContext(<RunsView />, ctx);
    expect(mockPpl.queries).toContain(buildRunsLookupQuery(TEST_INDEX));
    expect(mockPpl.ranges.get(buildRunsLookupQuery(TEST_INDEX))).toEqual(ctx.timeRange);
    // refunds by tp has an older run outside the filtered table; golden by bot has none.
    expect(screen.getByTestId('agtEvlRunsCompare-run_r_tp_1')).toBeEnabled();
    expect(screen.getByTestId('agtEvlRunsCompare-run_g_bot_1')).toBeDisabled();
  });

  it('empty range: says when runs appear, with the docs', () => {
    mockPpl.answer(() => []);
    renderWithContext(<RunsView />, contextWith());
    const empty = screen.getByTestId('agtEvlRunsEmpty');
    expect(empty).toHaveTextContent('No eval runs in this time range');
    expect(empty).toHaveTextContent('Runs appear when you run a test suite with evaluate()');
    expect(within(empty).getByTestId('agtEvlRunsQuickstart')).toHaveAttribute('href');
    expect(within(empty).getByTestId('agtEvlRunsSuiteInCi')).toHaveAttribute('href');
    expect(screen.queryByTestId('agtEvlEmptyClearFilters')).not.toBeInTheDocument();
  });

  it('empty with filters: offers to clear them', () => {
    mockPpl.answer(() => []);
    const ctx = contextWith({ suites: ['golden'] });
    renderWithContext(<RunsView />, ctx);
    expect(screen.getByTestId('agtEvlRunsEmpty')).toHaveTextContent(
      'No eval runs match these filters'
    );
    fireEvent.click(screen.getByTestId('agtEvlEmptyClearFilters'));
    expect(ctx.setState).toHaveBeenCalledWith({ runs: { agents: [], suites: [], q: '' } });
  });

  it('shows the truncation callout when the runs aggregation hits its cap', () => {
    mockPpl.answer((q) =>
      q.includes('as started by')
        ? Array.from({ length: 10000 }, (_, i) =>
            row(`run_${i}`, 'golden', 'tp', 'v1', 20, 'pass', 1)
          )
        : []
    );
    renderWithContext(<RunsView />, contextWith());
    expect(screen.getByTestId('agtEvlTruncated')).toBeInTheDocument();
    // Cut off: compatible runs come from the lookup.
    expect(mockPpl.queries).toContain(buildRunsLookupQuery(TEST_INDEX));
  });
});
