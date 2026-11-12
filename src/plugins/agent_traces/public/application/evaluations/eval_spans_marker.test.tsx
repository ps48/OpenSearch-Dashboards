/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { useAiRootMarker } from './eval_spans';
import { resetAiRootFieldChecks } from '../utils/ai_root';

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

  it('a failed probe leaves the marker unknown; Refresh probes again', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Request timed out')).mockResolvedValueOnce({});
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useAiRootMarker(dataset as never, true, refreshKey),
      { wrapper, initialProps: { refreshKey: 0 } }
    );
    await act(async () => undefined);
    // Not "unmapped": unknown, so the session turns wait instead of dropping the marker.
    expect(result.current).toBeUndefined();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    rerender({ refreshKey: 1 });
    await act(async () => undefined);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(true);
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
