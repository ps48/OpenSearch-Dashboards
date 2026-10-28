/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { PplRecord } from '../pages/sessions/session_utils';
import { readAttribute } from '../pages/traces/hooks/genai_message_preview';
import { EvalResult } from './eval_data';
import { parseEvalTime } from './eval_aggregations';
import { SPANS_INDEX_PATTERN } from './eval_target';

/**
 * Where an evaluation's failures concentrate: its failing results joined to the spans they
 * judged (agent, operation, tools of the trace), grouped by agent, operation, tool, label
 * and run.
 */

/** Failing results read for a drill-down (the latest ones). */
export const DRILLDOWN_FAILURES_LIMIT = 500;
/** Trace ids per span lookup query. */
export const SPAN_LOOKUP_BATCH = 100;
/** Spans read per lookup query. */
export const SPAN_LOOKUP_LIMIT = 5000;

export interface SpanFacts {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  operation?: string;
  toolName?: string;
  agentName?: string;
  serviceName?: string;
}

const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

export const recordToSpanFacts = (row: PplRecord): SpanFacts => ({
  traceId: String(row.traceId ?? ''),
  spanId: String(row.spanId ?? ''),
  parentSpanId: str(row.parentSpanId),
  name: String(row.name ?? ''),
  operation: str(readAttribute(row, 'gen_ai.operation.name')),
  toolName: str(readAttribute(row, 'gen_ai.tool.name')),
  agentName: str(readAttribute(row, 'gen_ai.agent.name')),
  serviceName: str(row.serviceName),
});

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const OP = '`attributes.gen_ai.operation.name`';

/**
 * Root, agent and tool spans of a batch of traces, plus the judged spans: enough to name the
 * agent, the judged operation and the tools each trace called, without reading every span.
 */
export const buildFailureSpansQuery = (
  traceIds: string[],
  spanIds: string[],
  limit = SPAN_LOOKUP_LIMIT
): string => {
  const traces = traceIds.map((id) => `traceId = ${quote(id)}`).join(' or ');
  const kinds = [
    `${OP} = 'invoke_agent'`,
    `${OP} = 'execute_tool'`,
    `parentSpanId = ''`,
    ...spanIds.map((id) => `spanId = ${quote(id)}`),
  ].join(' or ');
  return [
    `source = ${SPANS_INDEX_PATTERN}`,
    `where (${traces}) and (${kinds})`,
    `fields traceId, spanId, parentSpanId, name, serviceName, ${OP}, \`attributes.gen_ai.tool.name\`, \`attributes.gen_ai.agent.name\``,
    `head ${limit}`,
  ].join(' | ');
};

/** The latest failing results, newest first, at most `limit`. */
export const latestFailures = (
  results: EvalResult[],
  limit = DRILLDOWN_FAILURES_LIMIT
): EvalResult[] =>
  results
    .filter((r) => r.outcome === 'fail')
    .sort((a, b) => parseEvalTime(b.time) - parseEvalTime(a.time))
    .slice(0, limit);

/** Batches of trace ids (and the judged span ids within them) for the span lookups. */
export const spanLookupBatches = (
  failures: EvalResult[],
  size = SPAN_LOOKUP_BATCH
): Array<{ traceIds: string[]; spanIds: string[] }> => {
  const byTrace = new Map<string, Set<string>>();
  failures.forEach((r) => {
    if (!r.traceId) return;
    const spans = byTrace.get(r.traceId) ?? new Set<string>();
    if (r.spanId) spans.add(r.spanId);
    byTrace.set(r.traceId, spans);
  });
  const ids = Array.from(byTrace.keys());
  const batches: Array<{ traceIds: string[]; spanIds: string[] }> = [];
  for (let i = 0; i < ids.length; i += size) {
    const traceIds = ids.slice(i, i + size);
    batches.push({
      traceIds,
      spanIds: Array.from(new Set(traceIds.flatMap((id) => Array.from(byTrace.get(id) ?? [])))),
    });
  }
  return batches;
};

export interface JoinedFailure {
  result: EvalResult;
  /** The judged span (span level), else the trace's agent span (trace level). */
  span?: SpanFacts;
  /** Agent or service the failure belongs to. */
  agent?: string;
  /** Operation of the judged span (`invoke_agent`, `chat`, `execute_tool`), else the level. */
  operation: string;
  /** Tools the judged trace called (the judged tool for a tool span). */
  tools: string[];
}

const AGENT_OPS = ['invoke_agent', 'create_agent', 'invoke_workflow'];

