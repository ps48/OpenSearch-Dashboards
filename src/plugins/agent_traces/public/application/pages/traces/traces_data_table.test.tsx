/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { TracesDataTable } from './traces_data_table';

jest.mock('../../../components/data_table/data_table', () => ({ DataTable: () => <div /> }));
jest.mock('./row_evaluations_context', () => ({
  RowEvaluationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let mockCore: Record<string, unknown>;
jest.mock('./table_shared', () => ({
  useDataTableCore: () => mockCore,
  DataTableInfoBar: () => <div />,
  TableLoadingState: () => <div />,
  TableEmptyState: () => <div />,
  hitToBaseRow: (h: { _source: Record<string, string> }) => ({
    id: h._source.spanId,
    spanId: h._source.spanId,
    traceId: h._source.traceId,
    parentSpanId: null,
    name: h._source.name,
    level: 0,
    isExpandable: true,
  }),
}));

const mockFetchTraceSpans = jest.fn();
jest.mock('./hooks/use_ppl_query_deps', () => ({
  usePPLQueryDeps: () => ({
    pplService: { fetchTraceSpans: mockFetchTraceSpans },
    datasetParam: { id: 'tr', title: 'otel-v1-apm-span*' },
  }),
}));

const mockOpenFlyout = jest.fn();
const mockUpdateFullTree = jest.fn();
jest.mock('./flyout/trace_flyout_context', () => ({
  useTraceFlyout: () => ({
    openFlyout: mockOpenFlyout,
    openSession: jest.fn(),
    updateFlyoutFullTree: mockUpdateFullTree,
  }),
}));

const hit = (traceId: string) => ({
  _index: 'otel-v1-apm-span-000001',
  _id: `${traceId}-root`,
  _score: null,
  _source: {
    traceId,
    spanId: `${traceId}-root`,
    parentSpanId: '',
    name: 'invoke_agent travel_planner',
    startTime: '2026-10-28T21:56:17.484Z',
    endTime: '2026-10-28T21:56:20.000Z',
    durationInNanos: 2500000000,
    attributes: { gen_ai: { operation: { name: 'invoke_agent' } } },
    status: { code: 0 },
  },
});

const spansResponse = (traceId: string) => ({
  schema: [{ name: 'traceId' }, { name: 'spanId' }, { name: 'parentSpanId' }, { name: 'name' }],
  datarows: [[traceId, `${traceId}-root`, '', 'invoke_agent travel_planner']],
});

const core = (hits: unknown[], isQueryLoading = false) => ({
  dataset: { id: 'tr', title: 'otel-v1-apm-span*' },
  results: { hits: { hits } },
  hits,
  isQueryLoading,
  isInitialized: true,
  traceMetrics: undefined,
  formatTs: (t: string) => t,
  sortOrder: [],
  handleSortChange: jest.fn(),
  displayedColumns: [],
  onRemoveColumn: jest.fn(),
  onAddColumn: jest.fn(),
  hasHead: false,
  onAddFilter: jest.fn(),
  docViewsRegistry: undefined,
  sampleSize: 100,
  wrapCellText: false,
  setWrapCellText: jest.fn(),
});

describe('TracesDataTable deep link', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the linked trace tree even when the hits change while its spans load', async () => {
    const traceId = '0b5599adba151ad2227c9bdb91e548a2';
    window.location.hash = `#/?_a=(ui:(activeTabId:traces))&openTraceId=${traceId}`;
    // The first spans fetch is aborted by the next query; the second one answers.
    mockFetchTraceSpans.mockImplementation(
      (_params: unknown, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          if (mockFetchTraceSpans.mock.calls.length === 1) {
            signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            );
            return;
          }
          resolve(spansResponse(traceId));
        })
    );

    // The first query settles on other traces (before the link's time range applied).
    mockCore = core([hit('other-trace')]);
    const { rerender } = render(<TracesDataTable />);
    expect(mockOpenFlyout).toHaveBeenCalledWith(expect.objectContaining({ traceId }));
    expect(mockFetchTraceSpans).toHaveBeenCalledTimes(1);

    // The link's range is applied: new hits, which abort the first fetch.
    mockCore = core([hit(traceId), hit('other-trace')]);
    await act(async () => rerender(<TracesDataTable />));

    await waitFor(() =>
      expect(mockUpdateFullTree).toHaveBeenCalledWith(traceId, expect.any(Array), false)
    );
    expect(mockFetchTraceSpans).toHaveBeenCalledTimes(2);
  });

  it('does not fetch a trace again when no fetch was interrupted', async () => {
    window.location.hash = '#/';
    mockFetchTraceSpans.mockResolvedValue(spansResponse('t1'));
    mockCore = core([hit('t1')]);
    const { rerender } = render(<TracesDataTable />);
    mockCore = core([hit('t2')]);
    await act(async () => rerender(<TracesDataTable />));
    expect(mockFetchTraceSpans).not.toHaveBeenCalled();
  });
});
