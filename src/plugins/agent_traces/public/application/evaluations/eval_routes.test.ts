/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  hashWithRoute,
  legacyRouteOf,
  pathOfRoute,
  routeOfHash,
  stateForRoute,
} from './eval_routes';
import { DEFAULT_APP_STATE } from './eval_url_state';

describe('eval routes', () => {
  it('reads the page from the hash path', () => {
    expect(routeOfHash('')).toEqual({ page: 'tabs' });
    expect(routeOfHash('#/?_a=(tab:runs)')).toEqual({ page: 'tabs' });
    expect(routeOfHash('#/runs/run_20261030_001343_34d64814?_g=()')).toEqual({
      page: 'run',
      runId: 'run_20261030_001343_34d64814',
    });
    expect(routeOfHash('#/runs/a%2Fb')).toEqual({ page: 'run', runId: 'a/b' });
    expect(routeOfHash('#/compare?_a=(compare:!(a,b))')).toEqual({ page: 'compare' });
    expect(routeOfHash('#/elsewhere')).toEqual({ page: 'tabs' });
  });

  it('builds the path of a page, keeping the hash query', () => {
    expect(pathOfRoute({ page: 'run', runId: 'a/b' })).toBe('/runs/a%2Fb');
    expect(hashWithRoute('#/?_g=(x)&_a=(y)', { page: 'run', runId: 'r1' })).toBe(
      '#/runs/r1?_g=(x)&_a=(y)'
    );
    expect(hashWithRoute('#/runs/r1?_g=(x)', { page: 'tabs' })).toBe('#/?_g=(x)');
    expect(hashWithRoute('', { page: 'compare' })).toBe('#/compare');
  });

  it('sends the old run and compare links to their pages', () => {
    const tabs = { page: 'tabs' as const };
    expect(legacyRouteOf(tabs, { ...DEFAULT_APP_STATE, tab: 'runs', run: 'r1' })).toEqual({
      page: 'run',
      runId: 'r1',
    });
    expect(legacyRouteOf(tabs, { ...DEFAULT_APP_STATE, tab: 'runs', compare: ['a', 'b'] })).toEqual(
      { page: 'compare' }
    );
    expect(legacyRouteOf(tabs, DEFAULT_APP_STATE)).toBeUndefined();
    expect(legacyRouteOf({ page: 'run', runId: 'r1' }, { ...DEFAULT_APP_STATE, run: 'r1' })).toBe(
      undefined
    );
  });

  it('keeps no run or comparison in the state of the tabs', () => {
    const state = { ...DEFAULT_APP_STATE, run: 'r1', compare: ['a', 'b'], baseline: 'b' };
    expect(stateForRoute({ page: 'tabs' }, state)).toEqual(DEFAULT_APP_STATE);
    expect(stateForRoute({ page: 'run', runId: 'r1' }, state)).toEqual({
      ...DEFAULT_APP_STATE,
      tab: 'runs',
    });
    expect(stateForRoute({ page: 'compare' }, state)).toMatchObject({
      compare: ['a', 'b'],
      baseline: 'b',
      run: undefined,
    });
  });
});
