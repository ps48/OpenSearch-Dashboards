/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { RUN_LOOKBACK_MS, RUN_WINDOW_PAD_MS, breadcrumbsOf, runsOfRoute } from './evaluations_app';

describe('runsOfRoute', () => {
  it('lists the run of the run page and both runs of the compare page', () => {
    expect(runsOfRoute({ page: 'run', runId: 'r1' })).toEqual(['r1']);
    expect(runsOfRoute({ page: 'compare', runA: 'ra', runB: 'rb' })).toEqual(['ra', 'rb']);
  });

  it('lists none on the other pages (they read the global range)', () => {
    expect(runsOfRoute({ page: 'agents' })).toEqual([]);
    expect(runsOfRoute({ page: 'results' })).toEqual([]);
    expect(runsOfRoute({ page: 'runs' })).toEqual([]);
    expect(runsOfRoute({ page: 'agent', agent: 'tp', tab: 'evaluations' })).toEqual([]);
    expect(runsOfRoute({ page: 'suite', suite: 'golden' })).toEqual([]);
  });

  it('pads a run window by 15 minutes and looks 30 days back for other runs', () => {
    expect(RUN_WINDOW_PAD_MS).toBe(15 * 60e3);
    expect(RUN_LOOKBACK_MS).toBe(30 * 24 * 3600e3);
  });
});

describe('breadcrumbsOf', () => {
  const texts = (c: Array<{ text: string }>) => c.map((x) => x.text);

  it('is "Evaluations > <tab>" on every home tab, the tab itself not a link', () => {
    for (const [page, tab] of [
      ['agents', 'Agents'],
      ['runs', 'Eval runs'],
      ['results', 'Eval results'],
    ] as const) {
      const crumbs = breadcrumbsOf({ page });
      expect(texts(crumbs)).toEqual(['Evaluations', tab]);
      expect(crumbs[0].to).toEqual({ page: 'agents' });
      expect(crumbs[1].to).toBeUndefined();
    }
  });

  it('puts a screen under its tab: an agent under Agents, runs and suites under Eval runs', () => {
    expect(texts(breadcrumbsOf({ page: 'agent', agent: 'tp', tab: 'evaluations' }))).toEqual([
      'Evaluations',
      'Agents',
      'tp',
    ]);
    const suite = breadcrumbsOf({ page: 'suite', suite: 'golden' });
    expect(texts(suite)).toEqual(['Evaluations', 'Eval runs', 'golden']);
    expect(suite[1].to).toEqual({ page: 'runs' });
    expect(texts(breadcrumbsOf({ page: 'compare', runA: 'a', runB: 'b' }))).toEqual([
      'Evaluations',
      'Eval runs',
      'Compare runs',
    ]);
  });

  it('names a run by its name, else its short id', () => {
    const route = { page: 'run', runId: 'run_20261028_cccc3333dddd' } as const;
    expect(texts(breadcrumbsOf(route))[2]).toBe('Run cccc3333');
    expect(texts(breadcrumbsOf(route, 'Shorter prompt'))[2]).toBe('Shorter prompt');
  });
});
