/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvalFilters } from './eval_data';

/**
 * Page state kept in the URL (`_a` in the hash, rison encoded, next to the global `_g` time)
 * so tabs, filters, an open result and a run comparison are shareable links.
 */

export type EvalTab = 'overview' | 'results' | 'runs';
export const EVAL_TABS: EvalTab[] = ['overview', 'results', 'runs'];

export interface EvalAppState {
  tab: EvalTab;
  names: string[];
  levels: string[];
  sources: string[];
  /** Only failing results. */
  failing: boolean;
  /** Free-text search. */
  q: string;
  /** Id of the result open in the flyout. */
  result?: string;
  /** Runs compared: [baseline, candidate]. */
  compare?: [string, string];
  /**
   * `test.suite.run.id` of the run whose page is open. External links (a CI job that ran the
   * suite) open `_a=(tab:runs,run:'<id>')`: keep this key.
   */
  run?: string;
  /** Time range of the Evaluation runs tab and the run page (their own, not the global one). */
  runsTime?: { from: string; to: string };
  /** Evaluation name whose drill-down is open (Overview). */
  evaluation?: string;
}

/** Offline runs happen a few times a day: the runs tab looks back a week by default. */
export const DEFAULT_RUNS_TIME = { from: 'now-7d', to: 'now' };

export const DEFAULT_APP_STATE: EvalAppState = {
  tab: 'overview',
  names: [],
  levels: [],
  sources: [],
  failing: false,
  q: '',
};

export const APP_STATE_KEY = '_a';

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

/** A valid state from whatever the URL held (missing, partial or hand-edited). */
export const normalizeAppState = (raw: unknown): EvalAppState => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APP_STATE };
  const r = raw as Record<string, unknown>;
  const tab = EVAL_TABS.includes(r.tab as EvalTab) ? (r.tab as EvalTab) : 'overview';
  const compare = strings(r.compare);
  const runsTime = r.runsTime as { from?: unknown; to?: unknown } | undefined;
  const validRunsTime =
    runsTime && typeof runsTime.from === 'string' && typeof runsTime.to === 'string'
      ? { from: runsTime.from, to: runsTime.to }
      : undefined;
  return {
    tab,
    names: strings(r.names),
    levels: strings(r.levels),
    sources: strings(r.sources),
    failing: r.failing === true || r.failing === 'true',
    q: typeof r.q === 'string' ? r.q : '',
    ...(typeof r.result === 'string' && r.result ? { result: r.result } : {}),
    ...(compare.length === 2 ? { compare: [compare[0], compare[1]] as [string, string] } : {}),
    ...(typeof r.run === 'string' && r.run ? { run: r.run } : {}),
    ...(validRunsTime ? { runsTime: validRunsTime } : {}),
    ...(typeof r.evaluation === 'string' && r.evaluation ? { evaluation: r.evaluation } : {}),
  };
};

/** The runs tab's time range: from the URL, else the last 7 days. */
export const runsTimeOf = (state: EvalAppState) => state.runsTime ?? DEFAULT_RUNS_TIME;

/** Only the non-default keys, to keep URLs short. */
export const compactAppState = (state: EvalAppState): Partial<EvalAppState> => {
  const out: Partial<EvalAppState> = {};
  if (state.tab !== 'overview') out.tab = state.tab;
  if (state.names.length) out.names = state.names;
  if (state.levels.length) out.levels = state.levels;
  if (state.sources.length) out.sources = state.sources;
  if (state.failing) out.failing = true;
  if (state.q) out.q = state.q;
  if (state.result) out.result = state.result;
  if (state.compare) out.compare = state.compare;
  if (state.run) out.run = state.run;
  if (
    state.runsTime &&
    (state.runsTime.from !== DEFAULT_RUNS_TIME.from || state.runsTime.to !== DEFAULT_RUNS_TIME.to)
  ) {
    out.runsTime = state.runsTime;
  }
  if (state.evaluation) out.evaluation = state.evaluation;
  return out;
};

export const filtersOf = (state: EvalAppState): EvalFilters => ({
  names: state.names,
  levels: state.levels,
  sources: state.sources,
  search: state.q,
  failingOnly: state.failing,
});

export const hasActiveFilters = (state: EvalAppState): boolean =>
  state.names.length > 0 ||
  state.levels.length > 0 ||
  state.sources.length > 0 ||
  state.failing ||
  state.q.trim() !== '';
