/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { TraceCompareFlyout, flattenSpans, onlyIn, resultsOfSpan } from './trace_compare_flyout';
import { TEST_INDEX, renderWithContext } from './eval_test_utils';
import { buildTraceResultsQuery, buildTraceSpansQuery } from './eval_ppl';
import { recordToResult } from './eval_model';
import type { BaseRow } from '../pages/traces/hooks/tree_utils';

const mockExecute = jest.fn();
jest.mock('../pages/traces/trace_details/data_fetching/ppl_request_helpers', () => ({
  PPLService: jest
    .fn()
    .mockImplementation(() => ({ executeQuery: (...a: unknown[]) => mockExecute(...a) })),
}));
const mockRunPpl = jest.fn();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  runPpl: (...a: unknown[]) => mockRunPpl(...a),
}));
const mockServices = { services: { data: {} } };
jest.mock('../../../../opensearch_dashboards_react/public', () => ({
  useOpenSearchDashboards: () => mockServices,
}));

const span = (
  traceId: string,
  spanId: string,
  parent: string,
  name: string,
  start: string,
  ms: number
) => [traceId, spanId, parent, name, start, ms * 1e6];

describe('TraceCompareFlyout', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockRunPpl.mockReset();
    mockExecute.mockResolvedValue({
      schema: ['traceId', 'spanId', 'parentSpanId', 'name', 'startTime', 'durationInNanos'].map(
        (name) => ({ name, type: 'string' })
      ),
      datarows: [
        span('ta', 'a1', '', 'invoke_agent planner', '2026-10-28 07:00:00', 2000),
        span('ta', 'a2', 'a1', 'search_flights', '2026-10-28 07:00:00.5', 500),
        span('tb', 'b1', '', 'invoke_agent planner', '2026-10-28 08:00:00', 3000),
        span('tb', 'b2', 'b1', 'book_hotel', '2026-10-28 08:00:01', 1000),
      ],
      total: 4,
    });
    mockRunPpl.mockResolvedValue([
      {
        '@timestamp': '2026-10-28 08:00:05',
        traceId: 'tb',
        attributes: {
          gen_ai: {
            evaluation: { name: 'accuracy', score: { label: 'fail' }, explanation: 'Wrong' },
          },
        },
      },
    ]);
  });

  it('reads the spans and results of both traces and highlights spans only in one', async () => {
    renderWithContext(
      <TraceCompareFlyout
        caseId="c1"
        traceA="ta"
        traceB="tb"
        versionA="v1"
        versionB="v2"
        onClose={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.getByTestId('agtEvlSpans-tb')).toBeInTheDocument());
    expect(mockExecute.mock.calls[0][1]).toBe(buildTraceSpansQuery('spans-*', ['ta', 'tb']));
    expect(mockRunPpl.mock.calls[0][2]).toBe(buildTraceResultsQuery(TEST_INDEX, ['ta', 'tb']));
    const b = screen.getByTestId('agtEvlSpans-tb');
    expect(within(b).getAllByTestId('agtEvlSpanOnly')).toHaveLength(1);
    expect(within(b).getByText(/book_hotel/)).toBeInTheDocument();
    // The trace-level result marks the root span of trace B.
    expect(within(b).getByTestId('agtEvlJudgeMark')).toHaveAttribute('data-state', 'fail');
    expect(screen.getByText('Wrong')).toBeInTheDocument();
  });

  it('helpers: flatten, only-in-one and results per span', () => {
    const row = (spanId: string, name: string, children: BaseRow[] = []) =>
      ({
        spanId,
        name,
        kind: 'chat',
        durationNanos: 1e6,
        rawDocument: { startTime: '2026-10-28 07:00:00' },
        children,
      }) as unknown as BaseRow;
    const flat = flattenSpans([row('r', 'root', [row('c', 'child')])]);
    expect(flat.map((s) => [s.spanId, s.depth])).toEqual([
      ['r', 0],
      ['c', 1],
    ]);
    expect(onlyIn(flat, [flat[0]])).toEqual(new Set(['c']));
    const spanResult = recordToResult({
      spanId: 'c',
      attributes: { gen_ai: { evaluation: { name: 'x' } } },
    });
    const traceResult = recordToResult({ attributes: { gen_ai: { evaluation: { name: 'y' } } } });
    expect(resultsOfSpan([spanResult, traceResult], flat[0], true).map((r) => r.name)).toEqual([
      'y',
    ]);
    expect(resultsOfSpan([spanResult, traceResult], flat[1], false).map((r) => r.name)).toEqual([
      'x',
    ]);
  });
});
