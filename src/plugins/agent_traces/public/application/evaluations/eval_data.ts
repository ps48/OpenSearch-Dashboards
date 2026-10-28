/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataset, TimeRange } from '../../../../data/common';
import { DataPublicPluginStart } from '../../../../data/public';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { pplResponseToRecords, PplRecord } from '../pages/sessions/session_utils';
import {
  Clause,
  EvalOutcome,
  RuleEntry,
  VERDICT_COLUMN,
  builtinRange,
  getActiveClauses,
  getActiveRuleEntries,
  ruleFor,
  verdictEvalPpl,
  verdictOf,
} from './eval_verdict';

export type { EvalOutcome } from './eval_verdict';

/**
 * Evaluation results are OTel `gen_ai.evaluation.result` log events, one document per result
 * in `otel-v1-genai-evaluation-*`. Data Prepper keeps the OTel log record shape and adds
 * `attributes.derived.*` fields that normalize the level, the source and the session across
 * producers (the OpenSearch GenAI SDKs, Bedrock AgentCore, any OTel evaluator).
 */
export const evalsDataset = (index: string = AGENT_EVALS_INDEX_PATTERN): Dataset => ({
  id: 'agent-evaluations',
  title: index,
  type: 'INDEXES',
  timeFieldName: '@timestamp',
});

export const EVALS_DATASET: Dataset = evalsDataset();

/**
 * The index holds three event kinds, told apart by `eventName`: grades
 * (`gen_ai.evaluation.result`), and for offline runs one event per test case and one per run.
 * Every query that reads grades filters on `EVAL_EVENT` (Data Prepper sets `eventName` on
 * grades copied from the deprecated span carrier too).
 */
export const EVAL_EVENT = 'gen_ai.evaluation.result';
export const TEST_CASE_EVENT = 'opensearch.test_case.result';
export const TEST_SUITE_RUN_EVENT = 'opensearch.test_suite_run.result';

/** PPL field names. Only fields mapped by the index template may appear in `where`. */
export const EVAL_FIELDS = {
  time: '@timestamp',
  eventName: 'eventName',
  traceId: 'traceId',
  spanId: 'spanId',
  name: 'attributes.gen_ai.evaluation.name',
  value: 'attributes.gen_ai.evaluation.score.value',
  label: 'attributes.gen_ai.evaluation.score.label',
  explanation: 'attributes.gen_ai.evaluation.explanation',
  level: 'attributes.derived.evaluation.level',
  source: 'attributes.derived.evaluation.source',
  targetTraceId: 'attributes.derived.evaluation.target_trace_id',
  sessionId: 'attributes.derived.session.id',
  suiteName: 'attributes.test.suite.name',
  runId: 'attributes.test.suite.run.id',
  caseId: 'attributes.test.case.id',
  caseName: 'attributes.test.case.name',
  caseStatus: 'attributes.test.case.result.status',
  evaluatorName: 'attributes.opensearch.evaluation.evaluator.name',
  assessment: 'attributes.opensearch.evaluation.assessment',
  threshold: 'attributes.opensearch.evaluation.score.threshold',
  direction: 'attributes.opensearch.evaluation.score.direction',
  scoreMin: 'attributes.opensearch.evaluation.score.min',
  scoreMax: 'attributes.opensearch.evaluation.score.max',
  errorType: 'attributes.error.type',
  evaluatorType: 'attributes.opensearch.evaluation.evaluator.type',
  scope: 'instrumentationScope.name',
} as const;

export type EvalLevel = 'span' | 'trace' | 'session' | 'tool_call' | string;

export interface EvalResult {
  /** Stable key: time + target + name. */
  id: string;
  time: string;
  name: string;
  value?: number;
  label?: string;
  explanation?: string;
  level: EvalLevel;
  /** `opensearch-sdk`, `agentcore` or `otel`. */
  source: string;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
  responseId?: string;
  errorType?: string;
  /** Evaluator identity: the instrumentation scope, or our evaluator attributes. */
  evaluator: string;
  evaluatorVersion?: string;
  evaluatorType?: string;
  direction?: 'maximize' | 'minimize';
  /** Producer verdict, `opensearch.evaluation.assessment` (`pass` or `fail`). */
  assessment?: string;
  /** Producer pass threshold, `opensearch.evaluation.score.threshold`. */
  threshold?: number;
  scoreMin?: number;
  scoreMax?: number;
  judgeTraceId?: string;
  agentName?: string;
  /** service.name of the producer (the agent for AgentCore, the evaluator for SDK evals). */
  serviceName?: string;
  suiteName?: string;
  runId?: string;
  caseId?: string;
  caseName?: string;
  caseStatus?: string;
  /** AgentCore online evaluation config, when the result came from AgentCore. */
  onlineConfig?: string;
  /** AgentCore evaluator rating scale (`Numerical`, `Categorical`). */
  ratingScale?: string;
  /** Session results from AgentCore: the first and last trace the evaluation covered. */
  startTraceId?: string;
  endTraceId?: string;
  outcome: EvalOutcome;
}

