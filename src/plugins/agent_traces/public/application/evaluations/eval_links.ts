/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApplicationStart } from '../../../../../core/public';
import { AGENT_EVALS_NAV_ID, AGENT_TRACES_NAV_ID } from '../../../common';
import { EvalRoute, pathOfRoute } from './eval_routes';

/** Window around the evaluated trace: results usually arrive after the trace they judged. */
const BEFORE_MS = 6 * 60 * 60 * 1000;
const AFTER_MS = 60 * 60 * 1000;

const HEX_ID = /^[0-9a-fA-F-]+$/;

/**
 * Agent Traces deep link that opens the trace's flyout, with a time range that contains it.
 * `aroundMs` is the evaluation time (or the span start when known).
 */
export const traceDeepLinkPath = (traceId: string, aroundMs: number, spanId?: string): string => {
  const center = Number.isFinite(aroundMs) ? aroundMs : Date.now();
  const from = new Date(center - BEFORE_MS).toISOString();
  const to = new Date(center + AFTER_MS).toISOString();
  // Trace ids are hex; anything else is URI-encoded so it cannot break the hash.
  const id = HEX_ID.test(traceId) ? traceId : encodeURIComponent(traceId);
  const span = spanId
    ? `&openSpanId=${HEX_ID.test(spanId) ? spanId : encodeURIComponent(spanId)}`
    : '';
  return `#/?_g=(time:(from:'${from}',to:'${to}'))&_a=(ui:(activeTabId:traces,showHistogram:!t))&openTraceId=${id}${span}`;
};

export const openTraceInAgentTraces = (
  application: ApplicationStart,
  traceId: string,
  aroundMs: number
) => application.navigateToApp(AGENT_TRACES_NAV_ID, { path: traceDeepLinkPath(traceId, aroundMs) });

/** Agent Traces deep link that opens a session's view, with a time range around it. */
export const sessionDeepLinkPath = (sessionId: string, aroundMs: number): string => {
  const center = Number.isFinite(aroundMs) ? aroundMs : Date.now();
  const from = new Date(center - BEFORE_MS).toISOString();
  const to = new Date(center + AFTER_MS).toISOString();
  return `#/?_g=(time:(from:'${from}',to:'${to}'))&_a=(ui:(activeTabId:traces,showHistogram:!t))&openSessionId=${encodeURIComponent(
    sessionId
  )}`;
};

export const openSessionInAgentTraces = (
  application: ApplicationStart,
  sessionId: string,
  aroundMs: number
) =>
  application.navigateToApp(AGENT_TRACES_NAV_ID, {
    path: sessionDeepLinkPath(sessionId, aroundMs),
  });

/** Opens a screen of the Agent Evaluations app (from Agent Traces). */
export const openInEvaluations = (application: ApplicationStart, route: EvalRoute) =>
  application.navigateToApp(AGENT_EVALS_NAV_ID, { path: `#${pathOfRoute(route)}` });

/** What a result judged, for its links: a session, a trace or a span of a trace. */
export type ResultTarget =
  | { kind: 'session'; id: string }
  | { kind: 'trace'; traceId: string }
  | { kind: 'span'; traceId: string; spanId: string };

export const targetOf = (r: {
  level: string;
  traceId?: string;
  spanId?: string;
  conversationId?: string;
}): ResultTarget | undefined => {
  if (r.level === 'session')
    return r.conversationId ? { kind: 'session', id: r.conversationId } : undefined;
  if (!r.traceId) return undefined;
  return r.level === 'span' && r.spanId
    ? { kind: 'span', traceId: r.traceId, spanId: r.spanId }
    : { kind: 'trace', traceId: r.traceId };
};

/** A URL (for a new tab) to the session, trace or span a result judged, in Agent Traces. */
export const targetHref = (
  application: Pick<ApplicationStart, 'getUrlForApp'>,
  target: ResultTarget,
  aroundMs: number
): string =>
  application.getUrlForApp(AGENT_TRACES_NAV_ID, {
    path:
      target.kind === 'session'
        ? sessionDeepLinkPath(target.id, aroundMs)
        : traceDeepLinkPath(
            target.traceId,
            aroundMs,
            target.kind === 'span' ? target.spanId : undefined
          ),
  });
