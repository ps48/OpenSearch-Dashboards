/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Dataset, TimeRange } from '../../../../data/common';
import { DataPublicPluginStart } from '../../../../data/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { pplResponseToRecords } from '../pages/sessions/session_utils';
import { PplRecord } from './eval_model';

/** The evaluations index as a dataset: the PPL service bounds it by `@timestamp`. */
export const evalsDataset = (index: string): Dataset => ({
  id: 'agent-evaluations',
  title: index,
  type: 'INDEXES',
  timeFieldName: '@timestamp',
});

/**
 * The evaluations index without a time bound: only for lookups filtered to a few ids (a run's
 * window), which must find the run wherever the global range is.
 */
export const evalsLookupDataset = (index: string): Dataset => ({
  id: 'agent-evaluations-lookup',
  title: index,
  type: 'INDEXES',
});

/** The span index, looked up by trace id (no time field). */
export const spansDataset = (index: string): Dataset => ({
  id: 'agent-evaluations-spans',
  title: index,
  type: 'INDEXES',
});

/** A readable message from a failed PPL request. */
export const errorMessage = (error: unknown): string => {
  if (!error) return '';
  const e = error as { body?: { message?: unknown }; message?: unknown };
  const raw = String(e.body?.message ?? e.message ?? error);
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { reason?: string; details?: string };
      };
      const reason = parsed.error?.details || parsed.error?.reason;
      if (reason) return reason;
    } catch {
      // not JSON: the raw message
    }
  }
  return raw;
};

export const runPpl = async (
  data: DataPublicPluginStart,
  dataset: Dataset,
  query: string,
  timeRange?: TimeRange,
  signal?: AbortSignal
): Promise<PplRecord[]> =>
  pplResponseToRecords(
    await new PPLService(data, { timeRange, signal }).executeQuery(dataset, query)
  );

export interface PplRows {
  rows: PplRecord[];
  loading: boolean;
  error?: string;
  /** The query has answered at least once. */
  loaded: boolean;
}

const IDLE: PplRows = { rows: [], loading: false, loaded: false };

/**
 * Runs `query` (undefined: nothing runs) in the time range, again when the query, the range or
 * `refreshKey` changes. A screen passes undefined until it is shown, so nothing loads early.
 */
export const usePplRows = (
  dataset: Dataset | undefined,
  query: string | undefined,
  timeRange: TimeRange | undefined,
  refreshKey = 0
): PplRows => {
  const { services } = useOpenSearchDashboards<{ data: DataPublicPluginStart }>();
  const data = services?.data;
  const [state, setState] = useState<PplRows>(IDLE);
  const from = timeRange?.from;
  const to = timeRange?.to;
  const title = dataset?.title;

  useEffect(() => {
    if (!query || !dataset || !data) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    runPpl(data, dataset, query, from && to ? { from, to } : undefined, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setState({ rows, loading: false, loaded: true });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ rows: [], loading: false, loaded: true, error: errorMessage(error) });
      });
    return () => controller.abort();
    // The dataset is identified by its title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, title, query, from, to, refreshKey]);

  return state;
};
