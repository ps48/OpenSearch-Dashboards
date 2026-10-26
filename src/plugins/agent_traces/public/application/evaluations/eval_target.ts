/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataset } from '../../../../data/common';
import { AGENT_TRACES_SESSION_ID_FIELD } from '../../../common';
import { PplRecord, pplResponseToRecords } from '../pages/sessions/session_utils';
import { readAttribute } from '../pages/traces/hooks/genai_message_preview';
import { isMarkedAiRoot } from '../utils/ai_root';
import { EvalResult } from './eval_data';
import { parseEvalTime } from './eval_aggregations';

/**
 * The judged target of an evaluation result, read from the span index: the span for span and
 * tool-call results, the agent (AI root) span of the trace for trace results, and the
 * session's traces for session results.
 */

export const SPANS_INDEX_PATTERN = 'otel-v1-apm-span-*';

/**
 * Spans are looked up by id, so without a time field: a result often lands minutes or days
 * after the span it judged, outside the page's time range.
 */
export const EVAL_SPANS_DATASET: Dataset = {
  id: 'agent-evaluations-spans',
  title: SPANS_INDEX_PATTERN,
  type: 'INDEXES',
};

/** Max spans read for a trace-level target (to find its agent span). */
export const TRACE_SPANS_LIMIT = 500;
/** Max spans read for a session-level target (its traces' root and agent spans). */
export const SESSION_SPANS_LIMIT = 1000;

export interface TargetSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  operation?: string;
  agentName?: string;
  serviceName?: string;
  toolName?: string;
  startTime: string;
  /** Epoch millis of `startTime`. */
  startMs: number;
  durationMs?: number;
  status?: string;
  input?: unknown;
  output?: unknown;
  toolArguments?: unknown;
  toolResult?: unknown;
  conversationId?: string;
}

export interface JudgedTarget {
  level: string;
  /** The judged span (span and tool-call level) or the trace's agent span (trace level). */
  span?: TargetSpan;
  /** The trace's root span, when it is not the judged span. */
  root?: TargetSpan;
  /** Session level: one representative span per trace, earliest first. */
  traces?: TargetSpan[];
  /** More spans exist than were read. */
  partial?: boolean;
}

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const source = `source = ${SPANS_INDEX_PATTERN}`;

export const buildSpanQuery = (traceId: string, spanId: string): string =>
  `${source} | where traceId = ${quote(traceId)} and spanId = ${quote(spanId)} | head 1`;

export const buildTraceSpansQuery = (traceId: string, limit = TRACE_SPANS_LIMIT): string =>
  `${source} | where traceId = ${quote(traceId)} | sort startTime | head ${limit}`;

/** GenAI spans of a session; the session id is set on the agent spans of each turn. */
export const buildSessionSpansQuery = (sessionId: string, limit = SESSION_SPANS_LIMIT): string =>
  `${source} | where \`${AGENT_TRACES_SESSION_ID_FIELD}\` = ${quote(
    sessionId
  )} | sort startTime | head ${limit}`;

const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

export const recordToTargetSpan = (row: PplRecord): TargetSpan => {
  const attr = (key: string) => readAttribute(row, key);
  const status = row.status as Record<string, unknown> | undefined;
  const statusCode = str(status?.code ?? row['status.code']);
  const duration = Number(row.durationInNanos);
  const startTime = String(row.startTime ?? '');
  return {
    traceId: String(row.traceId ?? ''),
    spanId: String(row.spanId ?? ''),
    parentSpanId: str(row.parentSpanId),
    name: String(row.name ?? ''),
    operation: str(attr('gen_ai.operation.name')),
    agentName: str(attr('gen_ai.agent.name')),
    serviceName: str(row.serviceName),
    toolName: str(attr('gen_ai.tool.name')),
    startTime,
    startMs: parseEvalTime(startTime),
    durationMs: Number.isFinite(duration) ? duration / 1e6 : undefined,
    status: statusCode === '2' ? 'error' : statusCode === '1' ? 'ok' : statusCode,
    input: attr('gen_ai.input.messages'),
    output: attr('gen_ai.output.messages'),
    toolArguments: attr('gen_ai.tool.call.arguments'),
    toolResult: attr('gen_ai.tool.call.result'),
    conversationId: str(attr(AGENT_TRACES_SESSION_ID_FIELD.replace(/^attributes\./, ''))),
  };
};

const AGENT_OPERATIONS = ['invoke_agent', 'create_agent', 'invoke_workflow'];

/**
 * The span that represents a trace for an agent user: a span marked as AI root, else the
 * outermost agent invocation, else the outermost GenAI span, else the root span.
 */
export const pickAgentSpan = (rows: PplRecord[]): { span?: TargetSpan; root?: TargetSpan } => {
  const spans = rows.map((row) => ({ row, span: recordToTargetSpan(row) }));
  const root = spans.find((s) => !s.span.parentSpanId)?.span;
  const byStart = [...spans].sort((a, b) => a.span.startMs - b.span.startMs);
  const pick =
    byStart.find((s) => isMarkedAiRoot(s.row))?.span ??
    byStart.find((s) => AGENT_OPERATIONS.includes(s.span.operation ?? ''))?.span ??
    byStart.find((s) => !!s.span.operation)?.span ??
    root ??
    byStart[0]?.span;
  return { span: pick, root: root && root !== pick ? root : undefined };
};

/** One agent span per trace of a session, earliest trace first. */
export const pickSessionTraces = (rows: PplRecord[]): TargetSpan[] => {
  const byTrace = new Map<string, PplRecord[]>();
  rows.forEach((row) => {
    const id = String(row.traceId ?? '');
    byTrace.set(id, [...(byTrace.get(id) ?? []), row]);
  });
  return Array.from(byTrace.values())
    .map((traceRows) => pickAgentSpan(traceRows).span)
    .filter((s): s is TargetSpan => !!s)
    .sort((a, b) => a.startMs - b.startMs);
};

export interface QueryRunner {
  executeQuery(dataset: Dataset, query: string): Promise<unknown>;
}

const run = async (ppl: QueryRunner, query: string) =>
  pplResponseToRecords(await ppl.executeQuery(EVAL_SPANS_DATASET, query));

/** Fetch what the result judged. Resolves to an empty target when nothing is found. */
export const fetchJudgedTarget = async (
  ppl: QueryRunner,
  result: EvalResult
): Promise<JudgedTarget> => {
  const level = result.level;
  if (level === 'session' && result.sessionId) {
    const rows = await run(ppl, buildSessionSpansQuery(result.sessionId));
    return {
      level,
      traces: pickSessionTraces(rows),
      partial: rows.length >= SESSION_SPANS_LIMIT,
    };
  }
  if (result.traceId && result.spanId && level !== 'trace') {
    const rows = await run(ppl, buildSpanQuery(result.traceId, result.spanId));
    return { level, span: rows[0] ? recordToTargetSpan(rows[0]) : undefined };
  }
  if (result.traceId) {
    const rows = await run(ppl, buildTraceSpansQuery(result.traceId));
    // A trace result emitted inside a span is still about the whole trace: show its agent span.
    return { level, ...pickAgentSpan(rows), partial: rows.length >= TRACE_SPANS_LIMIT };
  }
  return { level };
};
