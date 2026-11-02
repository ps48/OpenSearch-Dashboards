/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { AgentsHome } from './agents_home';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import { buildAgentsQuery } from './eval_ppl';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));

const A = 'attributes.gen_ai.agent.name';
const V = 'attributes.gen_ai.agent.version';
const row = (
  agent: string | null,
  version: string | null,
  verdict: string,
  n: number,
  day: number
) => ({
  n,
  first: `2026-10-${day} 10:00:00`,
  last: `2026-10-${day} 12:00:00`,
  [A]: agent,
  [V]: version,
  verdict,
});

describe('AgentsHome', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockPpl.answer(() => [
      row('travel_planner', 'v1', 'pass', 9, 25),
      row('travel_planner', 'v1', 'fail', 1, 25),
      row('travel_planner', 'v2', 'pass', 6, 28),
      row('travel_planner', 'v2', 'fail', 4, 28),
      row(null, null, 'pass', 3, 27),
    ]);
  });

  it('runs one aggregation and lists agents with the latest version against the previous', () => {
    renderWithContext(<AgentsHome />);
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildAgentsQuery(TEST_INDEX, 'all', '')]));
    const tp = screen.getByTestId('agtEvlAgentRow-travel_planner');
    expect(within(tp).getByText('v2')).toBeInTheDocument();
    expect(within(tp).getByText('60%')).toBeInTheDocument();
    expect(within(tp).getByText('-30 pts')).toBeInTheDocument();
    expect(within(tp).getByText('vs v1')).toBeInTheDocument();
    expect(within(tp).getByText('20')).toBeInTheDocument();
    expect(screen.getByText('(no agent name)')).toBeInTheDocument();
  });

  it('opens an agent on a row click', () => {
    const { ctx } = renderWithContext(<AgentsHome />);
    fireEvent.click(screen.getByTestId('agtEvlAgentRow-travel_planner'));
    expect(ctx.navigate).toHaveBeenCalledWith({
      page: 'agent',
      agent: 'travel_planner',
      tab: 'evaluations',
    });
  });

  it('pushes the source filter and the search into the query', () => {
    jest.useFakeTimers();
    const ctx = testContext({ state: { ...testContext().state, agentsSource: 'offline' } });
    renderWithContext(<AgentsHome />, ctx);
    fireEvent.change(screen.getByTestId('agtEvlAgentsSearch'), { target: { value: 'travel' } });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(mockPpl.queries).toContain(buildAgentsQuery(TEST_INDEX, 'offline', 'travel'));
    fireEvent.click(screen.getByTestId('agtEvlSource-online'));
    expect(ctx.setState).toHaveBeenCalledWith({ agentsSource: 'online' });
    jest.useRealTimers();
  });
});
