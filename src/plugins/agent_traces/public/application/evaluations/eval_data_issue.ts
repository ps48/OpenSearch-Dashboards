/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { F } from './ppl_queries';

/**
 * Why the evaluation results cannot be read, from a failed PPL or search response. One place
 * classifies them, so every page shows the same empty state instead of the raw error:
 * - `index-missing`: no index matches the evaluations dataset's pattern;
 * - `no-results`: the indices hold no evaluation events (empty, or no `eventName` /
 *   `@timestamp` in their mapping: nothing was ever sent);
 * - `field-missing`: the indices lack a field the queries name (created without the evaluation
 *   index template, which maps them all), `field` says which;
 * - `data-source`: the dataset's data source was deleted or does not answer;
 * - `data-source-auth`: the data source rejected its credentials, or they cannot be read;
 * - `unreachable`: the cluster (no data source: the local cluster) does not answer;
 * - `null-groups`: PPL drops groups with a null key (`buildNullGroupsCheckQuery`), so every count
 *   by an optional field would be wrong (not from an error).
 * Anything else is not classified (a real query error, or a bare timeout, shown as one).
 */
export type DataIssueKind =
  | 'index-missing'
  | 'no-results'
  | 'field-missing'
  | 'data-source'
  | 'data-source-auth'
  | 'unreachable'
  | 'null-groups';

export interface DataIssue {
  kind: DataIssueKind;
  /** The missing field (`field-missing`). */
  field?: string;
}

export interface ClassifyOptions {
  /**
   * The dataset reads through a data source. Without one, a connection error is about the local
   * cluster, not a data source.
   */
  dataSource?: boolean;
}

/** Every text an error carries: the message, a response body, nested reasons. */
const textOf = (error: unknown): string => {
  if (error === undefined || error === null) return '';
  if (typeof error === 'string') return error;
  const parts: unknown[] = [];
  if (typeof error === 'object') {
    const e = error as { message?: unknown; body?: unknown; attributes?: unknown };
    parts.push(e.message, e.body, e.attributes);
  }
  parts.push(error);
  return parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => {
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(' ');
};

const INDEX_MISSING = /no such index|index_not_found|IndexNotFound/i;
const FIELD_MISSING = [
  /Field \[([^\]]+)\] not found/i,
  /can't resolve Symbol\(namespace=FIELD_NAME, name=([^)]+)\)/i,
  /"requested_field"\s*:\s*"([^"]+)"/i,
];
/** Wrapped by the data source plugin (`DataSourceError`): about the data source itself. */
const DATA_SOURCE_ERROR = /Data Source Error|\[data-source\/[^\]]*\] not found/i;
/**
 * Credentials rejected (a 401, cast to 400, or a 403), not decryptable (`decodeAndDecrypt`), or
 * stored for another endpoint ("contaminated").
 */
const DATA_SOURCE_AUTH =
  /security_exception|unauthorized|forbidden|authentication|credential|encrypt|contaminated|"status(Code)?"\s*:\s*(401|403)/i;
/** No connection to the cluster. A bare timeout (ETIMEDOUT) is not classified: it may pass. */
const UNREACHABLE =
  /No Living connections|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up|getaddrinfo/i;

/** The fields every evaluation event has: without them the indices hold no results. */
const EVENT_FIELDS = new Set<string>([F.eventName, F.time]);

/** The issue an error reports, else undefined (an error of another kind). */
export const classifyDataIssue = (
  error: unknown,
  { dataSource = false }: ClassifyOptions = {}
): DataIssue | undefined => {
  const text = textOf(error);
  if (!text) return undefined;
  // The data source first: its errors can quote the index or a field.
  if (DATA_SOURCE_ERROR.test(text))
    return { kind: DATA_SOURCE_AUTH.test(text) ? 'data-source-auth' : 'data-source' };
  if (UNREACHABLE.test(text)) return { kind: dataSource ? 'data-source' : 'unreachable' };
  if (INDEX_MISSING.test(text)) return { kind: 'index-missing' };
  for (const pattern of FIELD_MISSING) {
    const match = pattern.exec(text);
    if (match) {
      const field = match[1].trim();
      return EVENT_FIELDS.has(field) ? { kind: 'no-results' } : { kind: 'field-missing', field };
    }
  }
  if (/FIELD_NOT_FOUND/.test(text)) return { kind: 'field-missing' };
  return undefined;
};

/** No index matches the pattern (the setup and Settings counts read it as "no results"). */
export const isIndexMissing = (error: unknown): boolean =>
  classifyDataIssue(error)?.kind === 'index-missing';

/**
 * The fields the aggregations of every page name (the verdict, the agent and version, the
 * evaluation): the app checks them once, so a missing one shows one empty state instead of an
 * error on each panel. Fields only some pages name are classified where they fail.
 */
export const CORE_FIELDS: string[] = [
  F.time,
  F.errorType,
  F.label,
  F.name,
  F.agentName,
  F.agentVersion,
];
