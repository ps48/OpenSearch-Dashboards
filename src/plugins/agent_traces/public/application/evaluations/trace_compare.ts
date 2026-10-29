/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { PplRecord } from '../pages/sessions/session_utils';
import { readAttribute } from '../pages/traces/hooks/genai_message_preview';
import { parseEvalTime } from './eval_aggregations';

/**
 * Side-by-side comparison of two agent traces (the same test case in two runs): each trace
 * as an ordered list of steps (agent, model calls, tool calls), the two lists aligned, and
 * what differs between them.
 */

export type StepKind = 'agent' | 'llm' | 'tool' | 'other';

export interface TraceStep {
  spanId: string;
  parentSpanId?: string;
  kind: StepKind;
  /** Agent name, model, or tool name; the span name otherwise. */
  name: string;
  operation?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Tool call arguments and result, as compact text. */
  args?: string;
  result?: string;
  startMs: number;
  durationMs?: number;
  /** Error type or message when the span failed. */
  error?: string;
}

const AGENT_OPS = new Set(['invoke_agent', 'create_agent', 'invoke_workflow']);
const LLM_OPS = new Set([
  'chat',
  'text_completion',
  'generate_content',
  'embeddings',
  'completion',
  'inference',
]);
const TOOL_OPS = new Set(['execute_tool']);

const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Max characters kept for a tool argument or result. */
export const PREVIEW_MAX = 2000;

/** Compact one-line text for a value: JSON re-serialized without spaces, strings trimmed. */
export const compactText = (value: unknown, max = PREVIEW_MAX): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  let text: string;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    try {
      text =
        trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')
          ? JSON.stringify(JSON.parse(trimmed))
          : trimmed;
    } catch {
      text = trimmed;
    }
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

