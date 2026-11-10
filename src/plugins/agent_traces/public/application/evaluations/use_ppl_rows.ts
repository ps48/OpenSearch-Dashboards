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
import type { DataSourceRef } from './eval_dataset';
import { EVALS_TIME_FIELD } from './ppl_queries';

/** The evaluations index as a dataset: the PPL service bounds it by `@timestamp`. */
const withDataSource = (dataSource?: DataSourceRef) => (dataSource ? { dataSource } : {});

export const evalsDataset = (index: string, dataSource?: DataSourceRef): Dataset => ({
  id: `agent-evaluations${dataSource ? `-${dataSource.id}` : ''}`,
  title: index,
  type: 'INDEXES',
  timeFieldName: EVALS_TIME_FIELD,
  ...withDataSource(dataSource),
});

/**
 * The evaluations index without a time bound: only for lookups filtered to a few ids (a run's
 * window), which must find the run wherever the global range is.
 */
export const evalsLookupDataset = (index: string, dataSource?: DataSourceRef): Dataset => ({
  id: `agent-evaluations-lookup${dataSource ? `-${dataSource.id}` : ''}`,
  title: index,
  type: 'INDEXES',
  ...withDataSource(dataSource),
});

/** The span index, looked up by trace id (no time field). */
export const spansDataset = (index: string, dataSource?: DataSourceRef): Dataset => ({
  id: `agent-evaluations-spans${dataSource ? `-${dataSource.id}` : ''}`,
  title: index,
  type: 'INDEXES',
  ...withDataSource(dataSource),
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
const PENDING: PplRows = { rows: [], loading: true, loaded: false };

/**
 * Runs `query` (undefined: nothing runs) in the time range, again when the query, the range or
 * `refreshKey` changes. A screen passes undefined until it is shown, so nothing loads early.
 *
 * Rows belong to the query and dataset that produced them: when either changes, the previous
 * rows are dropped at once (nothing `loaded` until the new query answers), so a screen never
 * reads another run's rows. A new time range or a refresh keeps them while the query runs.
 */
export const usePplRows = (
  dataset: Dataset | undefined,
  query: string | undefined,
  timeRange: TimeRange | undefined,
  refreshKey = 0
): PplRows => {
  const { services } = useOpenSearchDashboards<{ data: DataPublicPluginStart }>();
  const data = services?.data;
  const [state, setState] = useState<PplRows & { key?: string }>(IDLE);
  const from = timeRange?.from;
  const to = timeRange?.to;
  const title = dataset?.title;
  const datasetId = dataset?.id;
  const key = query && dataset && data ? `${datasetId}|${title}|${query}` : undefined;

  useEffect(() => {
    if (!key || !query || !dataset || !data) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState((s) =>
      s.key === key ? { ...s, loading: true, error: undefined } : { ...PENDING, key }
    );
    runPpl(data, dataset, query, from && to ? { from, to } : undefined, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setState({ rows, loading: false, loaded: true, key });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ rows: [], loading: false, loaded: true, error: errorMessage(error), key });
      });
    return () => controller.abort();
    // The dataset is identified by its id and title (in `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, from, to, refreshKey]);

  if (!key) return IDLE;
  // Before the effect for a new query has run: not the previous query's rows.
  if (state.key !== key) return PENDING;
  const { key: _key, ...rows } = state;
  return rows;
};
