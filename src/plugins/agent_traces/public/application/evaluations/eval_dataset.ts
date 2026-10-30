/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { BehaviorSubject } from 'rxjs';
import { useObservable } from 'react-use';
import { SavedObjectsClientContract } from '../../../../../core/public';
import { getWorkspaceIdFromUrl } from '../../../../../core/public/utils';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';

/**
 * The Agent Evaluations app config: the traces dataset and the evaluations dataset (a logs
 * index pattern over the evaluation events), one per workspace, stored like APM's
 * `APM-Config-<workspace>` as a saved object of type `correlations`:
 *
 * ```
 * { correlationType: 'AgentEvals-Config-<workspace id, or default>', title: 'AgentEvals-Config',
 *   version: '1.0.0',
 *   entities: [{ tracesDataset: { id: 'references[0].id' } },
 *              { evaluationsDataset: { id: 'references[1].id' } }] }
 * references: [{ name: 'entities[0].index', type: 'index-pattern', id: <traces> },
 *              { name: 'entities[1].index', type: 'index-pattern', id: <evaluations> }]
 * ```
 *
 * The Agent Evaluations page reads the evaluations dataset's index pattern and the traces
 * dataset's from it; without it the page shows how to set one up.
 */

export const CORRELATION_TYPE = 'correlations';
export const EVALS_CONFIG_PREFIX = 'AgentEvals-Config-';
export const EVALS_CONFIG_TITLE = 'AgentEvals-Config';
/** The workspace part of the config's type without workspaces. */
export const NO_WORKSPACE_ID = 'default';
/** The dataset "Create evaluations dataset" makes, as the observability stack does. */
export const EVALS_DATASET_TITLE = 'otel-v1-genai-evaluation*';
export const EVALS_DATASET_TIME_FIELD = 'time';
export const EVALS_DATASET_DISPLAY_NAME = 'Evaluation Dataset';
export const EVALS_SCHEMA_MAPPINGS = {
  otelLogs: {
    timestamp: 'time',
    traceId: 'traceId',
    spanId: 'spanId',
    serviceName: 'serviceName',
  },
};

export interface DatasetRef {
  id: string;
  title: string;
  displayName?: string;
  signalType?: string;
  timeFieldName?: string;
}

