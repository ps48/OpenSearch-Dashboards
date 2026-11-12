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
 * - `data-source`: the dataset's data source is gone or does not answer.
 * Anything else is not classified (a real query error, shown as one).
 */
export type DataIssueKind = 'index-missing' | 'no-results' | 'field-missing' | 'data-source';

export interface DataIssue {
  kind: DataIssueKind;
  /** The missing field (`field-missing`). */
  field?: string;
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
const DATA_SOURCE =
  /Data Source Error|\[data-source\/[^\]]*\] not found|No Living connections|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|socket hang up|getaddrinfo/i;

/** The fields every evaluation event has: without them the indices hold no results. */
const EVENT_FIELDS = new Set<string>([F.eventName, F.time]);

/** The issue an error reports, else undefined (an error of another kind). */
export const classifyDataIssue = (error: unknown): DataIssue | undefined => {
  const text = textOf(error);
  if (!text) return undefined;
  // The data source first: its errors can quote the index or a field.
  if (DATA_SOURCE.test(text)) return { kind: 'data-source' };
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
