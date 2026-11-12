/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import { Dataset, TimeRange } from '../../../../data/common';
import { EvalResult } from './eval_model';
import { EvalAppState, EvalRoute } from './eval_routes';
import { evalsDataset, spansDataset } from './use_ppl_rows';
import type { DataSourceRef } from './eval_dataset';

/** What every screen reads: the datasets, the time range, Refresh, and navigation. */
export interface EvalScreenContext {
  dataset: Dataset;
  spans: Dataset;
  index: string;
  /**
   * Absolute ISO bounds the screen reads, resolved again on Refresh: the global range, or on
   * the run and compare pages the runs' own window.
   */
  timeRange: TimeRange;
  /**
   * Where to look for other runs (the run before, Compare with): the global range, reaching
   * back to the run's window. Equal to `timeRange` outside the run and compare pages.
   */
  browseRange: TimeRange;
  rangeMs: number;
  /** The global range in words ("Last 7 days"). */
  rangeLabel: string;
  refreshKey: number;
  /** The zone times show in (`dateFormat:tz`): a change re-renders the screens. */
  timezone?: string;
  state: EvalAppState;
  setState: (patch: Partial<EvalAppState>) => void;
  navigate: (route: EvalRoute, patch?: Partial<EvalAppState>) => void;
  openResult: (result: EvalResult) => void;
  openTrace: (traceId: string, aroundMs: number) => void;
  /** A URL to the session, trace or span a result judged (opened in a new tab). */
  hrefOf?: (result: EvalResult) => string | undefined;
  /** Open Settings / Getting started (the data issue empty states link to them). */
  openSettings?: () => void;
  openGettingStarted?: () => void;
}

const noop = () => undefined;

export const defaultEvalContext = (
  index: string,
  spansIndex: string,
  dataSource?: DataSourceRef
): EvalScreenContext => ({
  dataset: evalsDataset(index, dataSource),
  spans: spansDataset(spansIndex, dataSource),
  index,
  timeRange: { from: 'now-7d', to: 'now' },
  browseRange: { from: 'now-7d', to: 'now' },
  rangeMs: 7 * 24 * 3600e3,
  rangeLabel: 'Last 7 days',
  refreshKey: 0,
  state: {
    agentsSource: 'all',
    agentSource: 'all',
    results: { agents: [], names: [], versions: [], verdicts: [], source: 'all', q: '' },
    runs: { agents: [], suites: [], q: '' },
  },
  setState: noop,
  navigate: noop,
  openResult: noop,
  openTrace: noop,
});

// No index by default: the app and the Agent Traces flyouts provide the configured ones, and
// nothing reads evaluation results without a config.
export const EvalContext = createContext<EvalScreenContext>(defaultEvalContext('', ''));

export const useEvalContext = () => useContext(EvalContext);
