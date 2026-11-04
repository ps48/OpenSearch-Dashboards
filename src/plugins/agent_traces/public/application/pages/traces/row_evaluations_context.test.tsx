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

  it('leaves the column empty when a lookup fails', async () => {
    mockRunPpl.mockRejectedValue(new Error('no such index'));
    const { services } = makeServices(true);
    renderProvider(services, ['t1']);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.byTraceId.size).toBe(0);
  });
});

describe('chunkTraceIds', () => {
  it('dedups, sorts and chunks the ids', () => {
    expect(chunkTraceIds(['b', 'a', 'b', '', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(chunkTraceIds([])).toEqual([]);
  });
});
