/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApplicationStart } from '../../../../../core/public';
import { AGENT_TRACES_NAV_ID } from '../../../common';
import { EvalResult } from './eval_data';
import { parseEvalTime } from './eval_aggregations';

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

/** The trace to open for a result: its target trace, else the session's last judged trace. */
export const traceToOpen = (result: EvalResult): string | undefined =>
  result.traceId ?? result.endTraceId ?? result.startTraceId;

export const openTraceInAgentTraces = (
  application: ApplicationStart,
  traceId: string,
  aroundMs: number
) => application.navigateToApp(AGENT_TRACES_NAV_ID, { path: traceDeepLinkPath(traceId, aroundMs) });

export const openResultTrace = (application: ApplicationStart, result: EvalResult) => {
  const traceId = traceToOpen(result);
  if (traceId) openTraceInAgentTraces(application, traceId, parseEvalTime(result.time));
};
