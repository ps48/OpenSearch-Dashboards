/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { getEvalTraceFilter, setEvalTraceFilter } from '../../evaluations/eval_trace_filter_store';

/** The deep-link parameters that open one trace or session flyout. */
export const DEEP_LINK_PARAMS = ['openTraceId', 'openSessionId'];

/**
 * Opening a trace or a session from a link starts from the unfiltered table: a persisted
 * "traces where an evaluation fails" filter (from an earlier visit) is always cleared first.
 * Run on app mount, before the first query.
 * Returns whether a filter was cleared.
 */
export const clearEvalTraceFilterForDeepLink = (hash = window.location.hash): boolean => {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const opensOne = DEEP_LINK_PARAMS.some((name) => !!params.get(name));
  if (!opensOne || !getEvalTraceFilter()) return false;
  setEvalTraceFilter(undefined);
  return true;
};

/**
 * Reads a one-shot deep-link parameter from the hash query (`#/?...&openTraceId=<id>`) and
 * removes it from the URL without a history entry, so Back and a reload do not reopen it.
 */
export const takeHashParam = (name: string): string | undefined => {
  const [path, query = ''] = window.location.hash.split('?');
  const params = new URLSearchParams(query);
  const value = params.get(name);
  if (!value) return undefined;
  params.delete(name);
  const rest = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${path}${rest ? `?${rest}` : ''}`
  );
  return value;
};

/**
 * Agent Evaluations "Open session": `openSessionId=<id>` in the hash query opens that
 * session's view once `ready`, then leaves the URL. The time range comes from the link's `_g`.
 */
export const useOpenSessionFromLink = (
  ready: boolean,
  openSession: (sessionId: string) => void
) => {
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !ready) return;
    const sessionId = takeHashParam('openSessionId');
    if (!sessionId) return;
    opened.current = true;
    openSession(sessionId);
  }, [ready, openSession]);
};
