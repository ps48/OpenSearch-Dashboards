/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { Dataset } from '../../../../data/common';
import { DataPublicPluginStart } from '../../../../data/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import {
  isExecuteToolSpan,
  previewSpanInput,
  previewSpanOutput,
  readAttribute,
} from '../pages/traces/hooks/genai_message_preview';
import {
  AI_ROOT_FIELD,
  aiRootWithFallbackOf,
  ensureAiRootFieldChecked,
  hasAiRootField,
  isAiRootFieldChecked,
  useAiRootFieldVersion,
} from '../utils/ai_root';
import { PplRecord, get, str } from './eval_model';
import {
  SF,
  buildAiRootCandidatesQuery,
  buildMarkedSpansQuery,
  buildResultSpansQuery,
  buildSessionRootsQuery,
} from './ppl_queries';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';

/** What a span received and returned, as text (GenAI messages, else tool arguments / result). */
export interface SpanIO {
  traceId?: string;
  name?: string;
  input?: string;
  output?: string;
  /** The raw attribute values (GenAI messages JSON), for the formatted / JSON views. */
  rawInput?: unknown;
  rawOutput?: unknown;
}

/**
 * A span document (or its `fields` columns): `gen_ai.input.messages` /
 * `gen_ai.output.messages`, else `gen_ai.tool.call.arguments` / `.result`; on `execute_tool`
 * spans the tool's arguments and result first.
 */
export const spanIOOf = (row: PplRecord): SpanIO => {
  const doc = row as Record<string, unknown>;
  const span = {
    input: readAttribute(doc, 'gen_ai.input.messages'),
    output: readAttribute(doc, 'gen_ai.output.messages'),
    rawDocument: doc,
  };
  const tool = isExecuteToolSpan(span);
  const args = readAttribute(doc, 'gen_ai.tool.call.arguments');
  const result = readAttribute(doc, 'gen_ai.tool.call.result');
  return {
    traceId: str(get(row, SF.traceId)),
    name: str(row.name),
    input: previewSpanInput(span) || undefined,
    output: previewSpanOutput(span) || undefined,
    // On execute_tool spans the tool's arguments and result come first (as in Agent Traces):
    // some instrumentations also put messages there, holding only a tool_call part.
    rawInput: tool ? (args ?? span.input) : (span.input ?? args),
    rawOutput: tool ? (result ?? span.output) : (span.output ?? result),
  };
};

export interface SpanIOState {
  /** By trace id (root spans). */
  byTrace: Map<string, SpanIO>;
  loading: boolean;
  loaded: boolean;
  error?: string;
}

/** What a result judged: a span by its id, else its trace (whose AI root shows). */
export interface JudgedTarget {
  traceId?: string;
  spanId?: string;
}

/**
 * The AI root among span rows of one trace (`buildAiRootCandidatesQuery` and
 * `buildMarkedSpansQuery`, or `buildSessionRootsQuery`), by the rule the trace flyout uses too
 * (`aiRootWithFallbackOf`): a GenAI or marked root, else the earliest outermost marked span; else
 * the earliest outermost GenAI span (an agent behind an HTTP handler, without the marker); else
 * the root.
 */
export const aiRootSpanOf = (rows: PplRecord[]): PplRecord | undefined => {
  // PPL rows name fields flat or nested: the ones the rule reads are put where it looks.
  const spans = rows.map((row) => {
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    return {
      row,
      spanId: str(get(row, SF.spanId)),
      parentSpanId: str(get(row, SF.parentSpanId)) ?? '',
      rawDocument: {
        ...(row as Record<string, unknown>),
        startTime: get(row, SF.startTime),
        attributes: {
          ...attributes,
          'gen_ai.operation.name': attributes['gen_ai.operation.name'] ?? get(row, SF.operation),
          'derived.gen_ai.is_root': attributes['derived.gen_ai.is_root'] ?? get(row, AI_ROOT_FIELD),
        },
      },
    };
  });
  return aiRootWithFallbackOf(spans)?.row;
};

/** The rows of `more` whose span is not in `rows` yet, after `rows`. */
const withSpans = (rows: PplRecord[], more: PplRecord[]): PplRecord[] => {
  if (!more.length) return rows;
  const ids = new Set(rows.map((r) => str(get(r, SF.spanId))));
  return [...rows, ...more.filter((r) => !ids.has(str(get(r, SF.spanId))))];
};

/**
 * What one or two results judged (case input and output, the result flyout): the span each
 * points to (one query by exact trace and span id), else, without a span id, its trace's AI root
 * (`aiRootSpanOf` on one candidates query per such trace and, once the marker is known to be
 * mapped, one query for their marked spans), so an agent behind an HTTP handler shows the agent
 * span, not the handler. Keyed by trace id; at most two targets; none: nothing runs.
 */
