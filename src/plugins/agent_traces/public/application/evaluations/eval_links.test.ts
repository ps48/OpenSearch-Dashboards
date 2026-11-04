/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApplicationStart } from '../../../../../core/public';
import { AGENT_EVALS_NAV_ID, AGENT_TRACES_NAV_ID } from '../../../common';
import {
  openInEvaluations,
  openSessionInAgentTraces,
  openTraceInAgentTraces,
  sessionDeepLinkPath,
  targetHref,
  targetOf,
  traceDeepLinkPath,
} from './eval_links';

const AT = Date.UTC(2026, 9, 28, 12);
const RANGE = "_g=(time:(from:'2026-10-28T06:00:00.000Z',to:'2026-10-28T13:00:00.000Z'))";
const UI = '_a=(ui:(activeTabId:traces,showHistogram:!t))';
const app = () => {
  const navigateToApp = jest.fn();
  return { navigateToApp, application: { navigateToApp } as unknown as ApplicationStart };
};

describe('eval links', () => {
  it('links a trace with a range from 6 h before to 1 h after', () => {
    expect(traceDeepLinkPath('abc123', AT)).toBe(`#/?${RANGE}&${UI}&openTraceId=abc123`);
    // Not a hex id: encoded so it cannot break the hash.
    expect(traceDeepLinkPath('a b&c', AT)).toBe(`#/?${RANGE}&${UI}&openTraceId=a%20b%26c`);
  });

  it('links a session (openSessionId, always encoded) with the same range', () => {
    expect(sessionDeepLinkPath('evalpoc s1', AT)).toBe(
      `#/?${RANGE}&${UI}&openSessionId=evalpoc%20s1`
    );
    expect(sessionDeepLinkPath('conv-1&x=2', AT)).toBe(
      `#/?${RANGE}&${UI}&openSessionId=conv-1%26x%3D2`
    );
  });

  it('centers on now when the time is unknown', () => {
    jest.useFakeTimers().setSystemTime(AT);
    expect(sessionDeepLinkPath('s1', NaN)).toBe(`#/?${RANGE}&${UI}&openSessionId=s1`);
    expect(traceDeepLinkPath('ab', NaN)).toBe(`#/?${RANGE}&${UI}&openTraceId=ab`);
    jest.useRealTimers();
  });

  it('navigates to Agent Traces and to Agent Evaluations', () => {
    const a = app();
    openSessionInAgentTraces(a.application, 's1', AT);
    expect(a.navigateToApp).toHaveBeenCalledWith(AGENT_TRACES_NAV_ID, {
      path: sessionDeepLinkPath('s1', AT),
    });
    openTraceInAgentTraces(a.application, 'ab', AT);
    expect(a.navigateToApp).toHaveBeenLastCalledWith(AGENT_TRACES_NAV_ID, {
      path: traceDeepLinkPath('ab', AT),
    });
    openInEvaluations(a.application, { page: 'run', runId: 'r1' });
    expect(a.navigateToApp).toHaveBeenLastCalledWith(AGENT_EVALS_NAV_ID, {
      path: expect.stringMatching(/^#\/.*r1/),
    });
  });

  it('opens a span of a trace with openSpanId', () => {
    expect(traceDeepLinkPath('ab12', AT, 'cd34')).toBe(
      `#/?${RANGE}&${UI}&openTraceId=ab12&openSpanId=cd34`
    );
    expect(traceDeepLinkPath('ab12', AT, 'span 1')).toBe(
      `#/?${RANGE}&${UI}&openTraceId=ab12&openSpanId=span%201`
    );
    expect(traceDeepLinkPath('ab12', AT, '')).toBe(`#/?${RANGE}&${UI}&openTraceId=ab12`);
  });

  it('tells what a result judged: a session, a span or the trace', () => {
    expect(targetOf({ level: 'session', conversationId: 'c1', traceId: 't' })).toEqual({
      kind: 'session',
      id: 'c1',
    });
    expect(targetOf({ level: 'session', traceId: 't' })).toBeUndefined();
    expect(targetOf({ level: 'span', traceId: 't', spanId: 's' })).toEqual({
      kind: 'span',
      traceId: 't',
      spanId: 's',
    });
    // A span id without a span level: the trace (trace-level results carry the root span).
    expect(targetOf({ level: 'trace', traceId: 't', spanId: 's' })).toEqual({
      kind: 'trace',
      traceId: 't',
    });
    expect(targetOf({ level: 'span', traceId: 't' })).toEqual({ kind: 'trace', traceId: 't' });
    expect(targetOf({ level: 'trace' })).toBeUndefined();
  });

  it('builds a new-tab URL to the target in Agent Traces', () => {
    const getUrlForApp = jest.fn(
      (appId: string, { path }: { path?: string } = {}) => `/app/${appId}${path}`
    );
    const application = { getUrlForApp };
    expect(targetHref(application, { kind: 'session', id: 's1' }, AT)).toBe(
      `/app/${AGENT_TRACES_NAV_ID}${sessionDeepLinkPath('s1', AT)}`
    );
    expect(targetHref(application, { kind: 'trace', traceId: 'ab' }, AT)).toBe(
      `/app/${AGENT_TRACES_NAV_ID}${traceDeepLinkPath('ab', AT)}`
    );
    expect(targetHref(application, { kind: 'span', traceId: 'ab', spanId: 'cd' }, AT)).toBe(
      `/app/${AGENT_TRACES_NAV_ID}${traceDeepLinkPath('ab', AT, 'cd')}`
    );
  });
});
