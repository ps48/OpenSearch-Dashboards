/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { TracesDataTable } from './traces_data_table';

jest.mock('../../../components/data_table/data_table', () => ({ DataTable: () => <div /> }));
jest.mock('./row_evaluations_context', () => ({
  RowEvaluationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let mockCore: Record<string, unknown>;
jest.mock('./table_shared', () => ({
  useDataTableCore: () => mockCore,
  DataTableInfoBar: () => <div data-test-subj="infoBar" />,
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

let mockEvalsEnabled = true;
jest.mock('../../evaluations/eval_feature_flag', () => ({
  useAgentEvalsEnabled: () => mockEvalsEnabled,
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockEvalsEnabled = true;
  });

  it('ignores a linked trace id that is not a trace id', () => {
    window.location.hash = `#/?openTraceId=${encodeURIComponent('x" or true | head 1')}`;
    mockCore = core([hit('t1')]);
    render(<TracesDataTable />);
    expect(mockOpenFlyout).not.toHaveBeenCalled();
    expect(mockFetchTraceSpans).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/');
  });

  it('opens the trace but ignores a malformed linked span id', () => {
    const traceId = '0b5599adba151ad2227c9bdb91e548a2';
    window.location.hash = `#/?openTraceId=${traceId}&openSpanId=${encodeURIComponent('a"b')}`;
    mockFetchTraceSpans.mockResolvedValue(spansResponse(traceId));
    mockCore = core([hit(traceId)]);
    render(<TracesDataTable />);
    // Listed and no valid span: the row opens as on a click.
    expect(mockOpenFlyout).toHaveBeenCalledWith(
      expect.objectContaining({ id: `${traceId}-root`, traceId }),
      undefined
    );
  });

  it('does not open deep links with Agent Evaluations off', () => {
    mockEvalsEnabled = false;
    const traceId = '0b5599adba151ad2227c9bdb91e548a2';
    window.location.hash = `#/?openTraceId=${traceId}`;
    mockCore = core([hit(traceId)]);
    render(<TracesDataTable />);
    expect(mockOpenFlyout).not.toHaveBeenCalled();
    expect(mockFetchTraceSpans).not.toHaveBeenCalled();
  });

  it('keeps the restarted fetch when the aborted one settles, so a third change restarts it', async () => {
    const traceId = '0b5599adba151ad2227c9bdb91e548a2';
    window.location.hash = `#/?openTraceId=${traceId}`;
    // Every fetch but the third hangs until aborted.
    mockFetchTraceSpans.mockImplementation(
      (_params: unknown, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          if (mockFetchTraceSpans.mock.calls.length === 3) {
            resolve(spansResponse(traceId));
            return;
          }
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    mockCore = core([hit('other-trace')]);
    const { rerender } = render(<TracesDataTable />);
    expect(mockFetchTraceSpans).toHaveBeenCalledTimes(1);
    // Second hits: the first fetch is aborted and restarted; its late `finally` must not drop
    // the restarted fetch.
    mockCore = core([hit('other-trace'), hit('t2')]);
    await act(async () => rerender(<TracesDataTable />));
    expect(mockFetchTraceSpans).toHaveBeenCalledTimes(2);
    // Third hits (e.g. auto-refresh) while the restarted fetch runs: restarted again.
    mockCore = core([hit('t3')]);
    await act(async () => rerender(<TracesDataTable />));
    expect(mockFetchTraceSpans).toHaveBeenCalledTimes(3);
    await waitFor(() =>
      expect(mockUpdateFullTree).toHaveBeenCalledWith(traceId, expect.any(Array), false)
    );
  });

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

  it('opens the linked span of the trace (openSpanId), even when the trace is listed', async () => {
    const traceId = '0b5599adba151ad2227c9bdb91e548a2';
    window.location.hash = `#/?openTraceId=${traceId}&openSpanId=abcd1234`;
    mockFetchTraceSpans.mockResolvedValue(spansResponse(traceId));
    mockCore = core([hit(traceId)]);
    render(<TracesDataTable />);
    // Not the row click (which selects the root): the flyout opens on the span id.
    expect(mockOpenFlyout).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abcd1234', traceId })
    );
    expect(mockFetchTraceSpans).toHaveBeenCalledTimes(1);
    // Both parameters leave the URL.
    expect(window.location.hash).toBe('#/');
    await waitFor(() =>
      expect(mockUpdateFullTree).toHaveBeenCalledWith(traceId, expect.any(Array), false)
    );
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

describe('TracesDataTable info bar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.location.hash = '#/';
  });

  it('renders the info bar', () => {
    mockCore = core([hit('t1')]);
    render(<TracesDataTable />);
    expect(screen.getByTestId('infoBar')).toBeInTheDocument();
  });
});
