/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operational numbers of a test suite's recent runs, for the KPI cards of the suite page:
 * case latency (p50, p95), tokens and tool calls per case, and evaluator errors.
 *
 * Two reads, only while a suite is shown, and again only when its runs change (a new range,
 * filter or Refresh):
 * - the evaluations index: the test case events of the runs (duration, trace id) and the
 *   grades that failed to run (`error.type`);
 * - the span index: tokens and tool calls per case trace, in one `stats ... by traceId`.
 *
 * A part that cannot be read leaves its cards out; the others still show.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataPublicPluginStart } from '../../../../data/public';
import { PplRecord, pplResponseToRecords } from '../pages/sessions/session_utils';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import {
  EVAL_EVENT,
  EVAL_FIELDS,
  TEST_CASE_EVENT,
  createEvalsPplService,
  evalsDataset,
  recordToEvalResult,
  recordToTestCaseEvent,
} from './eval_data';
import type { RunSummary } from './eval_aggregations';
import { SPANS_INDEX_PATTERN, spansDataset } from './eval_target';

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const field = (f: string) => `\`${f}\``;

/** Runs a suite page reads its operational numbers for (newest last). */
export const SUITE_KPI_RUNS = 10;

/** One run's operational numbers; undefined when unknown. */
export interface RunKpis {
  runId: string;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  tokensPerCase?: number;
  toolCallsPerCase?: number;
  evaluatorErrors?: number;
}

export interface SuiteKpisState {
  loading: boolean;
  byRun: Map<string, RunKpis>;
  /** The span index could not be read: no tokens and tool calls. */
  spansUnavailable?: boolean;
  error?: string;
}

/** The suite's last runs in time order (oldest first), at most `SUITE_KPI_RUNS`. */
export const recentSuiteRuns = (runs: RunSummary[], suiteName: string | undefined) =>
  runs
    .filter((r) => (r.suiteName ?? '') === (suiteName ?? ''))
    .sort((a, b) => a.started - b.started)
    .slice(-SUITE_KPI_RUNS);

/** Test case events and failed grades of the runs, from the evaluations index. */
export const buildSuiteEventsQuery = (
  runIds: string[],
  index: string = AGENT_EVALS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    `where ${runIds.map((id) => `${field(EVAL_FIELDS.runId)} = ${quote(id)}`).join(' or ')}`,
    `where ${field(EVAL_FIELDS.eventName)} = ${quote(TEST_CASE_EVENT)} or (${field(
      EVAL_FIELDS.eventName
    )} = ${quote(EVAL_EVENT)} and isnotnull(${field(EVAL_FIELDS.errorType)}))`,
    `head 5000`,
  ].join(' | ');

/** Tokens and tool calls per trace, from the span index: one row per trace. */
export const buildTraceUsageQuery = (
  traceIds: string[],
  index: string = SPANS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    `where ${traceIds.map((id) => `traceId = ${quote(id)}`).join(' or ')}`,
    "eval evl_tool = if(`attributes.gen_ai.operation.name` = 'execute_tool', 1, 0)",
    'stats sum(`attributes.gen_ai.usage.input_tokens`) as evl_in, ' +
      'sum(`attributes.gen_ai.usage.output_tokens`) as evl_out, sum(evl_tool) as evl_tools by traceId',
  ].join(' | ');

/** Nearest-rank percentile of sorted numbers. */
export const percentile = (sorted: number[], p: number): number | undefined => {
  if (sorted.length === 0) return undefined;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
};

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? undefined : n;
};

interface TraceUsage {
  tokens?: number;
  tools?: number;
}

