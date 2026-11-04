/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import { Dataset, TimeRange } from '../../../../data/common';
import { EvalResult } from './eval_model';
import { EvalAppState, EvalRoute } from './eval_routes';
import { evalsDataset, spansDataset } from './use_ppl_rows';

/** What every screen reads: the datasets, the time range, Refresh, and navigation. */
export interface EvalScreenContext {
  dataset: Dataset;
  spans: Dataset;
  index: string;
  /** Absolute ISO bounds of the global range, resolved again on Refresh. */
  timeRange: TimeRange;
  rangeMs: number;
  /** The global range in words ("Last 7 days"). */
  rangeLabel: string;
  refreshKey: number;
  state: EvalAppState;
  setState: (patch: Partial<EvalAppState>) => void;
  navigate: (route: EvalRoute, patch?: Partial<EvalAppState>) => void;
  openResult: (result: EvalResult) => void;
  openTrace: (traceId: string, aroundMs: number) => void;
}

const noop = () => undefined;

export const defaultEvalContext = (index: string, spansIndex: string): EvalScreenContext => ({
  dataset: evalsDataset(index),
  spans: spansDataset(spansIndex),
  index,
  timeRange: { from: 'now-7d', to: 'now' },
  rangeMs: 7 * 24 * 3600e3,
  rangeLabel: 'Last 7 days',
  refreshKey: 0,
  state: {
    agentsSource: 'all',
    agentSource: 'all',
    results: { agents: [], names: [], versions: [], verdicts: [], source: 'all', q: '' },
  },
  setState: noop,
  navigate: noop,
  openResult: noop,
  openTrace: noop,
});

export const EvalContext = createContext<EvalScreenContext>(
  defaultEvalContext('otel-v1-genai-evaluation-*', 'otel-v1-apm-span-*')
);

export const useEvalContext = () => useContext(EvalContext);
