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
const evalRow = (name: string, version: string, verdict: string, n: number, day: number) => ({
  n,
  first: `2026-10-${day} 10:00:00`,
  last: `2026-10-${day} 11:00:00`,
  [N]: name,
  [V]: version,
  verdict,
});

describe('AgentPage', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockChart.mockClear();
    mockPpl.answer((q) => {
      if (q.includes('span(`@timestamp`'))
        return [
          { n: 3, t: '2026-10-28 03:00:00', verdict: 'pass' },
          { n: 1, t: '2026-10-28 03:00:00', verdict: 'fail' },
        ];
      if (q.includes('stats count() as n, min(`@timestamp`) as first'))
        return [
          evalRow('accuracy', 'v1', 'pass', 9, 25),
          evalRow('accuracy', 'v1', 'fail', 1, 25),
          evalRow('accuracy', 'v2', 'pass', 5, 28),
          evalRow('accuracy', 'v2', 'fail', 5, 28),
          evalRow('helpfulness', 'v2', 'scored', 4, 28),
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

  it('Evaluations tab: the table and trend queries only, version against version', () => {
    renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    expect(new Set(mockPpl.queries)).toEqual(
      new Set([
        buildAgentEvaluationsQuery(TEST_INDEX, 'tp', 'all'),
        // The default context range is 7 days: 3 h buckets.
        buildAgentTrendQuery(TEST_INDEX, 'tp', 'all', '3h'),
      ])
    );
    const acc = screen.getByTestId('agtEvlEvalRow-accuracy');
    expect(within(acc).getByText('50%')).toBeInTheDocument();
    expect(within(acc).getByText('90%')).toBeInTheDocument();
    expect(within(acc).getByText('-40 pts')).toBeInTheDocument();
    expect(screen.getAllByText('Pass rate · v2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pass rate · v1').length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('agtEvlEvalRow-helpfulness')).getByTestId('agtEvlNoPassRule')
    ).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlAgentMeta')).toHaveTextContent('Latest version');
    const props = mockChart.mock.calls[0][0] as { points: unknown[]; markers: unknown[] };
    expect(props.points).toEqual([{ t: Date.UTC(2026, 9, 28, 3), rate: 0.75 }]);
    expect(props.markers).toEqual([{ t: Date.UTC(2026, 9, 28, 10), label: 'v2' }]);
  });

  it('an evaluation row opens the Results tab filtered by it', () => {
    const { ctx } = renderWithContext(<AgentPage agent="tp" tab="evaluations" />);
    fireEvent.click(screen.getByTestId('agtEvlEvalRow-accuracy'));
    expect(ctx.navigate).toHaveBeenCalledWith(
      { page: 'agent', agent: 'tp', tab: 'results' },
      { results: { ...ctx.state.results, names: ['accuracy'] } }
    );
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
