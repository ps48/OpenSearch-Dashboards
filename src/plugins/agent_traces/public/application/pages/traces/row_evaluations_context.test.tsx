/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { OpenSearchDashboardsContextProvider } from '../../../../../opensearch_dashboards_react/public';
import {
  RowEvaluationsProvider,
  TRACE_IDS_PER_QUERY,
  chunkTraceIds,
  settledRows,
  splitTraceIdsOf,
  tallyByRun,
  useRowEvaluations,
} from './row_evaluations_context';
import { resetEvalsDatasetState } from '../../evaluations/eval_dataset';

const mockRunPpl = jest.fn();
jest.mock('../../evaluations/use_ppl_rows', () => ({
  ...jest.requireActual('../../evaluations/use_ppl_rows'),
  runPpl: (...args: unknown[]) => mockRunPpl(...args),
}));

const makeServices = (evalsEnabled: boolean) => {
  const find = jest.fn(async () => ({ savedObjects: [] }));
  const timefilter = {
    getTime: () => ({ from: 'now-1h', to: 'now' }),
    calculateBounds: () => ({ min: new Date('2026-11-01T00:00:00.000Z') }),
  };
  return {
    find,
    services: {
      capabilities: { agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: evalsEnabled } },
      savedObjects: { client: { find, get: jest.fn(), create: jest.fn(), update: jest.fn() } },
      data: { query: { timefilter: { timefilter } } },
    },
  };
};

let seen: ReturnType<typeof useRowEvaluations> | undefined;
const Probe = () => {
  seen = useRowEvaluations();
  return null;
};

const renderProvider = (services: unknown, traceIds: string[]) =>
  render(
    <OpenSearchDashboardsContextProvider services={services}>
      <RowEvaluationsProvider traceIds={traceIds} mode="trace">
        <Probe />
      </RowEvaluationsProvider>
    </OpenSearchDashboardsContextProvider>
  );

const renderWithRuns = (
  services: unknown,
  runs: Array<{ traceId: string; spanId: string }>,
  fetchSpanParents: jest.Mock
) =>
  render(
    <OpenSearchDashboardsContextProvider services={services}>
      <RowEvaluationsProvider
        traceIds={runs.map((r) => r.traceId)}
        mode="trace"
        agentRuns={runs}
        fetchSpanParents={fetchSpanParents}
      >
        <Probe />
      </RowEvaluationsProvider>
    </OpenSearchDashboardsContextProvider>
  );

