/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { BehaviorSubject } from 'rxjs';
import { useObservable } from 'react-use';
import { SavedObjectsClientContract } from '../../../../../core/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';

/**
 * The evaluations dataset: a logs index pattern over the evaluation events, linked to a traces
 * dataset by a correlation saved object (type `correlations`), like the `trace-to-logs-*`
 * correlation of the trace flyout's logs and the `APM-Config-*` one of APM:
 *
 * ```
 * { correlationType: 'trace-to-evaluations-<traces title>', title, version: '1.0.0',
 *   entities: [{ tracesDataset: { id: 'references[0].id' } },
 *              { evaluationsDataset: { id: 'references[1].id' } }] }
 * references: [{ name: 'entities[0].index', type: 'index-pattern', id: <traces> },
 *              { name: 'entities[1].index', type: 'index-pattern', id: <evaluations> }]
 * ```
 *
 * The Agent Evaluations page reads the evaluations dataset's index pattern from it; without it
 * the page shows how to set one up.
 */

export const CORRELATION_TYPE = 'correlations';
export const EVALS_CORRELATION_PREFIX = 'trace-to-evaluations-';
/** The dataset "Create evaluations dataset" makes, as the observability stack does. */
export const EVALS_DATASET_TITLE = 'otel-v1-genai-evaluation*';
export const EVALS_DATASET_TIME_FIELD = 'time';
export const EVALS_DATASET_DISPLAY_NAME = 'Evaluation Dataset';
export const EVALS_SCHEMA_MAPPINGS = {
  otelLogs: { timestamp: 'time', traceId: 'traceId', spanId: 'spanId', serviceName: 'serviceName' },
};

export interface DatasetRef {
  id: string;
  title: string;
  displayName?: string;
  signalType?: string;
  timeFieldName?: string;
}

export interface EvalsDatasetConfig {
  correlationId: string;
  tracesDataset: DatasetRef;
  evaluationsDataset: DatasetRef;
  /** The PPL source the evaluation queries read: the evaluations dataset's index pattern. */
  index: string;
}

type Client = Pick<SavedObjectsClientContract, 'find' | 'get' | 'create' | 'update'>;

interface CorrelationEntity {
  [key: string]: { id?: string } | undefined;
}

interface CorrelationAttributes {
  correlationType?: string;
  title?: string;
  version?: string;
  entities?: CorrelationEntity[];
}

interface IndexPatternAttrs {
  title?: string;
  displayName?: string;
  signalType?: string;
  timeFieldName?: string;
}

/** An index pattern a PPL `source` clause takes as is (no spaces, pipes or quotes). */
export const isPplSafeIndex = (title: string) => /^[^\s|'"`]+$/.test(title);

export const datasetLabel = (d: Pick<DatasetRef, 'title' | 'displayName'>) =>
  d.displayName && d.displayName !== d.title ? `${d.displayName} (${d.title})` : d.title;

/** Index patterns, optionally of one signal type (`traces`, `logs`). */
export const listDatasets = async (client: Client, signalType?: string): Promise<DatasetRef[]> => {
  const res = await client.find<IndexPatternAttrs>({
    type: 'index-pattern',
    fields: ['title', 'displayName', 'signalType', 'timeFieldName'],
    perPage: 1000,
  });
  return res.savedObjects
    .map((o) => ({
      id: o.id,
      title: o.attributes?.title ?? o.id,
      displayName: o.attributes?.displayName,
      signalType: o.attributes?.signalType,
      timeFieldName: o.attributes?.timeFieldName,
    }))
    .filter((d) => !signalType || d.signalType === signalType)
    .sort((a, b) => datasetLabel(a).localeCompare(datasetLabel(b)));
};

/** The id an entity points at: `{ tracesDataset: { id: 'references[0].id' } }`. */
const entityRefId = (
  entities: CorrelationEntity[] | undefined,
  references: Array<{ id: string; name?: string }> | undefined,
  key: string
): string | undefined => {
  const index = (entities ?? []).findIndex((e) => !!e?.[key]);
  if (index < 0) return undefined;
  const pointer = entities?.[index]?.[key]?.id ?? '';
  const match = /^references\[(\d+)\]\.id$/.exec(pointer);
  if (match) return references?.[Number(match[1])]?.id;
  return references?.find((r) => r.name === `entities[${index}].index`)?.id ?? pointer;
};

export interface EvalsCorrelation {
  correlationId: string;
  tracesDatasetId?: string;
  evaluationsDatasetId?: string;
}

/** Every `trace-to-evaluations-*` correlation of the workspace. */
export const findEvalsCorrelations = async (client: Client): Promise<EvalsCorrelation[]> => {
  const res = await client.find<CorrelationAttributes>({
    type: CORRELATION_TYPE,
    perPage: 1000,
  });
  return res.savedObjects
    .filter((o) => (o.attributes?.correlationType ?? '').startsWith(EVALS_CORRELATION_PREFIX))
    .map((o) => ({
      correlationId: o.id,
      tracesDatasetId: entityRefId(o.attributes?.entities, o.references, 'tracesDataset'),
      evaluationsDatasetId: entityRefId(o.attributes?.entities, o.references, 'evaluationsDataset'),
    }));
};

const getDataset = async (client: Client, id: string): Promise<DatasetRef | undefined> => {
  try {
    const o = await client.get<IndexPatternAttrs>('index-pattern', id);
    if (!o || (o as { error?: unknown }).error || !o.attributes?.title) return undefined;
    return {
      id: o.id,
      title: o.attributes.title,
      displayName: o.attributes.displayName,
      signalType: o.attributes.signalType,
      timeFieldName: o.attributes.timeFieldName,
    };
  } catch {
    return undefined;
  }
};

/** The correlations whose datasets both exist, resolved. */
export const loadEvalsConfigs = async (client: Client): Promise<EvalsDatasetConfig[]> => {
  const correlations = await findEvalsCorrelations(client);
  const configs = await Promise.all(
    correlations.map(async (c) => {
      if (!c.tracesDatasetId || !c.evaluationsDatasetId) return undefined;
      const [tracesDataset, evaluationsDataset] = await Promise.all([
        getDataset(client, c.tracesDatasetId),
        getDataset(client, c.evaluationsDatasetId),
      ]);
      if (!tracesDataset || !evaluationsDataset) return undefined;
      if (!isPplSafeIndex(evaluationsDataset.title)) return undefined;
      return {
        correlationId: c.correlationId,
        tracesDataset,
        evaluationsDataset,
        index: evaluationsDataset.title,
      };
    })
  );
  return configs.filter((c): c is EvalsDatasetConfig => !!c);
};

export const correlationAttributes = (tracesTitle: string): CorrelationAttributes => ({
  correlationType: `${EVALS_CORRELATION_PREFIX}${tracesTitle}`,
  title: `trace-to-evaluations_${tracesTitle}`,
  version: '1.0.0',
  entities: [
    { tracesDataset: { id: 'references[0].id' } },
    { evaluationsDataset: { id: 'references[1].id' } },
  ],
});

export const correlationReferences = (tracesId: string, evaluationsId: string) => [
  { name: 'entities[0].index', type: 'index-pattern', id: tracesId },
  { name: 'entities[1].index', type: 'index-pattern', id: evaluationsId },
];

/** Creates the correlation, or updates `existingId` in place. Returns its id. */
export const saveEvalsCorrelation = async (
  client: Client,
  traces: DatasetRef,
  evaluations: DatasetRef,
  existingId?: string
): Promise<string> => {
  const attributes = correlationAttributes(traces.title);
  const references = correlationReferences(traces.id, evaluations.id);
  if (existingId) {
    await client.update(CORRELATION_TYPE, existingId, attributes, { references });
    return existingId;
  }
  const created = await client.create(CORRELATION_TYPE, attributes, { references });
  return created.id;
};

// ---------------------------------------------------------------------------------------
// Store: the workspace's evaluations dataset, loaded once and refreshed after a save
// ---------------------------------------------------------------------------------------

export interface EvalsDatasetState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The correlation the Evaluations page uses (the first); undefined: none configured. */
  config?: EvalsDatasetConfig;
  /** Every valid correlation (a workspace may correlate several traces datasets). */
  configs: EvalsDatasetConfig[];
  error?: string;
}

