/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { takeHashParam, useOpenSessionFromLink } from './deep_link';

const setHash = (hash: string) => window.history.replaceState(null, '', `/app/agentTraces${hash}`);

describe('deep links', () => {
  it('takes a parameter from the hash query and leaves the rest', () => {
    setHash('#/?_g=(time:(from:now-1h,to:now))&openTraceId=abc&x=1');
    expect(takeHashParam('openTraceId')).toBe('abc');
    expect(window.location.hash).toBe('#/?_g=%28time%3A%28from%3Anow-1h%2Cto%3Anow%29%29&x=1');
    expect(takeHashParam('openTraceId')).toBeUndefined();
  });

  it('opens the linked session once, when the page is ready, and removes the parameter', () => {
    setHash('#/?openSessionId=evalpoc%20s1');
    const openSession = jest.fn();
    const { rerender } = renderHook(({ ready }) => useOpenSessionFromLink(ready, openSession), {
      initialProps: { ready: false },
    });
    expect(openSession).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(openSession).toHaveBeenCalledWith('evalpoc s1');
    expect(window.location.hash).toBe('#/');
    rerender({ ready: true });
    expect(openSession).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the parameter', () => {
    setHash('#/?_a=(tab:traces)');
    const openSession = jest.fn();
    renderHook(() => useOpenSessionFromLink(true, openSession));
    expect(openSession).not.toHaveBeenCalled();
  });
});
