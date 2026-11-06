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
      results: {
        agents: [],
        names: ['a'],
        versions: [],
        verdicts: ['fail'],
        source: 'offline',
        q: 'x',
      },
      runs: { agents: [], suites: [], q: '' },
    });
  });

  it('reads the Eval runs tab and keeps its filters', () => {
    expect(routeOfHash('#/runs')).toEqual({ page: 'runs' });
    expect(routeOfHash('#/runs?_a=(x)')).toEqual({ page: 'runs' });
    expect(pathOfRoute({ page: 'runs' })).toBe('/runs');
    expect(hashOfRoute({ page: 'runs' }, '#/results?_g=(x)')).toBe('#/runs?_g=(x)');
    expect(
      normalizeAppState({ runs: { agents: ['tp', 1], suites: ['golden'], q: 'run_1' } }).runs
    ).toEqual({ agents: ['tp'], suites: ['golden'], q: 'run_1' });
    expect(normalizeAppState({ runs: 'bad' }).runs).toEqual({ agents: [], suites: [], q: '' });
  });

  it('keeps the version pair per agent and a valid chart slice', () => {
    const s = normalizeAppState({
      results: { versions: ['v2', 7] },
      versionPick: { tp: { b: 'v3', a: 'v2' }, bad: 'x' },
      slice: { from: 10, to: 20 },
    });
    expect(s.results.versions).toEqual(['v2']);
    expect(s.versionPick).toEqual({ tp: { b: 'v3', a: 'v2' } });
    expect(s.slice).toEqual({ from: 10, to: 20 });
    expect(normalizeAppState({ slice: { from: 20, to: 10 } }).slice).toBeUndefined();
    // Rison reads 1e400 as Infinity: not a time a Date can hold.
    expect(normalizeAppState({ slice: { from: 0, to: Infinity } }).slice).toBeUndefined();
    expect(normalizeAppState({ slice: { from: 0, to: 9e15 } }).slice).toBeUndefined();
    expect(normalizeAppState({ slice: { from: NaN, to: 1 } }).slice).toBeUndefined();
  });

  it('keeps a valid Results sort, else none', () => {
    expect(
      normalizeAppState({ resultsSort: { field: 'score', direction: 'asc' } }).resultsSort
    ).toEqual({ field: 'score', direction: 'asc' });
    expect(
      normalizeAppState({ resultsSort: { field: 'bogus', direction: 'asc' } }).resultsSort
    ).toBeUndefined();
    expect(
      normalizeAppState({ resultsSort: { field: 'time', direction: 'up' } }).resultsSort
    ).toBeUndefined();
    expect(normalizeAppState({}).resultsSort).toBeUndefined();
  });
});
