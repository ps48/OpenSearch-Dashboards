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
export const traceDeepLinkPath = (traceId: string, aroundMs: number): string => {
  const center = Number.isFinite(aroundMs) ? aroundMs : Date.now();
  const from = new Date(center - BEFORE_MS).toISOString();
  const to = new Date(center + AFTER_MS).toISOString();
  // Trace ids are hex; anything else is URI-encoded so it cannot break the hash.
  const id = HEX_ID.test(traceId) ? traceId : encodeURIComponent(traceId);
  return `#/?_g=(time:(from:'${from}',to:'${to}'))&_a=(ui:(activeTabId:traces,showHistogram:!t))&openTraceId=${id}`;
};

export const openTraceInAgentTraces = (
  application: ApplicationStart,
  traceId: string,
  aroundMs: number
) => application.navigateToApp(AGENT_TRACES_NAV_ID, { path: traceDeepLinkPath(traceId, aroundMs) });

/** Opens a screen of the Agent Evaluations app (from Agent Traces). */
export const openInEvaluations = (application: ApplicationStart, route: EvalRoute) =>
  application.navigateToApp(AGENT_EVALS_NAV_ID, { path: `#${pathOfRoute(route)}` });