/** Per-run numbers from the case events, the failed grades and the per-trace usage. */
export const runKpisOf = (
  runIds: string[],
  eventRows: PplRecord[],
  usage?: Map<string, TraceUsage>
): Map<string, RunKpis> => {
  const durations = new Map<string, number[]>();
  const traces = new Map<string, Set<string>>();
  const errors = new Map<string, number>();
  eventRows.forEach((row) => {
    if (row.eventName === EVAL_EVENT) {
      const runId = recordToEvalResult(row).runId;
      if (runId) errors.set(runId, (errors.get(runId) ?? 0) + 1);
      return;
    }
    const e = recordToTestCaseEvent(row);
    if (!e) return;
    if (e.durationMs !== undefined) {
      durations.set(e.runId, [...(durations.get(e.runId) ?? []), e.durationMs]);
    }
    if (e.traceId) traces.set(e.runId, (traces.get(e.runId) ?? new Set()).add(e.traceId));
  });
  const byRun = new Map<string, RunKpis>();
  runIds.forEach((runId) => {
    const sorted = (durations.get(runId) ?? []).sort((a, b) => a - b);
    const kpis: RunKpis = {
      runId,
      latencyP50Ms: percentile(sorted, 50),
      latencyP95Ms: percentile(sorted, 95),
      evaluatorErrors: errors.get(runId) ?? 0,
    };
    const ids = Array.from(traces.get(runId) ?? []);
    const known = usage ? ids.map((id) => usage.get(id)).filter((u): u is TraceUsage => !!u) : [];
    if (known.length > 0) {
      const tokens = known.map((u) => u.tokens).filter((t): t is number => t !== undefined);
      if (tokens.length) kpis.tokensPerCase = tokens.reduce((a, b) => a + b, 0) / tokens.length;
      const tools = known.map((u) => u.tools ?? 0);
      kpis.toolCallsPerCase = tools.reduce((a, b) => a + b, 0) / tools.length;
    }
    byRun.set(runId, kpis);
  });
  return byRun;
};

/** Per-trace usage from the span `stats` rows. */
export const usageByTrace = (rows: PplRecord[]): Map<string, TraceUsage> => {
  const out = new Map<string, TraceUsage>();
  rows.forEach((row) => {
    const traceId = row.traceId as string | undefined;
    if (!traceId) return;
    const inTokens = num(row.evl_in);
    const outTokens = num(row.evl_out);
    out.set(traceId, {
      tokens:
        inTokens === undefined && outTokens === undefined
          ? undefined
          : (inTokens ?? 0) + (outTokens ?? 0),
      tools: num(row.evl_tools),
    });
  });
  return out;
};

const traceIdsOf = (rows: PplRecord[]) =>
  Array.from(
    new Set(
      rows
        .filter((r) => r.eventName !== EVAL_EVENT)
        .map((r) => recordToTestCaseEvent(r)?.traceId)
        .filter((id): id is string => !!id)
    )
  );

/** The suite's operational numbers, read while the suite is shown. */
export const useSuiteKpis = (
  data: DataPublicPluginStart,
  runs: RunSummary[],
  index: string = AGENT_EVALS_INDEX_PATTERN,
  spansIndex: string = SPANS_INDEX_PATTERN
): SuiteKpisState => {
  const runIds = useMemo(() => runs.map((r) => r.runId), [runs]);
  const key = JSON.stringify([runIds, index, spansIndex]);
  const [state, setState] = useState<SuiteKpisState>({ loading: true, byRun: new Map() });
  const loaded = useRef<{ key: string; runs: RunSummary[] }>();

  useEffect(() => {
    if (runIds.length === 0) {
      setState({ loading: false, byRun: new Map() });
      return;
    }
    // The same runs (a tab switch, a re-render): keep what was read.
    if (loaded.current && loaded.current.key === key && loaded.current.runs === runs) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const ppl = createEvalsPplService(data, undefined, controller.signal);
    (async () => {
      const eventRows = pplResponseToRecords(
        await ppl.executeQuery(evalsDataset(index), buildSuiteEventsQuery(runIds, index))
      );
      const traceIds = traceIdsOf(eventRows);
      let usage: Map<string, TraceUsage> | undefined;
      let spansUnavailable = traceIds.length === 0;
      if (traceIds.length) {
        try {
          usage = usageByTrace(
            pplResponseToRecords(
              await ppl.executeQuery(
                spansDataset(spansIndex),
                buildTraceUsageQuery(traceIds, spansIndex)
              )
            )
          );
        } catch {
          spansUnavailable = true;
        }
      }
      return { byRun: runKpisOf(runIds, eventRows, usage), spansUnavailable };
    })()
      .then(({ byRun, spansUnavailable }) => {
        if (controller.signal.aborted) return;
        loaded.current = { key, runs };
        setState({ loading: false, byRun, spansUnavailable });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, byRun: new Map(), error: String(e?.message ?? e) });
      });
    return () => controller.abort();
    // `key` holds the run ids and indices by value; `runs` changes on a new read only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, runs]);

  return state;
};