export const useJudgedSpans = (targets: JudgedTarget[]): SpanIOState => {
  const { spans, refreshKey } = useEvalContext();
  const seen = new Set<string>();
  const unique = targets
    .filter((t): t is JudgedTarget & { traceId: string } => !!t.traceId)
    .filter((t) => {
      const key = `${t.traceId}|${t.spanId ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
  const refs = unique.filter((t): t is { traceId: string; spanId: string } => !!t.spanId);
  const bare = unique.filter((t) => !t.spanId).map((t) => t.traceId);
  const marker = useAiRootMarker(spans, bare.length > 0, refreshKey);
  const bySpan = usePplRows(
    spans,
    refs.length ? buildResultSpansQuery(spans.title, refs) : undefined,
    undefined,
    refreshKey
  );
  // Fixed hook slots: two traces at most.
  const rootA = usePplRows(
    spans,
    bare[0] ? buildAiRootCandidatesQuery(spans.title, bare[0]) : undefined,
    undefined,
    refreshKey
  );
  const rootB = usePplRows(
    spans,
    bare[1] ? buildAiRootCandidatesQuery(spans.title, bare[1]) : undefined,
    undefined,
    refreshKey
  );
  const marked = usePplRows(
    spans,
    bare.length && marker ? buildMarkedSpansQuery(spans.title, bare) : undefined,
    undefined,
    refreshKey
  );
  const bareKey = bare.join('\n');
  const byTrace = useMemo(() => {
    const traceIds = bareKey.split('\n');
    const map = new Map<string, SpanIO>();
    bySpan.rows.forEach((row) => {
      const io = spanIOOf(row);
      if (io.traceId) map.set(io.traceId, io);
    });
    [rootA.rows, rootB.rows].forEach((rows, i) => {
      const own = marked.rows.filter((r) => str(get(r, SF.traceId)) === traceIds[i]);
      const root = aiRootSpanOf(withSpans(rows, own));
      const io = root ? spanIOOf(root) : undefined;
      if (io?.traceId && !map.has(io.traceId)) map.set(io.traceId, io);
    });
    return map;
  }, [bareKey, bySpan.rows, rootA.rows, rootB.rows, marked.rows]);
  const parts = [
    ...(refs.length ? [bySpan] : []),
    ...(bare[0] ? [rootA] : []),
    ...(bare[1] ? [rootB] : []),
    ...(bare.length && marker ? [marked] : []),
  ];
  const waiting = bare.length > 0 && marker === undefined;
  return {
    byTrace,
    loading: waiting || parts.some((p) => p.loading),
    loaded: !waiting && parts.length > 0 && parts.every((p) => p.loaded),
    error: parts.find((p) => p.error)?.error,
  };
};

/**
 * Whether the span index maps the AI-root marker, checked once per dataset as Agent Traces does
 * (`ensureAiRootFieldChecked`, shared cache); undefined until the check has run, and after a
 * failed check the last cached answer, else false. No dataset: nothing runs.
 */
export const useAiRootMarker = (
  dataset: Dataset | undefined,
  enabled = true,
  refreshKey = 0
): boolean | undefined => {
  const { services } = useOpenSearchDashboards<{ data: DataPublicPluginStart }>();
  const data = services?.data;
  // Re-renders when a check changes what is known (here or in Agent Traces).
  useAiRootFieldVersion();
  const key = enabled && dataset ? `${dataset.id}|${dataset.title}` : undefined;
  // The last answered check of this dataset: kept while the cache is re-checked.
  const [known, setKnown] = useState<{ key: string; present: boolean }>();
  useEffect(() => {
    if (!key || !dataset) return;
    let live = true;
    const ppl = data ? new PPLService(data) : undefined;
    ensureAiRootFieldChecked(ppl, dataset, `source = ${dataset.title}`).then(() => {
      // An answered check says whether the marker is mapped. A failed probe (a timeout, a 5xx)
      // falls back to the last answer cached for the dataset, else to unmapped: the queries never
      // name the marker then, so they stay valid and GenAI roots still show; the next answered
      // probe (Refresh, or after the cache period) adds the marked spans.
      if (live) setKnown({ key, present: hasAiRootField(dataset.id) });
    });
    return () => {
      live = false;
    };
    // The dataset is identified by its id and title (in `key`); Refresh probes again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, refreshKey]);
  if (!key) return undefined;
  // Nothing to check with (no data service): the marker is not named.
  if (!data) return hasAiRootField(dataset?.id);
  if (isAiRootFieldChecked(dataset?.id)) return hasAiRootField(dataset?.id);
  return known?.key === key ? known.present : undefined;
};

/**
 * One turn per trace among `buildSessionRootsQuery` rows (oldest first): the trace's AI root
 * (`aiRootSpanOf`): its GenAI or marked root, else its earliest outermost marked span.
 */
export const sessionTurnsOf = (rows: PplRecord[]): PplRecord[] => {
  const byTrace = new Map<string, PplRecord[]>();
  rows.forEach((row) => {
    const traceId = str(get(row, SF.traceId)) ?? '';
    byTrace.set(traceId, [...(byTrace.get(traceId) ?? []), row]);
  });
  return [...byTrace.values()]
    .map((traceRows) => aiRootSpanOf(traceRows))
    .filter((row): row is PplRecord => !!row)
    .sort((a, b) =>
      String(get(a, SF.startTime) ?? '').localeCompare(String(get(b, SF.startTime) ?? ''))
    );
};

/**
 * A session's turns (one AI-root span per trace, oldest first); no id: nothing runs. The query
 * waits for the AI-root marker check, so it names the marker only when it is mapped.
 */
export const useSessionTurns = (
  conversationId?: string
): { turns: SpanIO[]; loading: boolean; loaded: boolean; error?: string } => {
  const { spans, refreshKey } = useEvalContext();
  const marker = useAiRootMarker(spans, !!conversationId, refreshKey);
  const query =
    conversationId && marker !== undefined
      ? buildSessionRootsQuery(spans.title, conversationId, marker)
      : undefined;
  const { rows, loading, loaded, error } = usePplRows(spans, query, undefined, refreshKey);
  const turns = useMemo(() => sessionTurnsOf(rows).map(spanIOOf), [rows]);
  return { turns, loading: loading || (!!conversationId && marker === undefined), loaded, error };
};
