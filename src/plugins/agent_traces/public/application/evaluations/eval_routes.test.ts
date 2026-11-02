/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { hashOfRoute, normalizeAppState, pathOfRoute, routeOfHash } from './eval_routes';

describe('evaluation routes', () => {
  it('reads every screen from the hash', () => {
    expect(routeOfHash('')).toEqual({ page: 'agents' });
    expect(routeOfHash('#/agents?_g=(x)')).toEqual({ page: 'agents' });
    expect(routeOfHash('#/results')).toEqual({ page: 'results' });
    expect(routeOfHash('#/agents/travel%20planner')).toEqual({
      page: 'agent',
      agent: 'travel planner',
      tab: 'evaluations',
    });
    expect(routeOfHash('#/agents/tp?tab=suites&_g=(x)')).toEqual({
      page: 'agent',
      agent: 'tp',
      tab: 'suites',
    });
    expect(routeOfHash('#/agents/tp?tab=bogus').page).toBe('agent');
    expect(routeOfHash('#/suites/golden')).toEqual({ page: 'suite', suite: 'golden' });
    expect(routeOfHash('#/runs/run_1')).toEqual({ page: 'run', runId: 'run_1' });
    expect(routeOfHash('#/compare/a/b')).toEqual({ page: 'compare', runA: 'a', runB: 'b' });
    expect(routeOfHash('#/compare/a')).toEqual({ page: 'agents' });
  });

  it('writes paths and keeps `_g` and `_a` while replacing the tab', () => {
    expect(pathOfRoute({ page: 'suite', suite: 'a/b' })).toBe('/suites/a%2Fb');
    expect(
      hashOfRoute(
        { page: 'agent', agent: 'tp', tab: 'results' },
        '#/agents/tp?tab=suites&_g=(time:(from:now-7d,to:now))&_a=(agentSource:all)'
      )
    ).toBe('#/agents/tp?tab=results&_g=(time:(from:now-7d,to:now))&_a=(agentSource:all)');
    expect(hashOfRoute({ page: 'agent', agent: 'tp', tab: 'evaluations' }, '#/x?tab=suites')).toBe(
      '#/agents/tp'
    );
    expect(hashOfRoute({ page: 'compare', runA: 'a', runB: 'b' })).toBe('#/compare/a/b');
  });

  it('normalizes the app state from the URL', () => {
    expect(normalizeAppState(undefined).results.source).toBe('all');
    expect(
      normalizeAppState({
        agentsSource: 'online',
        agentSource: 'nope',
        results: { names: ['a', 3], verdicts: ['fail'], q: 'x', source: 'offline' },
      })
    ).toEqual({
      agentsSource: 'online',
      agentSource: 'all',
      results: { agents: [], names: ['a'], verdicts: ['fail'], source: 'offline', q: 'x' },
    });
  });
});
