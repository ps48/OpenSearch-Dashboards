/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { AgentsHome } from './agents_home';
import { TEST_INDEX, fakePpl, renderWithContext, testContext } from './eval_test_utils';
import { NO_AGENT, buildAgentsQuery } from './eval_ppl';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));

const A = 'attributes.gen_ai.agent.name';
const V = 'attributes.gen_ai.agent.version';
const N = 'attributes.gen_ai.evaluation.name';
const row = (
  agent: string | null,
  version: string | null,
  verdict: string,
  n: number,
  day: number,
  name = 'acc'
) => ({
  n,
  first: `2026-10-${day} 10:00:00`,
  last: `2026-10-${day} 12:00:00`,
  [A]: agent,
  [V]: version,
  [N]: name,
  verdict,
});

describe('AgentsHome', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockPpl.answer(() => [
      // v1: acc 36/40, tone 40/40 -> 95%
      row('travel_planner', 'v1', 'pass', 36, 25),
      row('travel_planner', 'v1', 'fail', 4, 25),
      row('travel_planner', 'v1', 'pass', 40, 25, 'tone'),
      // v2: acc 6/10 -> 60%, under 30 results with a pass rule
      row('travel_planner', 'v2', 'pass', 6, 28),
      row('travel_planner', 'v2', 'fail', 4, 28),
      row('travel_planner', 'v0', 'pass', 1, 20),
      row('travel_planner', 'v3', 'pass', 1, 21),
      row('travel_planner', 'v4', 'pass', 1, 22),
      row(null, null, 'pass', 3, 27),
    ]);
  });

  it('runs one aggregation and lists a pass rate per version, most recent first', () => {
    renderWithContext(<AgentsHome />);
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildAgentsQuery(TEST_INDEX, 'all', '')]));
    const tp = screen.getByTestId('agtEvlAgentRow-travel_planner');
    const badges = within(tp).getAllByTestId(/^agtEvlVersionRate-/);
    expect(badges.map((b) => b.getAttribute('data-test-subj'))).toEqual([
      'agtEvlVersionRate-v2',
      'agtEvlVersionRate-v1',
      'agtEvlVersionRate-v4',
      'agtEvlVersionRate-v3',
    ]);
    expect(badges[0]).toHaveTextContent('v2 60%');
    expect(badges[0]).toHaveClass('agtEvlVersionBadge--low');
    expect(badges[1]).toHaveTextContent('v1 95%');
    expect(badges[1]).not.toHaveClass('agtEvlVersionBadge--low');
    expect(within(tp).getByText('+1')).toBeInTheDocument();
    expect(within(tp).getByText('93')).toBeInTheDocument();
    expect(within(tp).queryByText(/pts/)).not.toBeInTheDocument();
    expect(screen.getByText('(no agent name)')).toBeInTheDocument();
    // No version: one pass rate.
    expect(within(screen.getByTestId(`agtEvlAgentRow-${NO_AGENT}`)).getByText('100%')).toBeTruthy();
  });

  it('marks a version with results in the last 6 hours', () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
    mockPpl.answer(() => [
      {
        n: 3,
        first: iso(now - 3600e3),
        last: iso(now - 60e3),
        [A]: 'tp',
        [V]: 'v5',
        [N]: 'a',
        verdict: 'pass',
      },
      {
        n: 3,
        first: iso(now - 9e7),
        last: iso(now - 8e7),
        [A]: 'tp',
        [V]: 'v4',
        [N]: 'a',
        verdict: 'pass',
      },
    ]);
    renderWithContext(<AgentsHome />);
    expect(
      within(screen.getByTestId('agtEvlVersionRate-v5')).getByTestId('agtEvlLiveDot')
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('agtEvlVersionRate-v4')).queryByTestId('agtEvlLiveDot')
    ).not.toBeInTheDocument();
  });

  it('shows the SDK snippet and links when the range has no results', () => {
    mockPpl.answer(() => []);
    renderWithContext(<AgentsHome />);
    const empty = screen.getByTestId('agtEvlAgentsEmpty');
    expect(empty).toHaveTextContent('No evaluation results in last 7 days');
    expect(empty).toHaveTextContent('pip install opensearch-genai-observability-sdk-py');
    expect(screen.getByTestId('agtEvlQuickstart')).toHaveTextContent('Quickstart');
    expect(screen.getByTestId('agtEvlSuiteInCi')).toHaveTextContent('Run a suite in CI');
    expect(screen.getByTestId('agtEvlImportAgentCore')).toHaveTextContent(
      'Import AgentCore evaluations'
    );
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