export interface EvalsDatasetConfig {
  /** The `AgentEvals-Config-*` saved object. */
  configId: string;
  /** The traces dataset span lookups read; undefined when it no longer exists. */
  tracesDataset?: DatasetRef;
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

/** The config's correlation type in a workspace (`default` without workspaces). */
export const evalsConfigType = (workspaceId?: string) =>
  `${EVALS_CONFIG_PREFIX}${workspaceId || NO_WORKSPACE_ID}`;

export interface EvalsConfigObject {
  configId: string;
  tracesDatasetId?: string;
  evaluationsDatasetId?: string;
}

/**
 * The workspace's `AgentEvals-Config-*` object: the one of this workspace's type, else the
 * first of the prefix (saved objects are listed per workspace already), as APM reads its own.
 */
export const findEvalsConfig = async (
  client: Client,
  workspaceId?: string
): Promise<EvalsConfigObject | undefined> => {
  const res = await client.find<CorrelationAttributes>({
    type: CORRELATION_TYPE,
    perPage: 1000,
  });
  const configs = res.savedObjects.filter((o) =>
    (o.attributes?.correlationType ?? '').startsWith(EVALS_CONFIG_PREFIX)
  );
  const type = evalsConfigType(workspaceId);
  const o = configs.find((c) => c.attributes?.correlationType === type) ?? configs[0];
  if (!o) return undefined;
  return {
    configId: o.id,
    tracesDatasetId: entityRefId(o.attributes?.entities, o.references, 'tracesDataset'),
    evaluationsDatasetId: entityRefId(o.attributes?.entities, o.references, 'evaluationsDataset'),
  };
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

export interface LoadedEvalsConfig {
  /** The saved config, when its evaluations dataset exists and PPL can take its pattern. */
  config?: EvalsDatasetConfig;
  /** The saved object, whatever its datasets: Settings updates it in place. */
  configId?: string;
}

/** The workspace's config with its datasets resolved. */
export const loadEvalsConfig = async (
  client: Client,
  workspaceId?: string
): Promise<LoadedEvalsConfig> => {
  const found = await findEvalsConfig(client, workspaceId);
  if (!found) return {};
  const [tracesDataset, evaluationsDataset] = await Promise.all([
    found.tracesDatasetId ? getDataset(client, found.tracesDatasetId) : undefined,
    found.evaluationsDatasetId ? getDataset(client, found.evaluationsDatasetId) : undefined,
  ]);
  if (!evaluationsDataset || !isPplSafeIndex(evaluationsDataset.title)) {
    return { configId: found.configId };
  }
  return {
    configId: found.configId,
    config: {
      configId: found.configId,
      tracesDataset,
      evaluationsDataset,
      index: evaluationsDataset.title,
    },
  };
};

export const evalsConfigAttributes = (workspaceId?: string): CorrelationAttributes => ({
  correlationType: evalsConfigType(workspaceId),
  title: EVALS_CONFIG_TITLE,
  version: '1.0.0',
  entities: [
    { tracesDataset: { id: 'references[0].id' } },
    { evaluationsDataset: { id: 'references[1].id' } },
  ],
});

export const evalsConfigReferences = (tracesId: string, evaluationsId: string) => [
  { name: 'entities[0].index', type: 'index-pattern', id: tracesId },
  { name: 'entities[1].index', type: 'index-pattern', id: evaluationsId },
];

/** Creates the workspace's config, or updates `existingId` in place. Returns its id. */
export const saveEvalsConfig = async (
  client: Client,
  traces: DatasetRef,
  evaluations: DatasetRef,
  { existingId, workspaceId }: { existingId?: string; workspaceId?: string } = {}
): Promise<string> => {
  const attributes = evalsConfigAttributes(workspaceId);
  const references = evalsConfigReferences(traces.id, evaluations.id);
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
  /** The workspace's config; undefined: none configured (or its evaluations dataset is gone). */
  config?: EvalsDatasetConfig;
  /** The saved config object, even when its datasets do not resolve. */
  configId?: string;
  error?: string;
}

const IDLE: EvalsDatasetState = { status: 'idle' };
const state$ = new BehaviorSubject<EvalsDatasetState>(IDLE);
let inflight: Promise<EvalsDatasetState> | undefined;

export const getEvalsDatasetState = () => state$.getValue();

/** For tests. */
export const resetEvalsDatasetState = (next: EvalsDatasetState = IDLE) => {
  inflight = undefined;
  state$.next(next);
};

/** Loads the config (once; again with `force`). Never rejects: errors land in state. */
export const loadEvalsDataset = (
  client: Client,
  { force = false, workspaceId }: { force?: boolean; workspaceId?: string } = {}
): Promise<EvalsDatasetState> => {
  const now = state$.getValue();
  if (!force && (now.status === 'ready' || now.status === 'error')) return Promise.resolve(now);
  if (!force && inflight) return inflight;
  state$.next({ ...now, status: 'loading' });
  const run = loadEvalsConfig(client, workspaceId)
    .then((loaded): EvalsDatasetState => ({ status: 'ready', ...loaded }))
    .catch((error: unknown): EvalsDatasetState => ({
      status: 'error',
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

interface EvalsDatasetServices {
  savedObjects?: { client?: SavedObjectsClientContract };
  workspaces?: { currentWorkspaceId$?: { getValue?: () => string | undefined } };
  http?: { basePath?: { serverBasePath?: string } };
}

/** The current workspace, from the workspaces service, else the URL (`/w/<id>/app/...`). */
export const currentWorkspaceId = (services?: EvalsDatasetServices): string | undefined => {
  const fromService = services?.workspaces?.currentWorkspaceId$?.getValue?.();
  if (fromService) return fromService;
  if (typeof window === 'undefined') return undefined;
  return (
    getWorkspaceIdFromUrl(window.location.href, services?.http?.basePath?.serverBasePath ?? '') ||
    undefined
  );
};

/** The evaluations dataset state; loads it on first use. */
export const useEvalsDataset = (options: { force?: boolean } = {}) => {
  const { services } = useOpenSearchDashboards<EvalsDatasetServices>();
  const client = services?.savedObjects?.client;
  const workspaceId = currentWorkspaceId(services);
  const state = useObservable(state$, state$.getValue());
  useEffect(() => {
    if (client) loadEvalsDataset(client, { ...options, workspaceId });
    // Load once per mount; `force` is read on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceId]);
  return {
    ...state,
    workspaceId,
    /** No saved objects client (tests, embedded): nothing to configure, use the default. */
    unavailable: !client,
    refresh: () =>
      client ? loadEvalsDataset(client, { force: true, workspaceId }) : Promise.resolve(state),
  };
};

/**
 * The index the Agent Traces surfaces (the Evaluations column, the trace and session flyouts)
 * read evaluation results from: the config's evaluations dataset, else the default pattern,
 * so results still show where no config was set up. Undefined while loading, so nothing
 * is queried twice.
 */
export const useEvalsIndexPattern = (): string | undefined => {
  const { status, config, unavailable } = useEvalsDataset();
  if (unavailable) return AGENT_EVALS_INDEX_PATTERN;
  if (status === 'ready' || status === 'error') return config?.index ?? AGENT_EVALS_INDEX_PATTERN;
  return undefined;
};

/** The same, read now (for callbacks): the default until the config is loaded. */
export const currentEvalsIndexPattern = (): string =>
  state$.getValue().config?.index ?? AGENT_EVALS_INDEX_PATTERN;
