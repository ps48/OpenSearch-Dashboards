/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { useAiRootMarker } from './eval_spans';
import { resetAiRootFieldChecks, setAiRootFieldPresent } from '../utils/ai_root';

const mockExecute = jest.fn();
jest.mock('../pages/traces/trace_details/data_fetching/ppl_request_helpers', () => ({
  PPLService: jest.fn().mockImplementation(() => ({ executeQuery: mockExecute })),
}));

const dataset = { id: 'spans-ds', title: 'spans-*', type: 'INDEXES' };
const wrapper: React.FC = ({ children }) => (
  <OpenSearchDashboardsContextProvider services={{ data: {} }}>
    {children}
  </OpenSearchDashboardsContextProvider>
);

describe('useAiRootMarker', () => {
  beforeEach(() => {
    resetAiRootFieldChecks();
    mockExecute.mockReset();
  });

  it('a failed probe falls back to unmapped (no cached answer); Refresh probes again', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Request timed out')).mockResolvedValueOnce({});
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useAiRootMarker(dataset as never, true, refreshKey),
      { wrapper, initialProps: { refreshKey: 0 } }
    );
    // Before the probe answers: unknown, the turns wait.
    expect(result.current).toBeUndefined();
    await act(async () => undefined);
    // Not an endless wait: the marker is not named, so GenAI-root turns show.
    expect(result.current).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    rerender({ refreshKey: 1 });
    await act(async () => undefined);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(true);
  });

  it('a failed re-probe after the cache period keeps the last cached answer', async () => {
    setAiRootFieldPresent(dataset.id, true);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000);
    try {
      mockExecute.mockRejectedValueOnce(new Error('503 Service Unavailable'));
      const { result } = renderHook(() => useAiRootMarker(dataset as never, true, 0), {
        wrapper,
      });
      await act(async () => undefined);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('a field-not-found probe is an answer: the marker is unmapped', async () => {
    mockExecute.mockRejectedValueOnce(
      new Error('Field [attributes.derived.gen_ai.is_root] not found.')
    );
    const { result } = renderHook(() => useAiRootMarker(dataset as never, true, 0), { wrapper });
    await act(async () => undefined);
    expect(result.current).toBe(false);
  });
});
