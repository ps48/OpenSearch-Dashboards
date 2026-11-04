/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useSessionEvaluations, useTraceEvaluations } from './use_trace_evaluations';
import { buildSessionResultsQuery, buildTraceResultsQuery } from '../../../evaluations/eval_ppl';

const FROM = '2026-11-02T00:00:00.000Z';
const mockServices = {
  data: {
    query: {
      timefilter: {
        timefilter: {
          getTime: () => ({ from: 'now-2d', to: 'now' }),
          calculateBounds: () => ({ min: { toISOString: () => FROM } }),
        },
      },
    },
  },
};
jest.mock('../../../../../../opensearch_dashboards_react/public', () => ({
  useOpenSearchDashboards: () => ({ services: mockServices }),
}));
let mockIndex: string | undefined = 'evals-*';
jest.mock('../../../evaluations/eval_dataset', () => ({
  useEvalsIndexPattern: () => mockIndex,
}));
const mockRunPpl = jest.fn();
jest.mock('../../../evaluations/use_ppl_rows', () => ({
  ...jest.requireActual('../../../evaluations/use_ppl_rows'),
  runPpl: (...args: unknown[]) => mockRunPpl(...args),
}));

const doc = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  '@timestamp': '2026-10-28 07:00:01',
  attributes: {
    gen_ai: { evaluation: { name, score: { label } }, conversation: { id: 'sess-1' } },
    opensearch: { gen_ai: { evaluation: { level: 'session' } } },
  },
  ...extra,
});

describe('evaluation results hooks', () => {
  beforeEach(() => {
    mockIndex = 'evals-*';
    mockRunPpl.mockReset();
  });

  it('reads the session-level results of a session, failing first', async () => {
    mockRunPpl.mockResolvedValue([doc('tone', 'pass'), doc('goal', 'fail')]);
    const { result } = renderHook(() => useSessionEvaluations('sess-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockRunPpl).toHaveBeenCalledTimes(1);
    const [, dataset, query, range] = mockRunPpl.mock.calls[0];
    expect(query).toBe(buildSessionResultsQuery('evals-*', 'sess-1'));
    expect((dataset as { title: string }).title).toBe('evals-*');
    expect((range as { from: string }).from).toBe(FROM);
    expect(result.current.results.map((r) => [r.name, r.verdict])).toEqual([
      ['goal', 'fail'],
      ['tone', 'pass'],
    ]);
  });

  it('runs nothing without a session id or an evaluations index', () => {
    const { result } = renderHook(() => useSessionEvaluations(undefined));
    expect(result.current).toEqual({ results: [], isLoading: false });
    mockIndex = undefined;
    renderHook(() => useSessionEvaluations('sess-1'));
    expect(mockRunPpl).not.toHaveBeenCalled();
  });

  it('hides a missing index, and reports other errors', async () => {
    mockRunPpl.mockRejectedValueOnce(new Error('no such index [evals-*]'));
    const missing = renderHook(() => useSessionEvaluations('sess-1'));
    await waitFor(() => expect(missing.result.current.isLoading).toBe(false));
    expect(missing.result.current.error).toBeUndefined();
    mockRunPpl.mockRejectedValueOnce(new Error('Boom'));
    const failed = renderHook(() => useSessionEvaluations('sess-2'));
    await waitFor(() => expect(failed.result.current.error).toBe('Boom'));
  });

  it('the trace hook still reads one trace and groups by span', async () => {
    mockRunPpl.mockResolvedValue([
      {
        '@timestamp': '2026-10-28 07:00:01',
        traceId: 't1',
        spanId: 's1',
        attributes: { gen_ai: { evaluation: { name: 'acc', score: { label: 'fail' } } } },
      },
    ]);
    const { result } = renderHook(() => useTraceEvaluations('t1', 'root'));
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(mockRunPpl.mock.calls[0][2]).toBe(buildTraceResultsQuery('evals-*', ['t1']));
    expect(Object.keys(result.current.bySpanId)).toEqual(['s1']);
  });
});
