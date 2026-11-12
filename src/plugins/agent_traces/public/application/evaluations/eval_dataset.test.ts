/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  currentWorkspaceId,
  defaultEvalsDatasets,
  evalsConfigType,
  findEvalsConfig,
  getEvalsDatasetState,
  listDatasets,
  loadEvalsConfig,
  loadEvalsDataset,
  resetEvalsDatasetState,
  saveEvalsConfig,
  spansIndexOf,
} from './eval_dataset';
import {
  EMPTY_RESULTS_FILTERS,
  buildAgentsQuery,
  buildCompareRunsQuery,
  buildResultsPageQuery,
  buildRunCasesQuery,
  buildSuiteRunsQuery,
  buildTraceResultsQuery,
  buildTracesTallyQuery,
} from './ppl_queries';
import { evalsDataset } from './use_ppl_rows';

const patterns: Record<string, Record<string, string>> = {
  tr: { title: 'otel-v1-apm-span*', signalType: 'traces', displayName: 'Trace Dataset' },
  ev: { title: 'otel-v1-genai-evaluation*', signalType: 'logs', timeFieldName: 'time' },
  lg: { title: 'logs-otel-v1*', signalType: 'logs' },
  bad: { title: 'evals | where 1=1', signalType: 'logs' },
};

const correlation = (id: string, type: string, traces: string, other: string, key: string) => ({
  id,
  type: 'correlations',
  attributes: {
    correlationType: type,
    entities: [
      { tracesDataset: { id: 'references[0].id' } },
      { [key]: { id: 'references[1].id' } },
    ],
  },
  references: [
    { name: 'entities[0].index', type: 'index-pattern', id: traces },
    { name: 'entities[1].index', type: 'index-pattern', id: other },
  ],
});

const makeClient = (correlations: unknown[]) => ({
  find: jest.fn(async ({ type }: { type: string }) => ({
    savedObjects:
      type === 'correlations'
        ? correlations
        : Object.entries(patterns).map(([id, attributes]) => ({ id, attributes })),
  })),
  get: jest.fn(async (_type: string, id: string) =>
    patterns[id] ? { id, attributes: patterns[id] } : { id, error: { statusCode: 404 } }
  ),
  create: jest.fn(async () => ({ id: 'new-id' })),
  update: jest.fn(async () => ({})),
});

const evalsConfig = correlation('c1', 'AgentEvals-Config-ws1', 'tr', 'ev', 'evaluationsDataset');
const logsCorrelation = correlation(
  'c0',
  'trace-to-logs-otel-v1-apm-span*',
  'tr',
  'lg',
  'logsDataset'
);

