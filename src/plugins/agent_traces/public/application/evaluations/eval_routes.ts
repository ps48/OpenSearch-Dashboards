/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvalAppState } from './eval_url_state';

/**
 * Pages of the Agent Evaluations app, by the path of the URL hash (`#/<path>?_g=...&_a=...`):
 *
 * - `#/`: Overview, Results and Evaluation runs (tabs, filter bar, global time picker);
 * - `#/runs/<test.suite.run.id>`: one run's page, read by its id (no tabs, no time picker);
 * - `#/compare?_a=(compare:!(...),baseline:...)`: the comparison of 2 to 5 runs (no tabs).
 */
export type EvalRoute = { page: 'tabs' } | { page: 'run'; runId: string } | { page: 'compare' };

export const TABS_ROUTE: EvalRoute = { page: 'tabs' };

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The page a URL hash opens. */
export const routeOfHash = (hash: string): EvalRoute => {
  const path = hash.replace(/^#/, '').split('?')[0] || '/';
  const run = /^\/runs\/([^/]+)\/?$/.exec(path);
  if (run) return { page: 'run', runId: decode(run[1]) };
  if (/^\/compare\/?$/.test(path)) return { page: 'compare' };
  return TABS_ROUTE;
};

export const pathOfRoute = (route: EvalRoute): string =>
  route.page === 'run'
    ? `/runs/${encodeURIComponent(route.runId)}`
    : route.page === 'compare'
      ? '/compare'
      : '/';

/** The hash of a page, keeping the hash query (`_g`, `_a`) as it is. */
export const hashWithRoute = (hash: string, route: EvalRoute): string => {
  const query = hash.replace(/^#/, '').split('?').slice(1).join('?');
  return `#${pathOfRoute(route)}${query ? `?${query}` : ''}`;
};

/**
 * The app state a page is opened with: a run's page carries the run in its path, the tabs
 * carry no run or comparison (else the old-link redirect would open them again), and the
 * comparison keeps its runs in `_a`.
 */
export const stateForRoute = (route: EvalRoute, state: EvalAppState): EvalAppState => {
  if (route.page === 'compare') return { ...state, run: undefined };
  const { run, compare, baseline, ...rest } = state;
  return { ...rest, ...(route.page === 'run' ? { tab: 'runs' as const } : {}) };
};

/**
 * Links from before the run and compare pages, `#/?_a=(tab:runs,run:'<id>')` (CI jobs and the
 * GitHub Action build them) and `#/?_a=(tab:runs,compare:!(...))`: the page they open now.
 */
export const legacyRouteOf = (route: EvalRoute, state: EvalAppState): EvalRoute | undefined => {
  if (route.page !== 'tabs') return undefined;
  if (state.compare) return { page: 'compare' };
  if (state.run) return { page: 'run', runId: state.run };
  return undefined;
};
