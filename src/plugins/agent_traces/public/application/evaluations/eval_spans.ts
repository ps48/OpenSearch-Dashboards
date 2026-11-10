/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import {
  previewSpanInput,
  previewSpanOutput,
  readAttribute,
} from '../pages/traces/hooks/genai_message_preview';
import { AI_ROOT_FIELD, aiRootsOf, isGenAiSpanDocument } from '../utils/ai_root';
import { PplRecord, get, str } from './eval_model';
import {
  SF,
  buildAiRootCandidatesQuery,
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
 * `gen_ai.output.messages`, else `gen_ai.tool.call.arguments` / `.result`.
 */
export const spanIOOf = (row: PplRecord): SpanIO => {
  const doc = row as Record<string, unknown>;
  const span = {
    input: readAttribute(doc, 'gen_ai.input.messages'),
    output: readAttribute(doc, 'gen_ai.output.messages'),
    rawDocument: doc,
  };
  return {
    traceId: str(get(row, SF.traceId)),
    name: str(row.name),
    input: previewSpanInput(span) || undefined,
    output: previewSpanOutput(span) || undefined,
    rawInput: span.input ?? readAttribute(doc, 'gen_ai.tool.call.arguments'),
    rawOutput: span.output ?? readAttribute(doc, 'gen_ai.tool.call.result'),
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
 * The AI root among `buildAiRootCandidatesQuery` rows (earliest first), by Agent Traces' rule
 * (`aiRootsOf`): a GenAI or marked root, else the earliest marked span; else the earliest GenAI
 * span (an agent behind an HTTP handler, without the marker); else the root.
 */
export const aiRootSpanOf = (rows: PplRecord[]): PplRecord | undefined => {
  // PPL rows name fields flat or nested: the two the rule reads are put where it looks.
  const spans = rows.map((row) => {
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    return {
      row,
      parentSpanId: str(get(row, SF.parentSpanId)) ?? '',
      rawDocument: {
        ...(row as Record<string, unknown>),
        attributes: {
          ...attributes,
          'gen_ai.operation.name': attributes['gen_ai.operation.name'] ?? get(row, SF.operation),
          'derived.gen_ai.is_root': attributes['derived.gen_ai.is_root'] ?? get(row, AI_ROOT_FIELD),
        },
      },
    };
  });
  return (
    aiRootsOf(spans)[0]?.row ??
    spans.find((s) => isGenAiSpanDocument(s.rawDocument))?.row ??
    spans.find((s) => !s.parentSpanId)?.row
  );
};

/**
 * What one or two results judged (case input and output, the result flyout): the span each
 * points to (one query by exact trace and span id), else, without a span id, its trace's AI root
 * (one query per such trace, `aiRootSpanOf`), so an agent behind an HTTP handler shows the
 * agent span, not the handler. Keyed by trace id; at most two targets; none: nothing runs.
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
  const byTrace = useMemo(() => {
    const map = new Map<string, SpanIO>();
    bySpan.rows.forEach((row) => {
      const io = spanIOOf(row);
      if (io.traceId) map.set(io.traceId, io);
    });
    [rootA.rows, rootB.rows].forEach((rows) => {
      const root = aiRootSpanOf(rows);
      const io = root ? spanIOOf(root) : undefined;
      if (io?.traceId && !map.has(io.traceId)) map.set(io.traceId, io);
    });
    return map;
  }, [bySpan.rows, rootA.rows, rootB.rows]);
  const parts = [
    ...(refs.length ? [bySpan] : []),
    ...(bare[0] ? [rootA] : []),
    ...(bare[1] ? [rootB] : []),
  ];
  return {
    byTrace,
    loading: parts.some((p) => p.loading),
    loaded: parts.length > 0 && parts.every((p) => p.loaded),
    error: parts.find((p) => p.error)?.error,
  };
};

/** A session's turns (its root spans, oldest first); no id: nothing runs. */
export const useSessionTurns = (
  conversationId?: string
): { turns: SpanIO[]; loading: boolean; loaded: boolean; error?: string } => {
  const { spans, refreshKey } = useEvalContext();
  const query = conversationId ? buildSessionRootsQuery(spans.title, conversationId) : undefined;
  const { rows, loading, loaded, error } = usePplRows(spans, query, undefined, refreshKey);
  const turns = useMemo(() => rows.map(spanIOOf), [rows]);
  return { turns, loading, loaded, error };
};