describe('evaluations app config', () => {
  afterEach(() => resetEvalsDatasetState());

  it('is one per workspace, default without workspaces', () => {
    expect(evalsConfigType('ws1')).toBe('AgentEvals-Config-ws1');
    expect(evalsConfigType()).toBe('AgentEvals-Config-default');
  });

  it("reads the workspace's AgentEvals-Config only, resolving its references", async () => {
    const other = correlation('c9', 'AgentEvals-Config-ws2', 'tr', 'lg', 'evaluationsDataset');
    const client = makeClient([logsCorrelation, other, evalsConfig]);
    expect(await findEvalsConfig(client as never, 'ws1')).toEqual({
      configId: 'c1',
      tracesDatasetId: 'tr',
      evaluationsDatasetId: 'ev',
    });
    const { config, configId } = await loadEvalsConfig(client as never, 'ws1');
    expect(configId).toBe('c1');
    expect(config).toMatchObject({
      configId: 'c1',
      tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*' },
      evaluationsDataset: { id: 'ev', timeFieldName: 'time' },
      index: 'otel-v1-genai-evaluation*',
    });
  });

  it('ignores the old trace-to-evaluations correlations', async () => {
    const old = correlation('c5', 'trace-to-evaluations-x', 'tr', 'ev', 'evaluationsDataset');
    expect(await findEvalsConfig(makeClient([old]) as never, 'ws1')).toBeUndefined();
  });

  it('keeps the object id when its evaluations dataset is missing or PPL cannot take it', async () => {
    // Deleted: said so (the app shows "The evaluations dataset was deleted").
    const gone = correlation('c2', 'AgentEvals-Config-ws1', 'tr', 'gone', 'evaluationsDataset');
    expect(await loadEvalsConfig(makeClient([gone]) as never, 'ws1')).toEqual({
      configId: 'c2',
      datasetMissing: true,
    });
    const bad = correlation('c3', 'AgentEvals-Config-ws1', 'tr', 'bad', 'evaluationsDataset');
    expect(await loadEvalsConfig(makeClient([bad]) as never, 'ws1')).toEqual({
      configId: 'c3',
      datasetMissing: false,
    });
  });

  it('a failed index pattern lookup is not "deleted": the load fails (could not read)', async () => {
    const failing = (error: unknown, rejects: boolean) => ({
      ...makeClient([evalsConfig]),
      get: jest.fn(async () => {
        if (rejects) throw error;
        return { id: 'ev', error };
      }),
    });
    // A 5xx in the bulk get answer, and a rejected request.
    await expect(
      loadEvalsConfig(
        failing({ statusCode: 500, message: 'Internal error' }, false) as never,
        'ws1'
      )
    ).rejects.toThrow('Internal error');
    await expect(
      loadEvalsConfig(failing(new Error('Network down'), true) as never, 'ws1')
    ).rejects.toThrow('Network down');
    // The store keeps the error, without datasetMissing: the app shows "Could not read".
    const state = await loadEvalsDataset(failing(new Error('Network down'), true) as never, {
      force: true,
      workspaceId: 'ws1',
    });
    expect(state).toEqual({ status: 'error', error: 'Network down' });
    // A rejected 404 is a missing pattern.
    expect(await loadEvalsConfig(failing({ res: { status: 404 } }, true) as never, 'ws1')).toEqual({
      configId: 'c1',
      datasetMissing: true,
    });
  });

  it('keeps a config whose traces dataset is gone, without it', async () => {
    const noTraces = correlation('c4', 'AgentEvals-Config-ws1', 'gone', 'ev', 'evaluationsDataset');
    const { config } = await loadEvalsConfig(makeClient([noTraces]) as never, 'ws1');
    expect(config?.tracesDataset).toBeUndefined();
    expect(config?.index).toBe('otel-v1-genai-evaluation*');
  });

  it('keeps a config whose traces dataset cannot be read, without it', async () => {
    const base = makeClient([evalsConfig]);
    const client = {
      ...base,
      get: jest.fn(async (type: string, id: string) => {
        if (id === 'tr') throw new Error('Network down');
        return (base.get as (t: string, i: string) => Promise<unknown>)(type, id);
      }),
    };
    const { config } = await loadEvalsConfig(client as never, 'ws1');
    expect(config?.tracesDataset).toBeUndefined();
    expect(config?.index).toBe('otel-v1-genai-evaluation*');
  });

  it('reads the workspace from the workspaces service, else the URL', () => {
    expect(
      currentWorkspaceId({ workspaces: { currentWorkspaceId$: { getValue: () => 'ws1' } } })
    ).toBe('ws1');
    window.history.replaceState({}, '', '/w/abc123/app/agentTraces/evaluations');
    expect(currentWorkspaceId({})).toBe('abc123');
    window.history.replaceState({}, '', '/app/agentTraces/evaluations');
    expect(currentWorkspaceId({})).toBeUndefined();
  });

  it('proposes the Agent Traces traces dataset and an otel-v1-genai-evaluation* logs dataset', () => {
    const traces = [
      { id: 't1', title: 'a*' },
      { id: 't2', title: 'b*' },
    ];
    const logs = [
      { id: 'l1', title: 'logs-otel-v1*' },
      { id: 'l2', title: 'otel-v1-genai-evaluation-*' },
    ];
    expect(defaultEvalsDatasets(traces, logs, 't2')).toEqual({
      traces: traces[1],
      evaluations: logs[1],
    });
    expect(defaultEvalsDatasets(traces, logs, 'gone').traces).toBe(traces[0]);
    expect(defaultEvalsDatasets([], [logs[0]])).toEqual({});
  });

  it('skips an evaluations dataset whose title PPL cannot read as an index', () => {
    const unsafe = { id: 'l3', title: 'otel-v1-genai-evaluation* | head 1' };
    const safe = { id: 'l2', title: 'otel-v1-genai-evaluation-*' };
    expect(defaultEvalsDatasets([], [unsafe]).evaluations).toBeUndefined();
    expect(defaultEvalsDatasets([], [unsafe, safe]).evaluations).toBe(safe);
  });

  it("reads spans from the config's traces dataset, else otel-v1-apm-span-*", () => {
    const base = {
      configId: 'c',
      evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*' },
      index: 'otel-v1-genai-evaluation*',
    };
    expect(spansIndexOf({ ...base, tracesDataset: { id: 'tr', title: 'agent-spans*' } })).toBe(
      'agent-spans*'
    );
    expect(spansIndexOf(base)).toBe('otel-v1-apm-span-*');
    expect(spansIndexOf(undefined)).toBe('otel-v1-apm-span-*');
    expect(spansIndexOf({ ...base, tracesDataset: { id: 'tr', title: 'a | b' } })).toBe(
      'otel-v1-apm-span-*'
    );
  });

  it('lists datasets by signal type', async () => {
    const client = makeClient([]);
    const logs = await listDatasets(client as never, 'logs');
    expect(logs.map((d) => d.id)).toEqual(['ev', 'lg', 'bad']);
    expect(client.find).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'index-pattern', search: '*' })
    );
    expect((await listDatasets(client as never, 'traces')).map((d) => d.id)).toEqual(['tr']);
  });

  it('saves the APM-style app config, or updates it in place', async () => {
    const client = makeClient([]);
    const traces = { id: 'tr', title: 'otel-v1-apm-span*' };
    const evals = { id: 'ev', title: 'otel-v1-genai-evaluation*' };
    expect(await saveEvalsConfig(client as never, traces, evals, { workspaceId: 'ws1' })).toBe(
      'new-id'
    );
    expect(client.create).toHaveBeenCalledWith(
      'correlations',
      {
        correlationType: 'AgentEvals-Config-ws1',
        title: 'AgentEvals-Config',
        version: '1.0.0',
        entities: [
          { tracesDataset: { id: 'references[0].id' } },
          { evaluationsDataset: { id: 'references[1].id' } },
        ],
      },
      {
        references: [
          { name: 'entities[0].index', type: 'index-pattern', id: 'tr' },
          { name: 'entities[1].index', type: 'index-pattern', id: 'ev' },
        ],
      }
    );
    expect(
      await saveEvalsConfig(client as never, traces, evals, {
        existingId: 'c1',
        workspaceId: 'ws1',
      })
    ).toBe('c1');
    expect(client.update).toHaveBeenCalledWith(
      'correlations',
      'c1',
      expect.objectContaining({ correlationType: 'AgentEvals-Config-ws1' }),
      expect.anything()
    );
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('loads once into the store, and again when forced', async () => {
    const client = makeClient([evalsConfig]);
    expect(getEvalsDatasetState().config).toBeUndefined();
    await Promise.all([
      loadEvalsDataset(client as never, { workspaceId: 'ws1' }),
      loadEvalsDataset(client as never, { workspaceId: 'ws1' }),
    ]);
    expect(client.find).toHaveBeenCalledTimes(1);
    expect(getEvalsDatasetState().status).toBe('ready');
    expect(getEvalsDatasetState().config?.index).toBe('otel-v1-genai-evaluation*');
    expect(getEvalsDatasetState().configId).toBe('c1');
    await loadEvalsDataset(client as never, { force: true });
    expect(client.find).toHaveBeenCalledTimes(2);
  });

  it('records a failed lookup without throwing', async () => {
    const client = makeClient([]);
    client.find.mockRejectedValueOnce(new Error('forbidden'));
    const state = await loadEvalsDataset(client as never);
    expect(state).toMatchObject({ status: 'error', error: 'forbidden' });
    expect(state.config).toBeUndefined();
  });

  it('is the source of every evaluation query', () => {
    const index = 'my-evals-*';
    const queries = [
      buildAgentsQuery(index, 'all'),
      buildSuiteRunsQuery(index, 's'),
      buildRunCasesQuery(index, 'run-1'),
      buildCompareRunsQuery(index, 'a', 'b'),
      buildResultsPageQuery(index, EMPTY_RESULTS_FILTERS, { field: 'time', direction: 'desc' }, 0),
      buildTraceResultsQuery(index, ['t1']),
      buildTracesTallyQuery(index, ['t1']),
    ];
    queries.forEach((q) => expect(q.startsWith(`source = ${index} |`)).toBe(true));
    expect(evalsDataset(index).title).toBe(index);
  });
});