/** Joins each failing result to its span facts (trace id + span id, or the trace's agent). */
export const joinFailures = (failures: EvalResult[], spans: SpanFacts[]): JoinedFailure[] => {
  const byTrace = new Map<string, SpanFacts[]>();
  spans.forEach((s) => byTrace.set(s.traceId, [...(byTrace.get(s.traceId) ?? []), s]));
  return failures.map((result) => {
    const traceSpans = result.traceId ? (byTrace.get(result.traceId) ?? []) : [];
    const agentSpan =
      traceSpans.find((s) => AGENT_OPS.includes(s.operation ?? '') && !s.parentSpanId) ??
      traceSpans.find((s) => AGENT_OPS.includes(s.operation ?? '')) ??
      traceSpans.find((s) => !s.parentSpanId);
    const judged =
      result.spanId && result.level !== 'trace' && result.level !== 'session'
        ? traceSpans.find((s) => s.spanId === result.spanId)
        : undefined;
    const span = judged ?? (result.level === 'session' ? undefined : agentSpan);
    const traceTools = Array.from(
      new Set(
        traceSpans
          .filter((s) => s.operation === 'execute_tool' || !!s.toolName)
          .map((s) => s.toolName ?? s.name)
      )
    ).sort();
    const tools =
      judged && (judged.operation === 'execute_tool' || judged.toolName)
        ? [judged.toolName ?? judged.name]
        : traceTools;
    return {
      result,
      span,
      agent:
        result.agentName ??
        judged?.agentName ??
        agentSpan?.agentName ??
        span?.serviceName ??
        result.serviceName,
      operation: judged?.operation ?? (judged ? judged.name : result.level),
      tools,
    };
  });
};

export interface BreakdownEntry {
  key: string;
  /** Failures with this key. */
  count: number;
  /** Share of all failures (0..1). A failure can count under several tools. */
  share: number;
}

export type BreakdownDimension = 'agent' | 'operation' | 'tool' | 'label' | 'run';

export interface FailureBreakdown {
  total: number;
  /** Failures joined to a span (the rest judged sessions or spans not found). */
  joined: number;
  dimensions: Record<BreakdownDimension, BreakdownEntry[]>;
}

/** Placeholder keys, so a missing value is counted rather than dropped. */
export const NO_VALUE = {
  agent: '(unknown agent)',
  tool: '(no tool call)',
  label: '(no label)',
};

const PLACEHOLDERS = new Set<string>(Object.values(NO_VALUE));

const tally = (keysPerFailure: string[][], total: number): BreakdownEntry[] => {
  const counts = new Map<string, number>();
  keysPerFailure.forEach((keys) =>
    new Set(keys).forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1))
  );
  return (
    Array.from(counts.entries())
      .map(([key, count]) => ({ key, count, share: total ? count / total : 0 }))
      // Most failures first; placeholders ("no tool call") after real values of the same count.
      .sort(
        (a, b) =>
          b.count - a.count ||
          Number(PLACEHOLDERS.has(a.key)) - Number(PLACEHOLDERS.has(b.key)) ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      )
  );
};

export const breakdownFailures = (joined: JoinedFailure[]): FailureBreakdown => {
  const total = joined.length;
  const runs = joined.map((j) => (j.result.runId ? [j.result.runId] : []));
  return {
    total,
    joined: joined.filter((j) => !!j.span).length,
    dimensions: {
      agent: tally(
        joined.map((j) => [j.agent ?? NO_VALUE.agent]),
        total
      ),
      operation: tally(
        joined.map((j) => [j.operation]),
        total
      ),
      tool: tally(
        joined.map((j) => (j.tools.length ? j.tools : [NO_VALUE.tool])),
        total
      ),
      label: tally(
        joined.map((j) => [j.result.label ?? NO_VALUE.label]),
        total
      ),
      // Only failures that belong to a run: online results have no run.
      run: tally(runs, total),
    },
  };
};

export interface Concentration {
  dimension: BreakdownDimension;
  key: string;
  count: number;
  share: number;
}

/**
 * The most telling concentration of failures: the largest share one key holds, at least half
 * of the failures and at least two of them. A dimension only counts when it can tell things
 * apart: two or more keys among the failures, or (runs and agents) among all the results.
 * Placeholder keys never qualify.
 */
export const topConcentration = (
  breakdown: FailureBreakdown,
  population: EvalResult[] = [],
  minShare = 0.5
): Concentration | undefined => {
  if (breakdown.total < 2) return undefined;
  const distinct = (values: Array<string | undefined>) =>
    new Set(values.filter((v): v is string => !!v)).size;
  const populationKeys: Partial<Record<BreakdownDimension, number>> = {
    run: distinct(population.map((r) => r.runId)),
    agent: distinct(population.map((r) => r.agentName ?? r.serviceName)),
  };
  const order: BreakdownDimension[] = ['tool', 'run', 'agent', 'operation', 'label'];
  let best: Concentration | undefined;
  order.forEach((dimension) => {
    const entries = breakdown.dimensions[dimension];
    if (entries.length < 2 && (populationKeys[dimension] ?? 0) < 2) return;
    entries.forEach((e) => {
      if (PLACEHOLDERS.has(e.key) || e.count < 2 || e.share < minShare) return;
      if (!best || e.share > best.share) {
        best = { dimension, key: e.key, count: e.count, share: e.share };
      }
    });
  });
  return best;
};