/** Stable form of a JSON value (sorted keys) to compare tool arguments. */
const canonical = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined;
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortKeys((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  try {
    return JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    return text;
  }
};

interface SpanEvent {
  name?: unknown;
  attributes?: Record<string, unknown>;
}

const eventsOf = (row: PplRecord): SpanEvent[] =>
  Array.isArray(row.events) ? (row.events as SpanEvent[]) : [];

/** Tool arguments: `gen_ai.tool.call.arguments`, else the tool message event (older instrumentations). */
const toolArgs = (row: PplRecord): unknown =>
  readAttribute(row, 'gen_ai.tool.call.arguments') ??
  eventsOf(row).find((e) => e.name === 'gen_ai.tool.message')?.attributes?.content;

const toolResult = (row: PplRecord): unknown =>
  readAttribute(row, 'gen_ai.tool.call.result') ??
  eventsOf(row).find((e) => e.name === 'gen_ai.choice')?.attributes?.message;

const errorOf = (row: PplRecord): string | undefined => {
  const status = row.status as Record<string, unknown> | undefined;
  const code = str(status?.code ?? row['status.code']);
  const errorType = str(readAttribute(row, 'error.type'));
  if (errorType) return errorType;
  if (code === '2' || code?.toLowerCase() === 'error') {
    return str(status?.message ?? row['status.message']) ?? 'error';
  }
  return undefined;
};

const kindOf = (operation: string | undefined): StepKind | undefined => {
  if (!operation) return undefined;
  if (AGENT_OPS.has(operation)) return 'agent';
  if (LLM_OPS.has(operation)) return 'llm';
  if (TOOL_OPS.has(operation)) return 'tool';
  return undefined;
};

export const spanToStep = (row: PplRecord, fallbackKind?: StepKind): TraceStep | undefined => {
  const operation = str(readAttribute(row, 'gen_ai.operation.name'));
  const error = errorOf(row);
  const kind = kindOf(operation) ?? (error || fallbackKind ? (fallbackKind ?? 'other') : undefined);
  if (!kind) return undefined;
  const model =
    str(readAttribute(row, 'gen_ai.response.model')) ??
    str(readAttribute(row, 'gen_ai.request.model'));
  const duration = num(row.durationInNanos);
  const spanName = String(row.name ?? '');
  const name =
    kind === 'agent'
      ? (str(readAttribute(row, 'gen_ai.agent.name')) ?? spanName)
      : kind === 'llm'
        ? (model ?? spanName)
        : kind === 'tool'
          ? (str(readAttribute(row, 'gen_ai.tool.name')) ?? spanName)
          : spanName;
  return {
    spanId: String(row.spanId ?? ''),
    parentSpanId: str(row.parentSpanId),
    kind,
    name,
    operation,
    model,
    inputTokens:
      num(readAttribute(row, 'gen_ai.usage.input_tokens')) ??
      num(readAttribute(row, 'gen_ai.usage.prompt_tokens')),
    outputTokens:
      num(readAttribute(row, 'gen_ai.usage.output_tokens')) ??
      num(readAttribute(row, 'gen_ai.usage.completion_tokens')),
    args: kind === 'tool' ? compactText(toolArgs(row)) : undefined,
    result: kind === 'tool' ? compactText(toolResult(row)) : undefined,
    startMs: parseEvalTime(str(row.startTime)),
    durationMs: duration !== undefined ? duration / 1e6 : undefined,
    error,
  };
};

/**
 * The steps of a trace in start order: agent invocations, model calls and tool calls, plus
 * any other span that failed. An agent span nested directly in an agent span of the same
 * name (an SDK wrapper around the framework's own span) is folded into its parent. A trace
 * without GenAI spans lists all of its spans.
 */
export const spansToSteps = (rows: PplRecord[]): TraceStep[] => {
  const sorted = [...rows].sort(
    (a, b) => parseEvalTime(str(a.startTime)) - parseEvalTime(str(b.startTime))
  );
  let steps = sorted.map((row) => spanToStep(row)).filter((s): s is TraceStep => !!s);
  if (steps.length === 0) {
    steps = sorted.map((row) => spanToStep(row, 'other')).filter((s): s is TraceStep => !!s);
  }
  const bySpan = new Map(steps.map((s) => [s.spanId, s]));
  return steps.filter((s) => {
    if (s.kind !== 'agent' || !s.parentSpanId) return true;
    const parent = bySpan.get(s.parentSpanId);
    if (!parent || parent.kind !== 'agent' || parent.name !== s.name) return true;
    parent.inputTokens = parent.inputTokens ?? s.inputTokens;
    parent.outputTokens = parent.outputTokens ?? s.outputTokens;
    parent.model = parent.model ?? s.model;
    parent.error = parent.error ?? s.error;
    return false;
  });
};

export interface TraceTotals {
  steps: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  tokens?: number;
  /** Root span duration, else first start to last end. */
  latencyMs?: number;
  errors: number;
}

const sum = (values: Array<number | undefined>): number | undefined => {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length ? known.reduce((s, v) => s + v, 0) : undefined;
};

export const traceTotals = (steps: TraceStep[], rows: PplRecord[] = []): TraceTotals => {
  const llm = steps.filter((s) => s.kind === 'llm');
  // Model calls carry the tokens; agents report the same tokens again, so only fall back.
  const tokenSteps = llm.some((s) => s.inputTokens !== undefined || s.outputTokens !== undefined)
    ? llm
    : steps.filter((s) => s.kind === 'agent' && !s.parentSpanId).slice(0, 1);
  const inputTokens = sum(tokenSteps.map((s) => s.inputTokens));
  const outputTokens = sum(tokenSteps.map((s) => s.outputTokens));
  const root = rows.find((r) => !str(r.parentSpanId));
  const rootDuration = root ? num(root.durationInNanos) : undefined;
  const starts = steps.map((s) => s.startMs).filter(Number.isFinite);
  const ends = steps
    .map((s) => s.startMs + (s.durationMs ?? 0))
    .filter((v): v is number => Number.isFinite(v));
  return {
    steps: steps.length,
    llmCalls: llm.length,
    toolCalls: steps.filter((s) => s.kind === 'tool').length,
    inputTokens,
    outputTokens,
    tokens:
      inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (outputTokens ?? 0),
    latencyMs:
      rootDuration !== undefined
        ? rootDuration / 1e6
        : starts.length && ends.length
          ? Math.max(...ends) - Math.min(...starts)
          : undefined,
    errors: steps.filter((s) => !!s.error).length,
  };
};

/**
 * - `same`: same step in both traces.
 * - `args`: same tool, different arguments.
 * - `changed`: a different step at this position (another tool, another model).
 * - `error`: the step failed in one trace (or both).
 * - `baseline_only` / `candidate_only`: an extra or missing step.
 */
export type StepDiff = 'same' | 'args' | 'changed' | 'error' | 'baseline_only' | 'candidate_only';

export interface AlignedStep {
  baseline?: TraceStep;
  candidate?: TraceStep;
  diff: StepDiff;
}

/** What makes two steps "the same step": kind and name (any model call matches any other). */
const signature = (s: TraceStep) => (s.kind === 'llm' ? 'llm' : `${s.kind}|${s.name}`);

const comparePair = (baseline: TraceStep, candidate: TraceStep): StepDiff => {
  if (baseline.error || candidate.error) return 'error';
  if (signature(baseline) !== signature(candidate)) return 'changed';
  if (baseline.kind === 'llm' && baseline.model !== candidate.model) return 'changed';
  if (baseline.kind === 'tool' && canonical(baseline.args) !== canonical(candidate.args)) {
    return 'args';
  }
  return 'same';
};

/** Unmatched steps between two matches: same-kind steps pair up, the rest are extra. */
const alignGap = (a: TraceStep[], b: TraceStep[]): AlignedStep[] => {
  const out: AlignedStep[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].kind === b[j].kind) {
      out.push({ baseline: a[i], candidate: b[j], diff: comparePair(a[i], b[j]) });
      i += 1;
      j += 1;
    } else if (i < a.length && (j >= b.length || !b.slice(j).some((s) => s.kind === a[i].kind))) {
      out.push({ baseline: a[i], diff: 'baseline_only' });
      i += 1;
    } else {
      out.push({ candidate: b[j], diff: 'candidate_only' });
      j += 1;
    }
  }
  return out;
};

