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
});
