/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvalFilters, EvalOutcome } from './eval_data';

const OUTCOMES: EvalOutcome[] = ['pass', 'fail', 'error', 'neutral'];

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
  /** Only results with these verdicts (a chart bar's series). */
  verdicts: EvalOutcome[];
  /** Only results of these evaluation runs (`test.suite.run.id`). */
  runIds: string[];
  /** Free-text search. */
  q: string;
  /** Id of the result open in the flyout. */
  result?: string;
  /**
   * Runs compared (2 to `MAX_COMPARE_RUNS`), in column order. Links from before the grid hold
   * `[baseline, candidate]`: without `baseline`, the first run is the baseline.
   */
  compare?: string[];
  /** The compared run the others are measured against; one of `compare`. */
  baseline?: string;
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
  verdicts: [],
  runIds: [],
  q: '',
};

export const APP_STATE_KEY = '_a';

/** Runs a comparison holds at most (columns A to E). */
export const MAX_COMPARE_RUNS = 5;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

/** A valid state from whatever the URL held (missing, partial or hand-edited). */
export const normalizeAppState = (raw: unknown): EvalAppState => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APP_STATE };
  const r = raw as Record<string, unknown>;
  const tab = EVAL_TABS.includes(r.tab as EvalTab) ? (r.tab as EvalTab) : 'overview';
  const compare = Array.from(new Set(strings(r.compare))).slice(0, MAX_COMPARE_RUNS);
  const validCompare = compare.length >= 2;
  const baseline =
    validCompare && typeof r.baseline === 'string' && compare.includes(r.baseline)
      ? r.baseline
      : undefined;
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
    verdicts: strings(r.verdicts).filter((v): v is EvalOutcome =>
      OUTCOMES.includes(v as EvalOutcome)
    ),
    runIds: strings(r.runIds),
    q: typeof r.q === 'string' ? r.q : '',
    ...(typeof r.result === 'string' && r.result ? { result: r.result } : {}),
    ...(validCompare ? { compare } : {}),
    ...(baseline ? { baseline } : {}),
    ...(typeof r.run === 'string' && r.run ? { run: r.run } : {}),
    ...(validRunsTime ? { runsTime: validRunsTime } : {}),
    ...(typeof r.evaluation === 'string' && r.evaluation ? { evaluation: r.evaluation } : {}),
  };
};

/** The baseline of a comparison: `baseline` when it is one of the runs, else the first run. */
export const baselineOf = (state: Pick<EvalAppState, 'compare' | 'baseline'>) =>
  state.compare && state.baseline && state.compare.includes(state.baseline)
    ? state.baseline
    : state.compare?.[0];

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
  if (state.verdicts.length) out.verdicts = state.verdicts;
  if (state.runIds.length) out.runIds = state.runIds;
  if (state.q) out.q = state.q;
  if (state.result) out.result = state.result;
  if (state.compare) out.compare = state.compare;
  // The first run is the baseline by default: keep 2-run links as they were.
  if (state.compare && state.baseline && state.baseline !== state.compare[0]) {
    out.baseline = state.baseline;
  }
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
  ...(state.verdicts.length ? { outcomes: state.verdicts } : {}),
  ...(state.runIds.length ? { runIds: state.runIds } : {}),
});

export const hasActiveFilters = (state: EvalAppState): boolean =>
  state.names.length > 0 ||
  state.levels.length > 0 ||
  state.sources.length > 0 ||
  state.failing ||
  state.verdicts.length > 0 ||
  state.runIds.length > 0 ||
  state.q.trim() !== '';
