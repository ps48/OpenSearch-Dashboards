/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { RUN_LOOKBACK_MS, RUN_WINDOW_PAD_MS, runsOfRoute } from './evaluations_app';

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