const IDLE: EvalsDatasetState = { status: 'idle', configs: [] };
const state$ = new BehaviorSubject<EvalsDatasetState>(IDLE);
let inflight: Promise<EvalsDatasetState> | undefined;

export const getEvalsDatasetState = () => state$.getValue();

/** For tests. */
export const resetEvalsDatasetState = (next: EvalsDatasetState = IDLE) => {
  inflight = undefined;
  state$.next(next);
};

/** Loads the correlations (once; again with `force`). Never rejects: errors land in state. */
export const loadEvalsDataset = (
  client: Client,
  { force = false }: { force?: boolean } = {}
): Promise<EvalsDatasetState> => {
  const now = state$.getValue();
  if (!force && (now.status === 'ready' || now.status === 'error')) return Promise.resolve(now);
  if (!force && inflight) return inflight;
  state$.next({ ...now, status: 'loading' });
  const run = loadEvalsConfigs(client)
    .then((configs) => ({ status: 'ready' as const, config: configs[0], configs }))
    .catch((error: unknown) => ({
      status: 'error' as const,
      configs: [],
      error: error instanceof Error ? error.message : String(error),
    }))
    .then((next) => {
      if (inflight === run) {
        inflight = undefined;
        state$.next(next);
      }
      return next;
    });
  inflight = run;
  return run;
};

/** The evaluations dataset state; loads it on first use. */
export const useEvalsDataset = (options: { force?: boolean } = {}) => {
  const { services } = useOpenSearchDashboards<{
    savedObjects?: { client?: SavedObjectsClientContract };
  }>();
  const client = services?.savedObjects?.client;
  const state = useObservable(state$, state$.getValue());
  useEffect(() => {
    if (client) loadEvalsDataset(client, options);
    // Load once per mount; `force` is read on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  return {
    ...state,
    /** No saved objects client (tests, embedded): nothing to configure, use the default. */
    unavailable: !client,
    refresh: () => (client ? loadEvalsDataset(client, { force: true }) : Promise.resolve(state)),
  };
};

/**
 * The index the Agent Traces surfaces (the Evaluations column, the trace and session flyouts)
 * read evaluation results from: the correlated evaluations dataset, else the default pattern,
 * so results still show where no correlation was set up. Undefined while loading, so nothing
 * is queried twice.
 */
export const useEvalsIndexPattern = (): string | undefined => {
  const { status, config, unavailable } = useEvalsDataset();
  if (unavailable) return AGENT_EVALS_INDEX_PATTERN;
  if (status === 'ready' || status === 'error') return config?.index ?? AGENT_EVALS_INDEX_PATTERN;
  return undefined;
};

/** The same, read now (for callbacks): the default until the correlation is loaded. */
export const currentEvalsIndexPattern = (): string =>
  state$.getValue().config?.index ?? AGENT_EVALS_INDEX_PATTERN;

/** The evaluations dataset correlated with this traces dataset, if any. */
export const evalsConfigForTraces = (
  state: EvalsDatasetState,
  tracesDatasetId: string | undefined
): EvalsDatasetConfig | undefined =>
  tracesDatasetId ? state.configs.find((c) => c.tracesDataset.id === tracesDatasetId) : undefined;
