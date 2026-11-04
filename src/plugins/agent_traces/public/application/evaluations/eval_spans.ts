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
import { PplRecord, get, str } from './eval_model';
import { SF, buildRootSpansQuery, buildSessionRootsQuery, buildSpanQuery } from './eval_ppl';
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

/** The root spans of one or two traces (one query, `head 1` / `head 2`); none: nothing runs. */
export const useRootSpans = (traceIds: Array<string | undefined>): SpanIOState => {
  const { spans, refreshKey } = useEvalContext();
  const ids = [...new Set(traceIds.filter((id): id is string => !!id))];
  const query = ids.length ? buildRootSpansQuery(spans.title, ids) : undefined;
  const { rows, loading, loaded, error } = usePplRows(spans, query, undefined, refreshKey);
  const byTrace = useMemo(() => {
    const map = new Map<string, SpanIO>();
    rows.forEach((row) => {
      const io = spanIOOf(row);
      if (io.traceId) map.set(io.traceId, io);
    });
    return map;
  }, [rows]);
  return { byTrace, loading, loaded, error };
};

/** One span (a span-level result's judged span); undefined ids: nothing runs. */
export const useSpan = (
  traceId?: string,
  spanId?: string
): { span?: SpanIO; loading: boolean; loaded: boolean; error?: string } => {
  const { spans, refreshKey } = useEvalContext();
  const query = traceId && spanId ? buildSpanQuery(spans.title, traceId, spanId) : undefined;
  const { rows, loading, loaded, error } = usePplRows(spans, query, undefined, refreshKey);
  const span = useMemo(() => (rows[0] ? spanIOOf(rows[0]) : undefined), [rows]);
  return { span, loading, loaded, error };
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
