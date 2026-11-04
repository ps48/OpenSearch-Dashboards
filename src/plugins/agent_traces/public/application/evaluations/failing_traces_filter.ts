/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import { DataPublicPluginStart } from '../../../../data/public';
import { PplRecord, get, str } from './eval_model';
import { F, FAILING_TRACES_LIMIT, buildFailingTracesQuery } from './eval_ppl';
import { evalsDataset, runPpl } from './use_ppl_rows';
import type { TabDefinition } from '../../services/tab_registry/tab_registry_service';

/**
 * "Has a failing evaluation" on the Agent Traces traces table: the ids of at most the 500 most
 * recent traces with a failing result in the range, applied to the traces query as
 * `where traceId in (...)`.
 */
export interface FailingTracesFilter {
  traceIds: string[];
  /** The query returned the cap: older failing traces are left out. */
  capped: boolean;
}

let current: FailingTracesFilter | undefined;
const listeners = new Set<() => void>();

export const getFailingTracesFilter = () => current;

export const setFailingTracesFilter = (filter: FailingTracesFilter | undefined) => {
  current = filter;
  listeners.forEach((l) => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useFailingTracesFilter = () =>
  useSyncExternalStore(subscribe, getFailingTracesFilter, getFailingTracesFilter);

const SAFE_ID = /^[0-9A-Za-z_\-:.]+$/;

/** From `buildFailingTracesQuery` rows (newest first). */
export const failingTracesOf = (rows: PplRecord[]): FailingTracesFilter => {
  const traceIds = rows
    .map((row) => str(get(row, F.traceId)))
    .filter((id): id is string => !!id && SAFE_ID.test(id));
  return { traceIds, capped: rows.length >= FAILING_TRACES_LIMIT };
};

/**
 * The traces query narrowed to the filter's traces. No failing trace keeps an impossible id,
 * so the table is empty rather than unfiltered.
 */
export const withFailingTracesFilter = (query: string, filter = current): string => {
  if (!filter) return query;
  const ids = filter.traceIds.length ? filter.traceIds : ['-'];
  const clause = `where \`traceId\` in (${ids.map((id) => `'${id}'`).join(', ')})`;
  const trimmed = (query ?? '').trim();
  return trimmed ? `${trimmed} | ${clause}` : `| ${clause}`;
};

type Prepare = NonNullable<TabDefinition['prepareQuery']>;

/** Narrows a tab's query (Traces) to the failing traces, while the filter is on. */
export const withFailingFilter =
  (prepare: Prepare): Prepare =>
  (query, sort) =>
    prepare(
      typeof query.query === 'string'
        ? { ...query, query: withFailingTracesFilter(query.query) }
        : query,
      sort
    );

/** One bounded query: the most recent failing traces from `from` to `to`. */
export const fetchFailingTraces = async (
  data: DataPublicPluginStart,
  index: string,
  range: { from: string; to: string },
  signal?: AbortSignal
): Promise<FailingTracesFilter> =>
  failingTracesOf(
    await runPpl(data, evalsDataset(index), buildFailingTracesQuery(index), range, signal)
  );