/**
 * Aligns two step lists in order: the longest common subsequence of step signatures are the
 * matching steps; steps between matches are paired by kind or reported as extra.
 */
export const alignSteps = (baseline: TraceStep[], candidate: TraceStep[]): AlignedStep[] => {
  const n = baseline.length;
  const m = candidate.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        signature(baseline[i]) === signature(candidate[j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: AlignedStep[] = [];
  let gapA: TraceStep[] = [];
  let gapB: TraceStep[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (signature(baseline[i]) === signature(candidate[j])) {
      out.push(...alignGap(gapA, gapB));
      gapA = [];
      gapB = [];
      out.push({
        baseline: baseline[i],
        candidate: candidate[j],
        diff: comparePair(baseline[i], candidate[j]),
      });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      gapA.push(baseline[i]);
      i += 1;
    } else {
      gapB.push(candidate[j]);
      j += 1;
    }
  }
  out.push(...alignGap([...gapA, ...baseline.slice(i)], [...gapB, ...candidate.slice(j)]));
  return out;
};

export interface TraceDiffSummary {
  /** Tools called in one trace and never in the other. */
  toolsOnlyInBaseline: string[];
  toolsOnlyInCandidate: string[];
  /** Aligned positions per kind of difference. */
  counts: Record<StepDiff, number>;
}

export const summarizeDiff = (
  aligned: AlignedStep[],
  baseline: TraceStep[],
  candidate: TraceStep[]
): TraceDiffSummary => {
  const tools = (steps: TraceStep[]) =>
    new Set(steps.filter((s) => s.kind === 'tool').map((s) => s.name));
  const a = tools(baseline);
  const b = tools(candidate);
  const counts: Record<StepDiff, number> = {
    same: 0,
    args: 0,
    changed: 0,
    error: 0,
    baseline_only: 0,
    candidate_only: 0,
  };
  aligned.forEach((row) => {
    counts[row.diff] += 1;
  });
  return {
    toolsOnlyInBaseline: Array.from(a)
      .filter((t) => !b.has(t))
      .sort(),
    toolsOnlyInCandidate: Array.from(b)
      .filter((t) => !a.has(t))
      .sort(),
    counts,
  };
};

export interface StepMark {
  diff: StepDiff;
  /** Position of the step's row in the alignment. */
  index: number;
}

/** Each side's spans that are steps, with how their aligned row differs (for the graph view). */
export const stepMarks = (
  aligned: AlignedStep[]
): { baseline: Map<string, StepMark>; candidate: Map<string, StepMark> } => {
  const baseline = new Map<string, StepMark>();
  const candidate = new Map<string, StepMark>();
  aligned.forEach((row, index) => {
    if (row.baseline) baseline.set(row.baseline.spanId, { diff: row.diff, index });
    if (row.candidate) candidate.set(row.candidate.spanId, { diff: row.diff, index });
  });
  return { baseline, candidate };
};
