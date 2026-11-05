/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EMPTY_RESULTS_FILTERS,
  EMPTY_RUNS_FILTERS,
  EvalSource,
  ResultsFilters,
  RunsFilters,
} from './eval_ppl';

/**
 * Screens of the Agent Evaluations app, by the path of the URL hash:
 *
 * - the home's tabs: `#/agents` Agents (the default), `#/runs` Eval runs (every suite run) and
 *   `#/results` Eval results (results across agents);
 * - `#/agents/<agent>?tab=evaluations|suites|results`: one agent;
 * - `#/suites/<suite>`: a suite's runs; `#/runs/<run id>`: one run's cases;
 * - `#/compare/<run A>/<run B>`: two runs, A the baseline.
 *
 * Filters live in `_a` and the time range in `_g`, next to `tab` in the hash query.
 */

export type AgentTab = 'evaluations' | 'suites' | 'results';
export const AGENT_TABS: AgentTab[] = ['evaluations', 'suites', 'results'];

export type EvalRoute =
  | { page: 'agents' }
  | { page: 'runs' }
  | { page: 'results' }
  | { page: 'agent'; agent: string; tab: AgentTab }
  | { page: 'suite'; suite: string }
  | { page: 'run'; runId: string }
  | { page: 'compare'; runA: string; runB: string };

export const AGENTS_ROUTE: EvalRoute = { page: 'agents' };

/** The home's tabs, in their order. */
export type HomePage = 'agents' | 'runs' | 'results';
export const HOME_PAGES: HomePage[] = ['agents', 'runs', 'results'];

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const splitHash = (hash: string) => {
  const raw = hash.replace(/^#/, '');
  const at = raw.indexOf('?');
  return at < 0 ? { path: raw, query: '' } : { path: raw.slice(0, at), query: raw.slice(at + 1) };
};

export const routeOfHash = (hash: string): EvalRoute => {
  const { path, query } = splitHash(hash);
  const parts = path.split('/').filter(Boolean).map(decode);
  const tab = new URLSearchParams(query).get('tab') as AgentTab | null;
  if (parts[0] === 'agents' && parts[1])
    return {
      page: 'agent',
      agent: parts[1],
      tab: tab && AGENT_TABS.includes(tab) ? tab : 'evaluations',
    };
  if (parts[0] === 'results') return { page: 'results' };
  if (parts[0] === 'suites' && parts[1]) return { page: 'suite', suite: parts[1] };
  if (parts[0] === 'runs' && parts[1]) return { page: 'run', runId: parts[1] };
  if (parts[0] === 'runs') return { page: 'runs' };
  if (parts[0] === 'compare' && parts[1] && parts[2])
    return { page: 'compare', runA: parts[1], runB: parts[2] };
  return AGENTS_ROUTE;
};

export const pathOfRoute = (route: EvalRoute): string => {
  const e = encodeURIComponent;
  switch (route.page) {
    case 'agent':
      return `/agents/${e(route.agent)}`;
    case 'runs':
      return '/runs';
    case 'results':
      return '/results';
    case 'suite':
      return `/suites/${e(route.suite)}`;
    case 'run':
      return `/runs/${e(route.runId)}`;
    case 'compare':
      return `/compare/${e(route.runA)}/${e(route.runB)}`;
    default:
      return '/agents';
  }
};

/** The hash of a route, keeping the hash query's other parameters (`_g`, `_a`). */
export const hashOfRoute = (route: EvalRoute, currentHash = ''): string => {
  // The other parameters are kept as written (rison is not re-encoded).
  const kept = splitHash(currentHash)
    .query.split('&')
    .filter((p) => p && !p.startsWith('tab='));
  const tab = route.page === 'agent' && route.tab !== 'evaluations' ? [`tab=${route.tab}`] : [];
  const query = [...tab, ...kept].join('&');
  return `#${pathOfRoute(route)}${query ? `?${query}` : ''}`;
};

// ---------------------------------------------------------------------- `_a`

export const APP_STATE_KEY = '_a';

export interface EvalAppState {
  /** Agents home: All / Online / Offline. */
  agentsSource: EvalSource;
  /** Agent page, Evaluations tab: All / Online / Offline. */
  agentSource: EvalSource;
  /** Results view filters (the agent page locks the agent itself). */
  results: Omit<ResultsFilters, 'lockAgent'>;
  /** Eval runs tab filters. */
  runs: RunsFilters;
  /** Agent page: the two versions compared (B against A), remembered per agent. */
  versionPick?: Record<string, VersionPick>;
  /** A chart point's time bucket (epoch ms): the Results view reads only this slice. */
  slice?: TimeSlice;
}

export interface VersionPick {
  b?: string;
  a?: string;
}

export interface TimeSlice {
  from: number;
  to: number;
}

export const DEFAULT_APP_STATE: EvalAppState = {
  agentsSource: 'all',
  agentSource: 'all',
  results: EMPTY_RESULTS_FILTERS,
  runs: EMPTY_RUNS_FILTERS,
};

const SOURCES: EvalSource[] = ['all', 'online', 'offline'];
const source = (v: unknown): EvalSource =>
  SOURCES.includes(v as EvalSource) ? (v as EvalSource) : 'all';
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
const optString = (v: unknown) => (typeof v === 'string' ? v : undefined);

const versionPicks = (v: unknown): Record<string, VersionPick> | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, VersionPick> = {};
  Object.entries(v as Record<string, unknown>).forEach(([agent, pick]) => {
    if (!pick || typeof pick !== 'object') return;
    const p = pick as Record<string, unknown>;
    out[agent] = { b: optString(p.b), a: optString(p.a) };
  });
  return Object.keys(out).length ? out : undefined;
};

/** A time a Date can hold (rison reads `1e400` as Infinity, which toISOString rejects). */
const MAX_DATE_MS = 8.64e15;
const isDateMs = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_DATE_MS;

const timeSlice = (v: unknown): TimeSlice | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const { from, to } = v as Record<string, unknown>;
  return isDateMs(from) && isDateMs(to) && to > from ? { from, to } : undefined;
};

export const normalizeAppState = (raw: unknown): EvalAppState => {
  if (!raw || typeof raw !== 'object') return DEFAULT_APP_STATE;
  const r = raw as Record<string, unknown>;
  const res = (r.results && typeof r.results === 'object' ? r.results : {}) as Record<
    string,
    unknown
  >;
  const runs = (r.runs && typeof r.runs === 'object' ? r.runs : {}) as Record<string, unknown>;
  return {
    agentsSource: source(r.agentsSource),
    agentSource: source(r.agentSource),
    results: {
      agents: strings(res.agents),
      names: strings(res.names),
      versions: strings(res.versions),
      verdicts: strings(res.verdicts),
      source: source(res.source),
      q: typeof res.q === 'string' ? res.q : '',
    },
    runs: {
      agents: strings(runs.agents),
      suites: strings(runs.suites),
      q: typeof runs.q === 'string' ? runs.q : '',
    },
    versionPick: versionPicks(r.versionPick),
    slice: timeSlice(r.slice),
  };
};
