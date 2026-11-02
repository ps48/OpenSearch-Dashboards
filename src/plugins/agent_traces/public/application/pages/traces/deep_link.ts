/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

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
