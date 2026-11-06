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
  buildRunNamesQuery,
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

  it('runs the runs, cases and run names queries, bounded by the range, and nothing else', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([
        buildEvalRunsQuery(TEST_INDEX, EMPTY_RUNS_FILTERS),
        buildEvalRunCasesQuery(TEST_INDEX, EMPTY_RUNS_FILTERS),
        buildRunNamesQuery(TEST_INDEX, [
          'run_g_tp_3',
          'run_g_bot_1',
          'run_g_tp_2',
          'run_r_tp_1',
          'run_g_tp_1',
        ]),
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
    // Offline only: the description says so and points online evaluations to Agents.
    expect(
      screen.getByText(/^Offline test runs: one row per run of a test suite/)
    ).toHaveTextContent('Online evaluations of live traffic are under Agents.');
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

  const box = (runId: string) => screen.getByTestId(`agtEvlSelectRun-${runId}`);

  it('compares two checked runs of the same suite and agent, the older run as A', () => {
    const ctx = contextWith();
    renderWithContext(<RunsView />, ctx);
    const button = screen.getByTestId('agtEvlCompareButton');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Compare 2 runs');
    // At most two runs: no select-all checkbox in the header.
    expect(screen.getAllByRole('checkbox').filter((b) => b.closest('thead'))).toHaveLength(0);
    fireEvent.click(box('run_g_tp_2'));
    // The row does not open the run when its checkbox is used.
    expect(ctx.navigate).not.toHaveBeenCalled();
    // Another suite or another agent: disabled. The same suite and agent: enabled.
    expect(box('run_r_tp_1')).toBeDisabled();
    expect(box('run_g_bot_1')).toBeDisabled();
    expect(box('run_g_tp_3')).toBeEnabled();
    expect(box('run_g_tp_1')).toBeEnabled();
    expect(button).toBeDisabled();
    fireEvent.click(box('run_g_tp_3'));
    expect(button).toBeEnabled();
    // Two picked: the other runs wait for a Clear.
    expect(box('run_g_tp_1')).toBeDisabled();
    fireEvent.click(button);
    expect(ctx.navigate).toHaveBeenCalledWith({
      page: 'compare',
      runA: 'run_g_tp_2',
      runB: 'run_g_tp_3',
    });
  });

  it('Clear resets the selection', () => {
    renderWithContext(<RunsView />, contextWith());
    expect(screen.queryByTestId('agtEvlCompareClear')).not.toBeInTheDocument();
    fireEvent.click(box('run_g_bot_1'));
    expect(box('run_g_tp_3')).toBeDisabled();
    fireEvent.click(screen.getByTestId('agtEvlCompareClear'));
    expect(box('run_g_bot_1')).not.toBeChecked();
    expect(box('run_g_tp_3')).toBeEnabled();
    expect(screen.queryByTestId('agtEvlCompareClear')).not.toBeInTheDocument();
  });

  it('explains a disabled checkbox in a tooltip', async () => {
    renderWithContext(<RunsView />, contextWith());
    fireEvent.click(box('run_g_tp_2'));
    // EUI opens the tooltip after a delay and a queued state change (real timers).
    fireEvent.mouseOver(box('run_r_tp_1').closest('.euiToolTipAnchor') as HTMLElement);
    expect(
      await screen.findByText('Compare runs of the same test suite and agent', undefined, {
        timeout: 5000,
      })
    ).toBeInTheDocument();
  });

  it('shows a run name (the short id under it) and falls back to the short id', () => {
    mockPpl.answer((q) =>
      q.includes('dedup')
        ? [
            {
              attributes: {
                test: { suite: { run: { id: 'run_g_tp_3' } } },
                opensearch: {
                  test: { suite: { run: { name: 'Shorter prompt', description: 'Trimmed' } } },
                },
              },
            },
          ]
        : answerDefault(q)
    );
    renderWithContext(<RunsView />, contextWith());
    expect(screen.getByTestId('agtEvlRunsRunLink-run_g_tp_3')).toHaveTextContent('Shorter prompt');
    expect(screen.getByTestId('agtEvlRunsRow-run_g_tp_3')).toHaveTextContent('3');
    expect(screen.getByTestId('agtEvlRunsRunLink-run_g_tp_2')).toHaveTextContent('2');
    expect(screen.getByTestId('agtEvlRunsRunLink-run_g_tp_2')).not.toHaveTextContent('Shorter');
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
  });
});