describe('data sources', () => {
  it('reads the data source an index pattern references', () => {
    const { dataSourceOf } = jest.requireActual('./eval_dataset');
    expect(dataSourceOf([{ id: 'ds-1', type: 'data-source', name: 'dataSource' }])).toEqual({
      id: 'ds-1',
      title: 'ds-1',
      type: 'OpenSearch',
    });
    expect(dataSourceOf([{ id: 'x', type: 'index-pattern' }])).toBeUndefined();
    expect(dataSourceOf(undefined)).toBeUndefined();
  });

  it('sends the evaluation and span queries to the config data sources', () => {
    const { evalsDataSourceOf, spansDataSourceOf } = jest.requireActual('./eval_dataset');
    const evalsDs = { id: 'e', title: 'e', type: 'OpenSearch' };
    const spansDs = { id: 's', title: 's', type: 'OpenSearch' };
    const config = {
      configId: 'c',
      index: 'otel-v1-genai-evaluation*',
      evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*', dataSource: evalsDs },
      tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*', dataSource: spansDs },
    };
    expect(evalsDataSourceOf(config)).toBe(evalsDs);
    expect(spansDataSourceOf(config)).toBe(spansDs);
    const local = { ...config, evaluationsDataset: { id: 'ev', title: 'x' } };
    expect(evalsDataSourceOf(local)).toBe(spansDs);
    expect(evalsDataSourceOf(undefined)).toBeUndefined();
  });

  it('puts the data source on the PPL datasets', () => {
    const ppl = jest.requireActual('./use_ppl_rows');
    const ds = { id: 'd1', title: 'd1', type: 'OpenSearch' };
    expect(ppl.evalsDataset('idx', ds)).toMatchObject({
      id: 'agent-evaluations-d1',
      dataSource: ds,
    });
    expect(ppl.spansDataset('spans', ds).dataSource).toBe(ds);
    expect(ppl.evalsLookupDataset('idx', ds).dataSource).toBe(ds);
    expect(ppl.evalsDataset('idx').dataSource).toBeUndefined();
  });
});