const get = (obj: unknown, path: string): unknown => {
  // Attributes keep OTel's dotted keys in the document; PPL returns them as nested structs.
  if (obj === null || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  if (path in record) return record[path];
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Verdict of a result under the declared rules (see `eval_verdict.ts`): evaluator error, the
 * rules setting, the producer's assessment or threshold, built-in rules for known evaluators;
 * neutral ("Scored") when none decides.
 */
export const outcomeOf = (
  r: Omit<EvalResult, 'outcome' | 'id'>,
  clauses: Clause[] = getActiveClauses()
): EvalOutcome =>
  verdictOf(
    {
      name: r.name,
      value: r.value,
      label: r.label,
      errorType: r.errorType,
      assessment: r.assessment,
      threshold: r.threshold,
      direction: r.direction,
      source: r.source,
    },
    clauses
  );

/**
 * Declared score range and direction of a result: the rules setting, else the producer's
 * attributes, else a known evaluator's scale. Values within 0..1 without a declared range
 * are read as 0..1. Undefined when the range is unknown.
 */
export const scaleOf = (
  r: Pick<EvalResult, 'name' | 'value' | 'scoreMin' | 'scoreMax' | 'direction'>,
  rules: RuleEntry[] = getActiveRuleEntries()
): { min: number; max: number; direction: 'maximize' | 'minimize' } | undefined => {
  const rule = ruleFor(rules, r.name);
  const builtin = builtinRange(r.name);
  const direction = rule?.direction ?? r.direction ?? 'maximize';
  let min = rule?.min ?? r.scoreMin ?? builtin?.min;
  let max = rule?.max ?? r.scoreMax ?? builtin?.max;
  if (min === undefined && max === undefined && r.value !== undefined) {
    if (r.value >= 0 && r.value <= 1) {
      min = 0;
      max = 1;
    }
  }
  if (min === undefined || max === undefined || max <= min) return undefined;
  return { min, max, direction };
};

/** Normalized 0..1 score for charts (higher is better), when the result has a value and a
 *  known range; pass and fail count as 1 and 0 for results without a value. */
export const normalizedScore = (r: EvalResult): number | undefined => {
  if (r.value === undefined) return r.outcome === 'pass' ? 1 : r.outcome === 'fail' ? 0 : undefined;
  const scale = scaleOf(r);
  if (!scale) return undefined;
  const n = Math.min(1, Math.max(0, (r.value - scale.min) / (scale.max - scale.min)));
  return scale.direction === 'minimize' ? 1 - n : n;
};

/** `maximize` or `minimize` for an evaluation: the setting, else what its results declare. */
export const directionOf = (
  name: string,
  results: Array<Pick<EvalResult, 'direction'>>,
  rules: RuleEntry[] = getActiveRuleEntries()
): 'maximize' | 'minimize' =>
  ruleFor(rules, name)?.direction ??
  (results.some((r) => r.direction === 'minimize') ? 'minimize' : 'maximize');

export const recordToEvalResult = (row: PplRecord): EvalResult => {
  const attrs = row.attributes as Record<string, unknown> | undefined;
  const a = (key: string) => get(attrs, key) ?? row[`attributes.${key}`];
  const scope = row.instrumentationScope as Record<string, unknown> | undefined;
  const resource = row.resource as Record<string, unknown> | undefined;
  const traceId = str(row.traceId) ?? str(a('derived.evaluation.target_trace_id'));
  const spanId = str(row.spanId);
  const name = str(a('gen_ai.evaluation.name')) ?? '(unnamed)';
  const level = (str(a('derived.evaluation.level')) ?? (spanId ? 'span' : 'trace')).toLowerCase();
  const time = str(row['@timestamp']) ?? str(row.time) ?? '';
  const direction = str(a('opensearch.evaluation.score.direction'))?.toLowerCase();
  const agentcoreEvaluator = str(a('aws.bedrock_agentcore.evaluator.arn'));
  const base = {
    time,
    name,
    value: num(a('gen_ai.evaluation.score.value')),
    label: str(a('gen_ai.evaluation.score.label')),
    explanation: str(a('gen_ai.evaluation.explanation')),
    level,
    source: str(a('derived.evaluation.source')) ?? 'otel',
    traceId,
    spanId,
    sessionId:
      str(a('derived.session.id')) ?? str(a('gen_ai.conversation.id')) ?? str(a('session.id')),
    responseId: str(a('gen_ai.response.id')),
    errorType: str(a('error.type')),
    evaluator:
      str(a('opensearch.evaluation.evaluator.name')) ??
      (agentcoreEvaluator ? agentcoreEvaluator.split('/').pop() : undefined) ??
      str(get(scope, 'name')) ??
      'unknown',
    evaluatorVersion:
      str(a('opensearch.evaluation.evaluator.version')) ?? str(get(scope, 'version')),
    evaluatorType:
      str(a('opensearch.evaluation.evaluator.type')) ??
      (agentcoreEvaluator ? 'llm_judge' : undefined),
    direction: direction === 'minimize' || direction === 'maximize' ? direction : undefined,
    assessment: str(a('opensearch.evaluation.assessment'))?.toLowerCase(),
    threshold: num(a('opensearch.evaluation.score.threshold')),
    scoreMin: num(a('opensearch.evaluation.score.min')),
    scoreMax: num(a('opensearch.evaluation.score.max')),
    judgeTraceId: str(a('opensearch.evaluation.judge.trace_id')),
    agentName: str(a('gen_ai.agent.name')),
    serviceName: str(get(get(resource, 'attributes'), 'service.name')) ?? str(row.serviceName),
    suiteName: str(a('test.suite.name')),
    runId: str(a('test.suite.run.id')),
    caseId: str(a('test.case.id')),
    caseName: str(a('test.case.name')),
    caseStatus: str(a('test.case.result.status')),
    onlineConfig: str(a('aws.bedrock_agentcore.online_evaluation_config.name')),
    ratingScale: str(a('aws.bedrock_agentcore.evaluator.rating_scale')),
    startTraceId: str(a('aws.bedrock_agentcore.evaluation_start_trace_id')),
    endTraceId: str(a('aws.bedrock_agentcore.evaluation_end_trace_id')),
  };
  return {
    ...base,
    id: `${time}|${traceId ?? ''}|${spanId ?? ''}|${base.sessionId ?? ''}|${name}`,
    outcome: outcomeOf(base),
  };
};

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const field = (f: string) => `\`${f}\``;

/** `where` clause that keeps grades only (not test case or run events). */
export const EVAL_EVENT_WHERE = `${field(EVAL_FIELDS.eventName)} = ${quote(EVAL_EVENT)}`;

export interface EvalFilters {
  names?: string[];
  levels?: string[];
  sources?: string[];
  labels?: string[];
  traceIds?: string[];
  sessionIds?: string[];
  runIds?: string[];
  /** Only results that belong to an evaluation run (`test.suite.run.id` is set). */
  runsOnly?: boolean;
  /** Only failing results (the verdict is computed in the query). */
  failingOnly?: boolean;
  /** Only results with these verdicts. */
  outcomes?: EvalOutcome[];
  /** Only results whose value is below or above a bound. */
  valueBelow?: number;
  valueAbove?: number;
  /** Free text matched against name, label and explanation. */
  search?: string;
}

/** `where` clauses for the filters. Only mapped fields are referenced. */
export const buildEvalWhere = (
  filters: EvalFilters = {},
  missing: ReadonlySet<string> = new Set()
): string[] => {
  const clauses: string[] = [EVAL_EVENT_WHERE, `${field(EVAL_FIELDS.name)} != ''`];
  const anyOf = (f: string, values?: string[]) => {
    if (values && values.length > 0) {
      clauses.push(`(${values.map((v) => `${field(f)} = ${quote(v)}`).join(' or ')})`);
    }
  };
  anyOf(EVAL_FIELDS.name, filters.names);
  anyOf(EVAL_FIELDS.level, filters.levels);
  anyOf(EVAL_FIELDS.source, filters.sources);
  anyOf(EVAL_FIELDS.label, filters.labels);
  anyOf(EVAL_FIELDS.targetTraceId, filters.traceIds);
  anyOf(EVAL_FIELDS.sessionId, filters.sessionIds);
  anyOf(EVAL_FIELDS.runId, filters.runIds);
  if (filters.runsOnly) clauses.push(`isnotnull(${field(EVAL_FIELDS.runId)})`);
  if (filters.valueBelow !== undefined && Number.isFinite(filters.valueBelow)) {
    clauses.push(
      missing.has(EVAL_FIELDS.value)
        ? 'false'
        : `${field(EVAL_FIELDS.value)} < ${Number(filters.valueBelow)}`
    );
  }
  if (filters.valueAbove !== undefined && Number.isFinite(filters.valueAbove)) {
    clauses.push(
      missing.has(EVAL_FIELDS.value)
        ? 'false'
        : `${field(EVAL_FIELDS.value)} > ${Number(filters.valueAbove)}`
    );
  }
  if (filters.search?.trim()) {
    // `like` is case-insensitive; `%` and `_` typed by the user act as wildcards.
    const q = quote(`%${filters.search.trim()}%`);
    clauses.push(
      `(${[EVAL_FIELDS.name, EVAL_FIELDS.label, EVAL_FIELDS.explanation]
        .map((f) => `like(${field(f)}, ${q})`)
        .join(' or ')})`
    );
  }
  return clauses;
};

/** The verdicts a filter keeps, if it narrows them. */
export const outcomesFilter = (filters: EvalFilters): EvalOutcome[] | undefined => {
  if (filters.outcomes?.length) return filters.outcomes;
  if (filters.failingOnly) return ['fail'];
  return undefined;
};

/**
 * `source`, the filters as `where` clauses, and the verdict: an `eval` adding the
 * `evl_verdict` column (always with `withVerdict`, else when the filters narrow verdicts)
 * and a `where` on it. `missing`: fields the index does not map (see `executeEvalPpl`).
 */
export const buildEvalCommands = (
  filters: EvalFilters = {},
  index: string = AGENT_EVALS_INDEX_PATTERN,
  options: { missing?: ReadonlySet<string>; clauses?: Clause[]; withVerdict?: boolean } = {}
): string[] => {
  const missing = options.missing ?? new Set<string>();
  const outcomes = outcomesFilter(filters);
  const commands = [
    `source = ${index}`,
    ...buildEvalWhere(filters, missing).map((c) => `where ${c}`),
  ];
  if (options.withVerdict || outcomes) {
    commands.push(verdictEvalPpl(options.clauses ?? getActiveClauses(), missing));
  }
  if (outcomes) {
    commands.push(`where ${outcomes.map((o) => `${VERDICT_COLUMN} = '${o}'`).join(' or ')}`);
  }
  return commands;
};

export const buildEvalResultsQuery = (
  filters: EvalFilters = {},
  limit = 500,
  index: string = AGENT_EVALS_INDEX_PATTERN,
  missing: ReadonlySet<string> = new Set()
): string =>
  [
    ...buildEvalCommands(filters, index, { missing }),
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');

/** Result counts per evaluation name, level and source: the filter options and the total. */
export const buildEvalFacetsQuery = (
  filters: EvalFilters = {},
  index: string = AGENT_EVALS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    ...buildEvalWhere(filters).map((c) => `where ${c}`),
    `stats count() as results by ${field(EVAL_FIELDS.name)}, ${field(EVAL_FIELDS.level)}, ${field(
      EVAL_FIELDS.source
    )}`,
  ].join(' | ');

/** Results that judged a trace, its spans, or its session. */
export const buildTraceEvalsQuery = (
  traceId: string,
  sessionId?: string,
  limit = 200,
  index: string = AGENT_EVALS_INDEX_PATTERN
): string => {
  const target = [`${field(EVAL_FIELDS.targetTraceId)} = ${quote(traceId)}`];
  if (sessionId) target.push(`${field(EVAL_FIELDS.sessionId)} = ${quote(sessionId)}`);
  return [
    `source = ${index}`,
    `where ${EVAL_EVENT_WHERE}`,
    `where ${target.join(' or ')}`,
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');
};

/** Latest results for a batch of traces (Traces table column). */
export const buildTracesEvalsQuery = (
  traceIds: string[],
  limit = 1000,
  index: string = AGENT_EVALS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    `where ${EVAL_EVENT_WHERE}`,
    `where ${traceIds.map((id) => `${field(EVAL_FIELDS.targetTraceId)} = ${quote(id)}`).join(' or ')}`,
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');

export const createEvalsPplService = (
  data: DataPublicPluginStart,
  timeRange?: TimeRange,
  signal?: AbortSignal
) => new PPLService(data, { timeRange, signal });

export const fetchEvalResults = async (
  ppl: PPLService,
  query: string,
  index: string = AGENT_EVALS_INDEX_PATTERN
): Promise<EvalResult[]> => {
  const response = await ppl.executeQuery(evalsDataset(index), query);
  return pplResponseToRecords(response).map(recordToEvalResult);
};

/** Status of a test case as the SDK reports it on its `opensearch.test_case.result` event. */
export type TestCaseResultStatus = 'pass' | 'fail' | 'error';

/** One `opensearch.test_case.result` event: the outcome of one test case in a run. */
export interface TestCaseEvent {
  /** Time the case finished. */
  time: string;
  runId: string;
  suiteName?: string;
  caseId?: string;
  caseName?: string;
  /** Undefined when the producer sent a value we do not know. */
  status?: TestCaseResultStatus;
  /** Exception class name, for `error` cases. */
  errorType?: string;
  input?: string;
  expected?: string;
  output?: string;
  durationMs?: number;
  /** The agent run's trace (the event's trace context). */
  traceId?: string;
  agentName?: string;
  serviceName?: string;
  /** Metadata the producer attached to the case (flattened), e.g. the agent version. */
  metadata?: Record<string, string>;
}

/** One `opensearch.test_suite_run.result` event: the run's totals, emitted when it ends. */
export interface SuiteRunEvent {
  /** Time the run finished. */
  time: string;
  runId: string;
  suiteName?: string;
  /** `success` when no case errored, else `failure`. */
  status?: string;
  caseCount?: number;
  passCount?: number;
  failCount?: number;
  errorCount?: number;
  durationMs?: number;
  /** Run metadata the producer attached (`agent.version`, `agent.model`, ...), flattened. */
  metadata?: Record<string, string>;
}

/** Test case and run events of offline runs (absent for runs from older producers). */
export interface RunEvents {
  cases: TestCaseEvent[];
  runs: SuiteRunEvent[];
}

export const EMPTY_RUN_EVENTS: RunEvents = { cases: [], runs: [] };

const attrsOf = (row: PplRecord) => {
  const attrs = row.attributes as Record<string, unknown> | undefined;
  return (key: string) => get(attrs, key) ?? row[`attributes.${key}`];
};

/** Attribute prefixes of the contract itself, not user metadata. */
const RESERVED_PREFIXES = ['test.', 'opensearch.', 'derived.', 'error.', 'gen_ai.'];

/** User metadata of a case or run event: every attribute outside the contract, flattened. */
export const metadataOf = (attrs: unknown): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  const walk = (value: unknown, path: string) => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
        walk(v, path ? `${path}.${k}` : k)
      );
      return;
    }
    if (RESERVED_PREFIXES.some((p) => `${path}.`.startsWith(p))) return;
    out[path] = Array.isArray(value) ? JSON.stringify(value) : String(value);
  };
  walk(attrs, '');
  return Object.keys(out).length ? out : undefined;
};

const caseStatus = (v: string | undefined): TestCaseResultStatus | undefined => {
  const s = v?.trim().toLowerCase();
  if (s === 'pass' || s === 'passed') return 'pass';
  if (s === 'fail' || s === 'failed') return 'fail';
  if (s === 'error' || s === 'errored') return 'error';
  return undefined;
};

export const recordToTestCaseEvent = (row: PplRecord): TestCaseEvent | undefined => {
  const a = attrsOf(row);
  const runId = str(a('test.suite.run.id'));
  if (!runId) return undefined;
  const resource = row.resource as Record<string, unknown> | undefined;
  return {
    time: str(row['@timestamp']) ?? str(row.time) ?? '',
    runId,
    suiteName: str(a('test.suite.name')),
    caseId: str(a('test.case.id')),
    caseName: str(a('test.case.name')),
    status: caseStatus(str(a('test.case.result.status'))),
    errorType: str(a('error.type')),
    input: str(a('opensearch.test_case.input')),
    expected: str(a('opensearch.test_case.expected')),
    output: str(a('opensearch.test_case.output')),
    durationMs: num(a('opensearch.test_case.duration_ms')),
    traceId: str(row.traceId) ?? str(a('derived.evaluation.target_trace_id')),
    agentName: str(a('gen_ai.agent.name')),
    serviceName: str(get(get(resource, 'attributes'), 'service.name')) ?? str(row.serviceName),
    metadata: metadataOf(row.attributes),
  };
};

export const recordToSuiteRunEvent = (row: PplRecord): SuiteRunEvent | undefined => {
  const a = attrsOf(row);
  const runId = str(a('test.suite.run.id'));
  if (!runId) return undefined;
  return {
    time: str(row['@timestamp']) ?? str(row.time) ?? '',
    runId,
    suiteName: str(a('test.suite.name')),
    status: str(a('test.suite.run.status'))?.toLowerCase(),
    caseCount: num(a('opensearch.test_suite_run.case_count')),
    passCount: num(a('opensearch.test_suite_run.pass_count')),
    failCount: num(a('opensearch.test_suite_run.fail_count')),
    errorCount: num(a('opensearch.test_suite_run.error_count')),
    durationMs: num(a('opensearch.test_suite_run.duration_ms')),
    metadata: metadataOf(row.attributes),
  };
};

/** Splits test case and run event records by `eventName`; other records are ignored. */
export const recordsToRunEvents = (rows: PplRecord[]): RunEvents => {
  const events: RunEvents = { cases: [], runs: [] };
  rows.forEach((row) => {
    const eventName = str(row.eventName);
    if (eventName === TEST_CASE_EVENT) {
      const e = recordToTestCaseEvent(row);
      if (e) events.cases.push(e);
    } else if (eventName === TEST_SUITE_RUN_EVENT) {
      const e = recordToSuiteRunEvent(row);
      if (e) events.runs.push(e);
    }
  });
  return events;
};

/** Test case and run events in the time range, newest first. */
export const buildRunEventsQuery = (
  limit = 10000,
  index: string = AGENT_EVALS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    `where ${field(EVAL_FIELDS.eventName)} = ${quote(TEST_CASE_EVENT)} or ${field(
      EVAL_FIELDS.eventName
    )} = ${quote(TEST_SUITE_RUN_EVENT)}`,
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');

export const fetchRunEvents = async (
  ppl: PPLService,
  query: string,
  index: string = AGENT_EVALS_INDEX_PATTERN
): Promise<RunEvents> => {
  const response = await ppl.executeQuery(evalsDataset(index), query);
  return recordsToRunEvents(pplResponseToRecords(response));
};

/** Every event of one run (grades, test cases and the run event), not bound to a time range. */
export const buildRunDetailQuery = (
  runId: string,
  limit = 10000,
  index: string = AGENT_EVALS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    `where ${field(EVAL_FIELDS.runId)} = ${quote(runId)}`,
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');

export interface RunDetailData {
  results: EvalResult[];
  events: RunEvents;
}

/** Splits a run's records into grades and test case / run events. */
export const recordsToRunDetail = (rows: PplRecord[]): RunDetailData => ({
  results: rows
    .filter((row) => str(row.eventName) === EVAL_EVENT)
    .map(recordToEvalResult)
    .filter((r) => r.name !== '(unnamed)'),
  events: recordsToRunEvents(rows),
});

export interface LabelCount {
  label: string;
  count: number;
  /** The verdict most results with this label had. */
  outcome: EvalOutcome;
}

export interface EvaluatorSummary {
  name: string;
  levels: string[];
  sources: string[];
  count: number;
  passCount: number;
  failCount: number;
  errorCount: number;
  /** Results no rule decided ("Scored"); left out of the pass rate. */
  neutralCount: number;
  /** Mean of numeric values, when the evaluator reports numbers. */
  mean?: number;
  /** Mean normalized score 0..1 (higher is better), when the range is known. */
  normalizedMean?: number;
  labels: LabelCount[];
  direction: 'maximize' | 'minimize';
  latest?: string;
}

/** Pass share among passing and failing results (neutral and errors excluded). */
export const summaryPassRate = (s: Pick<EvaluatorSummary, 'passCount' | 'failCount'>) =>
  s.passCount + s.failCount > 0 ? s.passCount / (s.passCount + s.failCount) : undefined;

/** Most failing first, then the busiest. */
export const sortSummaries = (summaries: EvaluatorSummary[]): EvaluatorSummary[] =>
  summaries.sort(
    (x, y) =>
      y.failCount / Math.max(1, y.count) - x.failCount / Math.max(1, x.count) || y.count - x.count
  );

/** Labels with counts and their majority verdict, most frequent first. */
export const labelCounts = (
  rows: Array<{ label: string; outcome: EvalOutcome; count: number }>
): LabelCount[] => {
  const byLabel = new Map<string, Record<EvalOutcome, number>>();
  rows.forEach(({ label, outcome, count }) => {
    const c = byLabel.get(label) ?? { pass: 0, fail: 0, error: 0, neutral: 0 };
    c[outcome] += count;
    byLabel.set(label, c);
  });
  return Array.from(byLabel.entries())
    .map(([label, c]) => {
      const [outcome] = (Object.keys(c) as EvalOutcome[]).sort((x, y) => c[y] - c[x]);
      return { label, outcome, count: c.pass + c.fail + c.error + c.neutral };
    })
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
};

/** Per-evaluator rollup of a set of results. */
export const summarizeByEvaluator = (results: EvalResult[]): EvaluatorSummary[] => {
  const byName = new Map<string, EvalResult[]>();
  results.forEach((r) => {
    const list = byName.get(r.name) ?? [];
    list.push(r);
    byName.set(r.name, list);
  });
  return sortSummaries(
    Array.from(byName.entries()).map(([name, list]) => {
      const values = list.map((r) => r.value).filter((v): v is number => v !== undefined);
      const normalized = list.map(normalizedScore).filter((v): v is number => v !== undefined);
      const count = (o: EvalOutcome) => list.filter((r) => r.outcome === o).length;
      return {
        name,
        levels: Array.from(new Set(list.map((r) => r.level))),
        sources: Array.from(new Set(list.map((r) => r.source))),
        count: list.length,
        passCount: count('pass'),
        failCount: count('fail'),
        errorCount: count('error'),
        neutralCount: count('neutral'),
        mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined,
        normalizedMean: normalized.length
          ? normalized.reduce((s, v) => s + v, 0) / normalized.length
          : undefined,
        labels: labelCounts(
          list
            .filter((r) => !!r.label)
            .map((r) => ({ label: r.label as string, outcome: r.outcome, count: 1 }))
        ),
        direction: directionOf(name, list),
        latest: list
          .map((r) => r.time)
          .sort()
          .pop(),
      };
    })
  );
};

/** Scan order of verdicts: failures, evaluator errors, neutral scores, passes. */
export const OUTCOME_RANK: Record<EvalOutcome, number> = { fail: 0, error: 1, neutral: 2, pass: 3 };

/** Failures first, then by normalized score ascending: the order to scan results in. */
export const failuresFirst = (results: EvalResult[]): EvalResult[] =>
  [...results].sort((x, y) => {
    const rank = (r: EvalResult) => OUTCOME_RANK[r.outcome];
    return rank(x) - rank(y) || (normalizedScore(x) ?? 1) - (normalizedScore(y) ?? 1);
  });

/** Short display of a result: `label (value)`, `label` or `value`. */
export const formatScore = (r: Pick<EvalResult, 'value' | 'label'>): string => {
  const value =
    r.value === undefined
      ? undefined
      : Number.isInteger(r.value)
        ? String(r.value)
        : r.value.toFixed(2);
  if (r.label && value !== undefined) return `${r.label} (${value})`;
  return r.label ?? value ?? '-';
};

export const LEVEL_LABEL: Record<string, string> = {
  span: 'Span',
  tool_call: 'Tool call',
  trace: 'Trace',
  session: 'Session',
};

export const SOURCE_LABEL: Record<string, string> = {
  'opensearch-sdk': 'OpenSearch SDK',
  agentcore: 'Bedrock AgentCore',
  otel: 'OpenTelemetry',
};