// Trace `tp` has an HTTP root `r` with two parallel agents `a` and `b`; `a` calls the LLM `a1`.
const PARALLEL_PARENTS = [
  { traceId: 'tp', spanId: 'r', parentSpanId: '' },
  { traceId: 'tp', spanId: 'a', parentSpanId: 'r' },
  { traceId: 'tp', spanId: 'a1', parentSpanId: 'a' },
  { traceId: 'tp', spanId: 'b', parentSpanId: 'r' },
];
const PARALLEL_RUNS = [
  { traceId: 'tp', spanId: 'a' },
  { traceId: 'tp', spanId: 'b' },
  { traceId: 'ts', spanId: 's' },
];
const parallelTallies = async (_data: unknown, _dataset: unknown, query: string) =>
  query.includes('`spanId`')
    ? [
        { traceId: 'tp', spanId: 'a1', verdict: 'fail', n: 2 },
        { traceId: 'tp', spanId: 'a', verdict: 'pass', n: 1 },
        { traceId: 'tp', spanId: 'b', verdict: 'pass', n: 3 },
        { traceId: 'tp', spanId: 'r', verdict: 'pass', n: 5 },
      ]
    : [
        { traceId: 'tp', verdict: 'pass', n: 9 },
        { traceId: 'tp', verdict: 'fail', n: 2 },
        { traceId: 'ts', verdict: 'pass', n: 1 },
      ];

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${String(i).padStart(4, '0')}`);

describe('RowEvaluationsProvider', () => {
  beforeEach(() => {
    mockRunPpl.mockReset();
    seen = undefined;
    // Configured: the provider reads the config's index.
    resetEvalsDatasetState({ status: 'ready' });
  });

  it('runs no evaluation query and reads no config with Agent Evaluations off', async () => {
    resetEvalsDatasetState();
    const { services, find } = makeServices(false);
    renderProvider(services, ['t1', 't2']);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunPpl).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(seen?.byTraceId.size).toBe(0);
  });

  it('looks every listed trace up, one query per chunk of ids, not one per row', async () => {
    mockRunPpl.mockImplementation(async (_data, _dataset, query: string) => {
      // One row per trace id in the query: the first trace of each chunk failed.
      const listed = Array.from(query.matchAll(/'(t\d{4})'/g)).map((m) => m[1]);
      return listed.map((traceId) => ({ traceId, verdict: 'fail', n: 1 }));
    });
    const { services } = makeServices(true);
    const traceIds = ids(TRACE_IDS_PER_QUERY + 50);
    renderProvider(services, [...traceIds, traceIds[0]]);
    await waitFor(() => expect(seen?.byTraceId.size).toBe(TRACE_IDS_PER_QUERY + 50));
    expect(mockRunPpl).toHaveBeenCalledTimes(2);
    // Rows past the first chunk have their tally too.
    expect(seen?.byTraceId.get(traceIds[TRACE_IDS_PER_QUERY + 10])).toBeDefined();
  });

  it('keeps the tallies of the chunks that answered when another chunk fails', async () => {
    let call = 0;
    mockRunPpl.mockImplementation(async (_data, _dataset, query: string) => {
      call += 1;
      if (call === 1) throw new Error('throttled');
      const listed = Array.from(query.matchAll(/'(t\d{4})'/g)).map((m) => m[1]);
      return listed.map((traceId) => ({ traceId, verdict: 'pass', n: 1 }));
    });
    const { services } = makeServices(true);
    renderProvider(services, ids(TRACE_IDS_PER_QUERY + 50));
    await waitFor(() => expect(seen?.byTraceId.size).toBe(50));
    expect(mockRunPpl).toHaveBeenCalledTimes(2);
  });

  it('gives each agent run of a trace listed as several runs its own tally', async () => {
    mockRunPpl.mockImplementation(parallelTallies);
    const fetchSpanParents = jest.fn(async () => PARALLEL_PARENTS);
    const { services } = makeServices(true);
    renderWithRuns(services, PARALLEL_RUNS, fetchSpanParents);
    await waitFor(() => expect(seen?.splitTraceIds.has('tp')).toBe(true));
    // Only the split trace's parents are read, in one call.
    expect(fetchSpanParents).toHaveBeenCalledTimes(1);
    expect(fetchSpanParents.mock.calls[0][0]).toEqual(['tp']);
    expect(seen?.byRunSpanId.get('a')).toMatchObject({ pass: 1, fail: 2 });
    expect(seen?.byRunSpanId.get('b')).toMatchObject({ pass: 3, fail: 0 });
    // A trace listed once keeps its whole-trace tally.
    expect(seen?.splitTraceIds.has('ts')).toBe(false);
    expect(seen?.byTraceId.get('ts')).toMatchObject({ pass: 1 });
  });

  it('falls back to the whole-trace tally when the span parents cannot be read', async () => {
    mockRunPpl.mockImplementation(parallelTallies);
    const fetchSpanParents = jest.fn(async () => {
      throw new Error('boom');
    });
    const { services } = makeServices(true);
    renderWithRuns(services, PARALLEL_RUNS, fetchSpanParents);
    await waitFor(() => expect(seen?.byTraceId.get('tp')).toBeDefined());
    expect(seen?.splitTraceIds.size).toBe(0);
    expect(seen?.byTraceId.get('tp')).toMatchObject({ pass: 9, fail: 2 });
  });

  it('reads no span parents when every trace is listed once', async () => {
    mockRunPpl.mockImplementation(parallelTallies);
    const fetchSpanParents = jest.fn(async () => []);
    const { services } = makeServices(true);
    renderWithRuns(services, [{ traceId: 'ts', spanId: 's' }], fetchSpanParents);
    await waitFor(() => expect(seen?.byTraceId.get('ts')).toBeDefined());
    expect(fetchSpanParents).not.toHaveBeenCalled();
    expect(mockRunPpl).toHaveBeenCalledTimes(1);
  });

  it('leaves the column empty when a lookup fails', async () => {
    mockRunPpl.mockRejectedValue(new Error('no such index'));
    const { services } = makeServices(true);
    renderProvider(services, ['t1']);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.byTraceId.size).toBe(0);
  });
});

describe('splitTraceIdsOf and tallyByRun', () => {
  it('finds the traces listed as more than one run', () => {
    expect(Array.from(splitTraceIdsOf(PARALLEL_RUNS))).toEqual(['tp']);
    expect(
      splitTraceIdsOf([
        { traceId: 't', spanId: 'a' },
        { traceId: 't', spanId: 'a' },
      ]).size
    ).toBe(0);
  });

  it('counts each result on the run it sits under, and results outside every run on none', () => {
    const byRun = tallyByRun(
      [
        { traceId: 'tp', spanId: 'a1', verdict: 'fail', n: 2 },
        { traceId: 'tp', spanId: 'r', verdict: 'pass', n: 5 },
        { traceId: 'tp', spanId: 'gone', verdict: 'pass', n: 1 },
        { traceId: 'tp', verdict: 'pass', n: 1 },
      ],
      PARALLEL_RUNS,
      PARALLEL_PARENTS
    );
    expect(byRun.get('a')).toMatchObject({ fail: 2, pass: 0 });
    expect(byRun.has('b')).toBe(false);
    expect(byRun.has('r')).toBe(false);
  });

  it('stops on a cycle in the parents', () => {
    const byRun = tallyByRun(
      [{ traceId: 't', spanId: 'x', verdict: 'pass', n: 1 }],
      [{ traceId: 't', spanId: 'a' }],
      [
        { traceId: 't', spanId: 'x', parentSpanId: 'y' },
        { traceId: 't', spanId: 'y', parentSpanId: 'x' },
      ]
    );
    expect(byRun.size).toBe(0);
  });
});

describe('settledRows', () => {
  it('keeps the answered chunks and rejects only when all failed', async () => {
    const boom = new Error('boom');
    await expect(settledRows([Promise.resolve([{ n: 1 }]), Promise.reject(boom)])).resolves.toEqual(
      [{ n: 1 }]
    );
    await expect(settledRows([Promise.reject(boom)])).rejects.toBe(boom);
    await expect(settledRows([])).resolves.toEqual([]);
  });
});

describe('chunkTraceIds', () => {
  it('dedups, sorts and chunks the ids', () => {
    expect(chunkTraceIds(['b', 'a', 'b', '', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(chunkTraceIds([])).toEqual([]);
  });
});
