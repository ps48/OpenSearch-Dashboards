/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { agentTracesUiSettings } from '../../../server/ui_settings';
import {
  currentEvalsIndexPattern,
  evalsConfigForTraces,
  findEvalsCorrelations,
  getEvalsDatasetState,
  listDatasets,
  loadEvalsConfigs,
  loadEvalsDataset,
  resetEvalsDatasetState,
  saveEvalsCorrelation,
} from './eval_dataset';
import {
  buildEvalFacetsQuery,
  buildEvalResultsQuery,
  buildRunDetailQuery,
  buildRunEventsQuery,
  buildTraceEvalsQuery,
  buildTracesEvalsQuery,
  evalsDataset,
} from './eval_data';
import { buildSameTargetQuery } from './result_flyout';
import { makeResult } from './eval_test_fixtures';

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

const evalsCorrelation = correlation(
  'c1',
  'trace-to-evaluations-otel-v1-apm-span*',
  'tr',
  'ev',
  'evaluationsDataset'
);
const logsCorrelation = correlation(
  'c0',
  'trace-to-logs-otel-v1-apm-span*',
  'tr',
  'lg',
  'logsDataset'
);

describe('evaluations dataset correlation', () => {
  afterEach(() => resetEvalsDatasetState());

  it('replaces the evaluations index advanced setting', () => {
    expect(agentTracesUiSettings['agentTraces:evaluationsIndexPattern']).toBeUndefined();
    expect(agentTracesUiSettings['agentTraces:evaluationRules']).toBeDefined();
  });

  it('reads trace-to-evaluations correlations only, resolving their references', async () => {
    const client = makeClient([logsCorrelation, evalsCorrelation]);
    expect(await findEvalsCorrelations(client as never)).toEqual([
      { correlationId: 'c1', tracesDatasetId: 'tr', evaluationsDatasetId: 'ev' },
    ]);
    const [config] = await loadEvalsConfigs(client as never);
    expect(config).toMatchObject({
      correlationId: 'c1',
      tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*' },
      evaluationsDataset: { id: 'ev', timeFieldName: 'time' },
      index: 'otel-v1-genai-evaluation*',
    });
  });

  it('skips correlations to a missing dataset or an index PPL cannot take', async () => {
    const client = makeClient([
      correlation('c2', 'trace-to-evaluations-x', 'tr', 'gone', 'evaluationsDataset'),
      correlation('c3', 'trace-to-evaluations-y', 'tr', 'bad', 'evaluationsDataset'),
    ]);
    expect(await loadEvalsConfigs(client as never)).toEqual([]);
  });

  it('lists datasets by signal type', async () => {
    const client = makeClient([]);
    const logs = await listDatasets(client as never, 'logs');
    expect(logs.map((d) => d.id).sort()).toEqual(['bad', 'ev', 'lg']);
    expect((await listDatasets(client as never, 'traces')).map((d) => d.id)).toEqual(['tr']);
  });

  it('saves the correlation in the trace-to-logs shape, or updates it in place', async () => {
    const client = makeClient([]);
    const traces = { id: 'tr', title: 'otel-v1-apm-span*' };
    const evals = { id: 'ev', title: 'otel-v1-genai-evaluation*' };
    expect(await saveEvalsCorrelation(client as never, traces, evals)).toBe('new-id');
    expect(client.create).toHaveBeenCalledWith(
      'correlations',
      {
        correlationType: 'trace-to-evaluations-otel-v1-apm-span*',
        title: 'trace-to-evaluations_otel-v1-apm-span*',
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
    expect(await saveEvalsCorrelation(client as never, traces, evals, 'c1')).toBe('c1');
    expect(client.update).toHaveBeenCalledWith(
      'correlations',
      'c1',
      expect.objectContaining({ correlationType: 'trace-to-evaluations-otel-v1-apm-span*' }),
      expect.anything()
    );
  });

  it('loads once into the store, and again when forced', async () => {
    const client = makeClient([evalsCorrelation]);
    expect(currentEvalsIndexPattern()).toBe('otel-v1-genai-evaluation-*');
    await Promise.all([loadEvalsDataset(client as never), loadEvalsDataset(client as never)]);
    expect(client.find).toHaveBeenCalledTimes(1);
    expect(getEvalsDatasetState().status).toBe('ready');
    expect(currentEvalsIndexPattern()).toBe('otel-v1-genai-evaluation*');
    expect(evalsConfigForTraces(getEvalsDatasetState(), 'tr')?.correlationId).toBe('c1');
    expect(evalsConfigForTraces(getEvalsDatasetState(), 'other')).toBeUndefined();
    await loadEvalsDataset(client as never, { force: true });
    expect(client.find).toHaveBeenCalledTimes(2);
  });

  it('records a failed lookup without throwing', async () => {
    const client = makeClient([]);
    client.find.mockRejectedValueOnce(new Error('forbidden'));
    const state = await loadEvalsDataset(client as never);
    expect(state).toMatchObject({ status: 'error', error: 'forbidden', configs: [] });
    // Agent Traces surfaces keep reading the default pattern.
    expect(currentEvalsIndexPattern()).toBe('otel-v1-genai-evaluation-*');
  });

  it('is the source of every evaluation query', () => {
    const index = 'my-evals-*';
    const queries = [
      buildEvalResultsQuery({}, 10, index),
      buildEvalFacetsQuery({}, index),
      buildTraceEvalsQuery('t1', undefined, 10, index),
      buildTracesEvalsQuery(['t1'], 10, index),
      buildRunEventsQuery(10, index),
      buildRunDetailQuery('run-1', 10, index),
      buildSameTargetQuery(makeResult({ traceId: 't1' }), 10, index) as string,
    ];
    queries.forEach((q) => expect(q.startsWith(`source = ${index} |`)).toBe(true));
    expect(evalsDataset(index).title).toBe(index);
  });
});
