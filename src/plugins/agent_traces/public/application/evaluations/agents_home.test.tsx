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

  it('runs one aggregation and lists one row per agent version, most recent first', () => {
    renderWithContext(<AgentsHome />);
    expect(new Set(mockPpl.queries)).toEqual(new Set([buildAgentsQuery(TEST_INDEX, 'all', '')]));
    const ids = screen
      .getAllByTestId(/^agtEvlAgentRow-/)
      .map((r) => r.getAttribute('data-test-subj'));
    expect(ids).toEqual([
      'agtEvlAgentRow-travel_planner/v2',
      `agtEvlAgentRow-${NO_AGENT}/`,
      'agtEvlAgentRow-travel_planner/v1',
      'agtEvlAgentRow-travel_planner/v4',
      'agtEvlAgentRow-travel_planner/v3',
      'agtEvlAgentRow-travel_planner/v0',
    ]);
    const v2 = screen.getByTestId('agtEvlVersionRate-travel_planner/v2');
    expect(v2).toHaveTextContent('60%');
    // Under 30 results with a pass rule: faded.
    expect(v2).toHaveClass('agtEvlLowN');
    const v1 = screen.getByTestId('agtEvlVersionRate-travel_planner/v1');
    expect(v1).toHaveTextContent('95%');
    expect(v1).not.toHaveClass('agtEvlLowN');
    const v1Row = screen.getByTestId('agtEvlAgentRow-travel_planner/v1');
    expect(within(v1Row).getByText('travel_planner')).toBeInTheDocument();
    expect(within(v1Row).getByText('v1')).toBeInTheDocument();
    expect(within(v1Row).getByText('80')).toBeInTheDocument();
    // No agent name and no version.
    const none = screen.getByTestId(`agtEvlAgentRow-${NO_AGENT}/`);
    expect(within(none).getByText('(no agent name)')).toBeInTheDocument();
    expect(within(none).getByText('(no version)')).toBeInTheDocument();
    expect(within(none).getByText('100%')).toBeInTheDocument();
  });

  it('titles the panel with the row count and a description, no footnote', () => {
    renderWithContext(<AgentsHome />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Agents (6)');
    expect(screen.getByText(/One row per agent version with evaluation results/)).toBeTruthy();
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });

  it('marks a version with results in the last 6 hours in its Version badge', () => {
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
    const live = screen.getByTestId('agtEvlAgentRow-tp/v5');
    const dot = within(live).getByTestId('agtEvlLiveDot');
    expect(dot.closest('.euiBadge')).toHaveTextContent('v5');
    expect(
      within(screen.getByTestId('agtEvlAgentRow-tp/v4')).queryByTestId('agtEvlLiveDot')
    ).not.toBeInTheDocument();
  });

  it('shows the SDK snippet and links when the range has no results', () => {
    mockPpl.answer(() => []);
    renderWithContext(<AgentsHome />);
    const empty = screen.getByTestId('agtEvlAgentsEmpty');
    expect(empty).toHaveTextContent('No evaluation results in the range: Last 7 days');
    expect(empty).toHaveTextContent('pip install opensearch-genai-observability-sdk-py');
    expect(screen.getByTestId('agtEvlQuickstart')).toHaveTextContent('Quickstart');
    expect(screen.getByTestId('agtEvlSuiteInCi')).toHaveTextContent('Run a suite in CI');
    // The AgentCore import link is gone.
    expect(screen.queryByTestId('agtEvlImportAgentCore')).not.toBeInTheDocument();
  });

  it('opens the agent with the clicked version on a row click', () => {
    const { ctx } = renderWithContext(<AgentsHome />);
    fireEvent.click(screen.getByTestId('agtEvlAgentRow-travel_planner/v1'));
    expect(ctx.navigate).toHaveBeenCalledWith(
      { page: 'agent', agent: 'travel_planner', tab: 'evaluations' },
      { versionPick: { travel_planner: { b: 'v1' } } }
    );
  });

  it('opens an agent without a version with an empty version key', () => {
    const { ctx } = renderWithContext(<AgentsHome />);
    fireEvent.click(screen.getByTestId(`agtEvlAgentRow-${NO_AGENT}/`));
    expect(ctx.navigate).toHaveBeenCalledWith(
      { page: 'agent', agent: NO_AGENT, tab: 'evaluations' },
      { versionPick: { [NO_AGENT]: { b: '' } } }
    );
  });

  it('pushes the source filter and the search into the query', () => {
    jest.useFakeTimers();
    const ctx = testContext({ state: { ...testContext().state, agentsSource: 'offline' } });
    renderWithContext(<AgentsHome />, ctx);
    fireEvent.change(screen.getByTestId('agtEvlAgentsSearch'), { target: { value: 'travel' } });
    // Debounced: not before a pause in typing.
    expect(mockPpl.queries).not.toContain(buildAgentsQuery(TEST_INDEX, 'offline', 'travel'));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(mockPpl.queries).toContain(buildAgentsQuery(TEST_INDEX, 'offline', 'travel'));
    // The source filter is a button group: the option test id is on the label and its radio.
    const radio = (s: string) =>
      screen
        .getAllByTestId(`agtEvlSource-${s}`)
        .find((el) => el.tagName === 'INPUT') as HTMLElement;
    expect(radio('offline')).toBeChecked();
    expect(radio('online')).not.toBeChecked();
    fireEvent.click(radio('online'));
    expect(ctx.setState).toHaveBeenCalledWith({ agentsSource: 'online' });
    jest.useRealTimers();
  });
});
