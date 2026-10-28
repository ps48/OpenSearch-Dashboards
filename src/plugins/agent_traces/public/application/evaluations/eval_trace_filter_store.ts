/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';

/**
 * "Traces where this evaluation fails": the trace ids of matching results, applied to the
 * Agent Traces and Agent Spans tabs as `where traceId in (...)` and shown as a removable pill
 * naming the condition. Kept for the browser tab's session, so a reload keeps it.
 */
export interface EvalTraceFilter {
  /** The condition in words, e.g. `answer_quality: fail`. */
  label: string;
  traceIds: string[];
  /** More traces matched than `traceIds` holds. */
  capped: boolean;
}

const STORAGE_KEY = 'agentTraces:evalTraceFilter';
const HEX_OR_ID = /^[0-9A-Za-z_\-:.]+$/;

const valid = (v: unknown): v is EvalTraceFilter => {
  const f = v as EvalTraceFilter;
  return (
    !!f &&
    typeof f.label === 'string' &&
    Array.isArray(f.traceIds) &&
    f.traceIds.every((id) => typeof id === 'string' && HEX_OR_ID.test(id))
  );
};

const load = (): EvalTraceFilter | undefined => {
  try {
    const raw = window.sessionStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
    return valid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

let current: EvalTraceFilter | undefined = typeof window !== 'undefined' ? load() : undefined;
const listeners = new Set<() => void>();

export const getEvalTraceFilter = () => current;

export const setEvalTraceFilter = (filter: EvalTraceFilter | undefined) => {
  current = filter && valid(filter) ? filter : undefined;
  try {
    if (current) window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(current));
    else window.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // storage full or disabled: the filter still applies until the page reloads
  }
  listeners.forEach((l) => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useEvalTraceFilter = () =>
  useSyncExternalStore(subscribe, getEvalTraceFilter, getEvalTraceFilter);

/**
 * The user's query narrowed to the filter's traces. A filter matching no trace keeps an
 * impossible id, so the table is empty instead of unfiltered.
 */
export const withEvalTraceFilter = (query: string, filter = current): string => {
  if (!filter) return query;
  const ids = filter.traceIds.length ? filter.traceIds : ['-'];
  const clause = `where \`traceId\` in (${ids.map((id) => `'${id}'`).join(', ')})`;
  const trimmed = (query ?? '').trim();
  return trimmed ? `${trimmed} | ${clause}` : `| ${clause}`;
};
