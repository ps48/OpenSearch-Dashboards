/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { AgentPage } from './agent_page';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import {
  EMPTY_RESULTS_FILTERS,
  buildAgentEvaluationsQuery,
  buildAgentSuitesQuery,
  buildAgentTrendQuery,
  buildResultsCountQuery,
  buildResultsPageQuery,
  DEFAULT_RESULTS_SORT,
} from './eval_ppl';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));
const mockChart = jest.fn();
jest.mock('./pass_rate_chart', () => ({
  PassRateChart: (props: unknown) => {
    mockChart(props);
    return <div data-test-subj="chart" />;
  },
}));

const N = 'attributes.gen_ai.evaluation.name';
const V = 'attributes.gen_ai.agent.version';
const DIR = 'attributes.opensearch.gen_ai.evaluation.score.direction';
const L = 'attributes.gen_ai.evaluation.score.label';
const evalRow = (
  name: string,
  version: string,
  verdict: string,
  n: number,
  day: number,
  extra: Record<string, unknown> = {}
) => ({
  n,
  first: `2026-10-${day} 10:00:00`,
  last: `2026-10-${day} 11:00:00`,
  [N]: name,
  [V]: version,
  verdict,
  ...extra,
});

describe('AgentPage', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockChart.mockClear();
    mockPpl.answer((q) => {
      if (q.includes('span(`@timestamp`'))
        return [
          { n: 3, t: '2026-10-28 03:00:00', [V]: 'v2', verdict: 'pass' },
          { n: 1, t: '2026-10-28 03:00:00', [V]: 'v2', verdict: 'fail' },
          { n: 2, t: '2026-10-25 03:00:00', [V]: 'v1', verdict: 'pass' },
        ];
      if (q.includes('avg_score'))
        return [
          evalRow('accuracy', 'v1', 'pass', 36, 25),
          evalRow('accuracy', 'v1', 'fail', 4, 25),
          evalRow('accuracy', 'v2', 'pass', 25, 28),
          evalRow('accuracy', 'v2', 'fail', 25, 28),
          evalRow('tone', 'v1', 'pass', 9, 25),
          evalRow('tone', 'v1', 'fail', 1, 25),
          evalRow('tone', 'v2', 'pass', 6, 28),
          evalRow('tone', 'v2', 'fail', 4, 28),
          evalRow('latency', 'v1', 'scored', 4, 25, { nv: 4, avg_score: 2.5, [DIR]: 'minimize' }),
          evalRow('latency', 'v2', 'scored', 6, 28, { nv: 6, avg_score: 2.0, [DIR]: 'minimize' }),
          evalRow('kind', 'v2', 'scored', 3, 28, { [L]: 'direct' }),
          evalRow('kind', 'v2', 'scored', 1, 28, { [L]: 'refusal' }),
          evalRow('kind', 'v1', 'scored', 1, 25, { [L]: 'direct' }),
          evalRow('kind', 'v1', 'scored', 1, 25, { [L]: 'refusal' }),
        ];
      if (q.includes('as started'))
        return [
          {
            n: 4,
            started: '2026-10-28 07:00:00',
            'attributes.test.suite.name': 'golden',
            'attributes.test.suite.run.id': 'r1',
            [V]: 'v2',
            verdict: 'pass',
          },
        ];
      return [];
    });
  });

  it('Evaluations tab: the table and trend queries only, B against A', () => {
    renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([
        buildAgentEvaluationsQuery(TEST_INDEX, 'tp', 'all'),
        // The default context range is 7 days: 3 h buckets.
        buildAgentTrendQuery(TEST_INDEX, 'tp', 'all', '3h'),
      ])
    );
    // Default pair: the two versions with the most recent results.
    expect(screen.getByTestId('agtEvlVersionB')).toHaveValue('v2');
    expect(screen.getByTestId('agtEvlVersionA')).toHaveValue('v1');
    const acc = screen.getByTestId('agtEvlEvalRow-accuracy');
    expect(within(acc).getByText('50%')).toBeInTheDocument();
    expect(within(acc).getByText('90%')).toBeInTheDocument();
    expect(within(acc).getByTestId('agtEvlDelta')).toHaveTextContent('-40 pts');
    expect(within(acc).getByText('n 50/40')).toBeInTheDocument();
    expect(within(acc).getByText('50')).toBeInTheDocument();
    // Fewer than 30 results with a pass rule: greyed.
    expect(
      within(screen.getByTestId('agtEvlEvalRow-tone')).getByTestId('agtEvlDeltaLow')
    ).toHaveTextContent('-30 pts');
    // No pass rule, numeric: average, lower is better.
    const latency = screen.getByTestId('agtEvlEvalRow-latency');
    expect(latency).toHaveTextContent('avg 2.00');
    expect(latency).toHaveTextContent('avg 2.50');
    expect(within(latency).getByTestId('agtEvlNoPassRule')).toHaveTextContent('Score only');
    expect(within(latency).getByTestId('agtEvlDelta')).toHaveTextContent('-0.50');
    expect(within(latency).getByTestId('agtEvlDelta')).toHaveClass('agtEvlDelta--good');
    // Categorical: the top label and its share.
    const kind = screen.getByTestId('agtEvlEvalRow-kind');
    expect(kind).toHaveTextContent('direct 75%');
    expect(within(kind).getByTestId('agtEvlNoPassRule')).toHaveTextContent('Label');
    expect(kind).toHaveTextContent('+25 pts direct');
    // Sorted by change, worst first.
    const rows = screen.getAllByTestId(/^agtEvlEvalRow-/);
    expect(rows[0]).toHaveAttribute('data-test-subj', 'agtEvlEvalRow-accuracy');
    expect(screen.getByTestId('agtEvlAgentMeta')).toHaveTextContent('Versions');
    const props = mockChart.mock.calls[0][0] as {
      series: Array<{ id: string; points: unknown[] }>;
    };
    expect(props.series.map((x) => x.id)).toEqual(['v2', 'v1']);
    expect(props.series[0].points).toEqual([{ t: Date.UTC(2026, 9, 28, 3), rate: 0.75, n: 4 }]);
  });

  it('one version: no version picker, no A and Change columns, sorted by name', () => {
    mockPpl.answer((q) =>
      q.includes('avg_score')
        ? [
            evalRow('tone', 'v2', 'pass', 6, 28),
            evalRow('tone', 'v2', 'fail', 4, 28),
            evalRow('accuracy', 'v2', 'pass', 25, 28),
            evalRow('accuracy', 'v2', 'fail', 25, 28),
          ]
        : []
    );
    renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    expect(screen.queryByTestId('agtEvlVersionB')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlVersionA')).not.toBeInTheDocument();
    const table = screen.getByTestId('agtEvlEvaluationsTable');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers.some((h) => h?.includes('Pass rate'))).toBe(true);
    expect(headers.some((h) => h?.includes('Change'))).toBe(false);
    expect(headers).toHaveLength(3);
    const acc = screen.getByTestId('agtEvlEvalRow-accuracy');
    expect(within(acc).getByText('50%')).toBeInTheDocument();
    expect(within(acc).queryByTestId('agtEvlDelta')).not.toBeInTheDocument();
    expect(screen.getByText(/^Click an evaluation to see its results\./)).toBeTruthy();
    expect(screen.queryByText(/Sorted by change/)).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId(/^agtEvlEvalRow-/).map((r) => r.getAttribute('data-test-subj'))
    ).toEqual(['agtEvlEvalRow-accuracy', 'agtEvlEvalRow-tone']);
  });

  it('remembers the version pair per agent', () => {
    const { ctx } = renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    fireEvent.change(screen.getByTestId('agtEvlVersionB'), { target: { value: 'v1' } });
    expect(ctx.setState).toHaveBeenCalledWith({ versionPick: { tp: { b: 'v1', a: undefined } } });
  });

  it('uses the remembered pair, and the B column follows it', () => {
    const picked = testContext({
      state: { ...testContext().state, versionPick: { tp: { b: 'v1', a: 'v2' } } },
    });
    renderWithContext(<AgentPage agent="tp" tab="evaluations" />, picked);
    expect(screen.getByTestId('agtEvlVersionB')).toHaveValue('v1');
    expect(screen.getByTestId('agtEvlVersionA')).toHaveValue('v2');
    expect(
      within(screen.getByTestId('agtEvlEvalRow-accuracy')).getByTestId('agtEvlDelta')
    ).toHaveTextContent('+40 pts');
  });

  it('an evaluation row opens its results for version B (no verdict filter)', () => {
    const { ctx } = renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    fireEvent.click(screen.getByTestId('agtEvlEvalRow-accuracy'));
    expect(ctx.navigate).toHaveBeenCalledWith(
      { page: 'agent', agent: 'tp', tab: 'results' },
      {
        results: {
          ...ctx.state.results,
          names: ['accuracy'],
          versions: ['v2'],
          verdicts: [],
        },
        slice: undefined,
      }
    );
    fireEvent.click(screen.getByTestId('agtEvlEvalRow-latency'));
    expect(ctx.navigate).toHaveBeenLastCalledWith(
      { page: 'agent', agent: 'tp', tab: 'results' },
      {
        results: { ...ctx.state.results, names: ['latency'], versions: ['v2'], verdicts: [] },
        slice: undefined,
      }
    );
  });

  it('a chart point opens the Results tab for that slice, every verdict', () => {
    const { ctx } = renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    const props = mockChart.mock.calls[0][0] as { onPointClick: (t: number) => void };
    const t = Date.UTC(2026, 9, 28, 3);
    props.onPointClick(t);
    expect(ctx.navigate).toHaveBeenCalledWith(
      { page: 'agent', agent: 'tp', tab: 'results' },
      {
        results: { ...ctx.state.results, names: [], versions: [], verdicts: [] },
        slice: { from: t, to: t + 3 * 3600e3 },
      }
    );
  });

  it('an evaluation with evaluator errors in B has a badge that opens them', () => {
    mockPpl.answer((q) =>
      q.includes('avg_score')
        ? [
            evalRow('accuracy', 'v1', 'pass', 36, 25),
            evalRow('accuracy', 'v2', 'pass', 30, 28),
            evalRow('accuracy', 'v2', 'error', 2, 28),
            // Errors in A only: no badge.
            evalRow('tone', 'v1', 'error', 3, 25),
            evalRow('tone', 'v2', 'pass', 3, 28),
          ]
        : []
    );
    const { ctx } = renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    expect(screen.queryByTestId('agtEvlEvalErrors-tone')).not.toBeInTheDocument();
    const badge = screen.getByTestId('agtEvlEvalErrors-accuracy');
    expect(badge).toHaveTextContent('2 errors');
    fireEvent.click(badge);
    // The badge opens the errors only, not the row's results.
    expect(ctx.navigate).toHaveBeenCalledTimes(1);
    expect(ctx.navigate).toHaveBeenCalledWith(
      { page: 'agent', agent: 'tp', tab: 'results' },
      {
        results: {
          ...ctx.state.results,
          names: ['accuracy'],
          versions: ['v2'],
          verdicts: ['error'],
        },
        slice: undefined,
      }
    );
  });

  it('offline: each version at its latest run, exact change (never greyed for n)', () => {
    const RUN = 'attributes.test.suite.run.id';
    const run = (version: string, runId: string, verdict: string, n: number, day: number) =>
      evalRow('accuracy', version, verdict, n, day, { [RUN]: runId });
    mockPpl.answer((q) =>
      q.includes('avg_score')
        ? [
            // v1: an older run at 0 / 10, its latest run at 8 / 10.
            run('v1', 'r0', 'fail', 10, 20),
            run('v1', 'r1', 'pass', 8, 25),
            run('v1', 'r1', 'fail', 2, 25),
            // v2: one run at 5 / 10.
            run('v2', 'r2', 'pass', 5, 28),
            run('v2', 'r2', 'fail', 5, 28),
          ]
        : []
    );
    const ctx = testContext({ state: { ...testContext().state, agentSource: 'offline' } });
    renderWithContext(<AgentPage agent="tp" tab="evaluations" />, ctx);
    expect(mockPpl.queries).toContain(buildAgentEvaluationsQuery(TEST_INDEX, 'tp', 'offline'));
    expect(screen.getByText(/^Offline: each version at its latest suite run\./)).toBeTruthy();
    const acc = screen.getByTestId('agtEvlEvalRow-accuracy');
    expect(within(acc).getByText('50%')).toBeInTheDocument();
    // v1 at r1 only (80%), not pooled with r0 (40%).
    expect(within(acc).getByText('80%')).toBeInTheDocument();
    // 10 results each, under 30, but a suite run is a fixed set: not greyed.
    expect(within(acc).queryByTestId('agtEvlDeltaLow')).not.toBeInTheDocument();
    expect(within(acc).getByTestId('agtEvlDelta')).toHaveTextContent('-30 pts');
  });

  it('Online/Offline is pushed into both queries', () => {
    const ctx = testContext({ state: { ...testContext().state, agentSource: 'online' } });
    renderWithContext(<AgentPage agent="tp" tab="evaluations" />, ctx);
    expect(mockPpl.queries).toContain(buildAgentEvaluationsQuery(TEST_INDEX, 'tp', 'online'));
    expect(mockPpl.queries).toContain(buildAgentTrendQuery(TEST_INDEX, 'tp', 'online', '3h'));
  });

  it('Suites tab: its own query only; a suite row opens the suite', () => {
    const { ctx } = renderWithContext(<AgentPage agent="tp" tab="suites" />);
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildAgentSuitesQuery(TEST_INDEX, 'tp')]));
    fireEvent.click(screen.getByTestId('agtEvlSuiteRow-golden'));
    expect(ctx.navigate).toHaveBeenCalledWith({ page: 'suite', suite: 'golden' });
  });

  it('Results tab: the Results view locked to the agent', () => {
    renderWithContext(<AgentPage agent="tp" tab="results" />);
    const filters = { ...EMPTY_RESULTS_FILTERS, lockAgent: 'tp' };
    expect(mockPpl.queries).toContain(
      buildResultsPageQuery(TEST_INDEX, filters, DEFAULT_RESULTS_SORT, 0)
    );
    expect(mockPpl.queries).toContain(buildResultsCountQuery(TEST_INDEX, filters));
    expect(screen.queryByTestId('agtEvlFacet-agents')).not.toBeInTheDocument();
  });
});
