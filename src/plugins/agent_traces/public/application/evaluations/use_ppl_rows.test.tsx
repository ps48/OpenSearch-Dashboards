/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { errorMessage, evalsDataset, spansDataset, usePplRows } from './use_ppl_rows';

/** One pending PPL request per call: resolved or rejected by the test, aborted by the hook. */
interface Pending {
  query: string;
  timeRange?: unknown;
  signal?: AbortSignal;
  resolve: (rows: Array<Record<string, unknown>>) => void;
  reject: (e: unknown) => void;
}
const mockCalls: Pending[] = [];
jest.mock('../pages/traces/trace_details/data_fetching/ppl_request_helpers', () => ({
  PPLService: class {
    mockOpts: { timeRange?: unknown; signal?: AbortSignal };
    constructor(_data: unknown, mockOpts: { timeRange?: unknown; signal?: AbortSignal }) {
      this.mockOpts = mockOpts;
    }
    executeQuery(_dataset: unknown, query: string) {
      return new Promise((resolve, reject) =>
        mockCalls.push({
          query,
          timeRange: this.mockOpts.timeRange,
          signal: this.mockOpts.signal,
          // The PPL response shape: schema + datarows.
          resolve: (rows) =>
            resolve({
              schema: Object.keys(rows[0] ?? { n: 0 }).map((name) => ({ name })),
              datarows: rows.map((r) => Object.values(r)),
            }),
          reject,
        })
      );
    }
  },
}));

const wrapper: React.FC = ({ children }) => (
  <OpenSearchDashboardsContextProvider services={{ data: {} }}>
    {children}
  </OpenSearchDashboardsContextProvider>
);

const DS = evalsDataset('evals-*');
const RANGE = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' };

const renderRows = (initial: { query?: string; range?: typeof RANGE; refreshKey?: number }) =>
  renderHook(({ query, range, refreshKey }) => usePplRows(DS, query, range, refreshKey ?? 0), {
    wrapper,
    initialProps: initial,
  });

const last = () => mockCalls[mockCalls.length - 1];

describe('usePplRows', () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  it('runs nothing without a query', () => {
    const { result } = renderRows({ query: undefined });
    expect(mockCalls).toHaveLength(0);
    expect(result.current).toEqual({ rows: [], loading: false, loaded: false });
  });

  it('loads the rows of the query in the range', async () => {
    const { result } = renderRows({ query: 'q1', range: RANGE });
    expect(result.current).toMatchObject({ rows: [], loading: true, loaded: false });
    expect(last().timeRange).toEqual(RANGE);
    await act(async () => last().resolve([{ n: 3 }]));
    expect(result.current).toEqual({ rows: [{ n: 3 }], loading: false, loaded: true });
  });

  it("drops the previous query's rows at once when the query changes", async () => {
    const { result, rerender } = renderRows({ query: 'run-a', range: RANGE });
    await act(async () => last().resolve([{ n: 1 }]));
    expect(result.current.loaded).toBe(true);
    rerender({ query: 'run-b', range: RANGE });
    // Not run-a's rows marked loaded while run-b runs.
    expect(result.current).toEqual({ rows: [], loading: true, loaded: false });
    expect(mockCalls[0].signal?.aborted).toBe(true);
    await act(async () => last().resolve([{ n: 2 }]));
    expect(result.current).toEqual({ rows: [{ n: 2 }], loading: false, loaded: true });
  });

  it('keeps the rows while a refresh or a new range runs', async () => {
    const { result, rerender } = renderRows({ query: 'q', range: RANGE, refreshKey: 0 });
    await act(async () => last().resolve([{ n: 1 }]));
    rerender({ query: 'q', range: RANGE, refreshKey: 1 });
    expect(result.current).toEqual({ rows: [{ n: 1 }], loading: true, loaded: true });
    await act(async () => last().resolve([{ n: 4 }]));
    expect(result.current.rows).toEqual([{ n: 4 }]);
  });

  it('ignores the answer of an aborted query', async () => {
    const { result, rerender } = renderRows({ query: 'old', range: RANGE });
    const old = last();
    rerender({ query: 'new', range: RANGE });
    await act(async () => old.resolve([{ n: 9 }]));
    expect(result.current).toEqual({ rows: [], loading: true, loaded: false });
  });

  it('reports an error as loaded, with a readable message', async () => {
    const { result } = renderRows({ query: 'q', range: RANGE });
    await act(async () =>
      last().reject({ body: { message: 'x {"error":{"reason":"no such index [evals-*]"}}' } })
    );
    expect(result.current).toEqual({
      rows: [],
      loading: false,
      loaded: true,
      error: 'no such index [evals-*]',
    });
  });

  it('aborts on unmount', () => {
    const { unmount } = renderRows({ query: 'q', range: RANGE });
    unmount();
    expect(last().signal?.aborted).toBe(true);
  });
});

describe('datasets and errors', () => {
  it('bounds the evaluations dataset by @timestamp, and spans not at all', () => {
    expect(evalsDataset('e*').timeFieldName).toBe('@timestamp');
    expect(spansDataset('s*').timeFieldName).toBeUndefined();
    expect(evalsDataset('e*', { id: 'ds1', title: 'ds1', type: 'OpenSearch' })).toMatchObject({
      id: 'agent-evaluations-ds1',
      dataSource: { id: 'ds1' },
    });
  });

  it('errorMessage reads the reason, else the raw message', () => {
    expect(errorMessage(undefined)).toBe('');
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
    expect(errorMessage({ message: 'x {"error":{"details":"bad field"}}' })).toBe('bad field');
    expect(errorMessage({ message: 'x {not json' })).toBe('x {not json');
  });
});
