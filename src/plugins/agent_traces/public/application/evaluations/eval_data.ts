/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataset, TimeRange } from '../../../../data/common';
import { DataPublicPluginStart } from '../../../../data/public';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { pplResponseToRecords, PplRecord } from '../pages/sessions/session_utils';

/**
 * Evaluation results are OTel `gen_ai.evaluation.result` log events, one document per result
 * in `otel-v1-genai-evaluation-*`. Data Prepper keeps the OTel log record shape and adds
 * `attributes.derived.*` fields that normalize the level, the source and the session across
 * producers (the OpenSearch GenAI SDKs, Bedrock AgentCore, any OTel evaluator).
 */
export const EVALS_DATASET: Dataset = {
  id: 'agent-evaluations',
  title: AGENT_EVALS_INDEX_PATTERN,
  type: 'INDEXES',
  timeFieldName: '@timestamp',
};

/** PPL field names. Only fields mapped by the index template may appear in `where`. */
export const EVAL_FIELDS = {
  time: '@timestamp',
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
  evaluatorType: 'attributes.opensearch.evaluation.evaluator.type',
  scope: 'instrumentationScope.name',
} as const;

export type EvalLevel = 'span' | 'trace' | 'session' | 'tool_call' | string;
export type EvalOutcome = 'pass' | 'fail' | 'neutral';

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

const PASS_LABELS = new Set([
  'pass',
  'passed',
  'yes',
  'true',
  'correct',
  'relevant',
  'good',
  'success',
  'faithful',
  'coherent',
  'helpful',
  'very helpful',
  'completely yes',
  'perfectly correct',
  'thumbs_up',
]);
const FAIL_LABELS = new Set([
  'fail',
  'failed',
  'no',
  'false',
  'incorrect',
  'not_relevant',
  'irrelevant',
  'bad',
  'error',
  'unfaithful',
  'incoherent',
  'not helpful',
  'completely no',
  'thumbs_down',
]);

/**
 * Pass/fail for color and pass rates. The label wins when it is a known word; otherwise the
 * score is normalized to the declared range (0..1 when unknown, 1..5 when it looks like a
 * Likert score) and compared with the midpoint in the declared direction.
 */
export const outcomeOf = (r: Omit<EvalResult, 'outcome' | 'id'>): EvalOutcome => {
  if (r.errorType) return 'neutral';
  const label = r.label?.trim().toLowerCase();
  if (label && PASS_LABELS.has(label)) return 'pass';
  if (label && FAIL_LABELS.has(label)) return 'fail';
  if (r.caseStatus === 'pass') return 'pass';
  if (r.caseStatus === 'fail') return 'fail';
  if (r.value === undefined) return 'neutral';
  const max = r.scoreMax ?? (r.value > 1 ? 5 : 1);
  const min = r.scoreMin ?? (r.value > 1 ? 1 : 0);
  if (max <= min) return 'neutral';
  const normalized = (r.value - min) / (max - min);
  // The exact midpoint (3 on a 1..5 scale) is neither good nor bad.
  if (normalized === 0.5) return 'neutral';
  const good = r.direction === 'minimize' ? normalized < 0.5 : normalized > 0.5;
  return good ? 'pass' : 'fail';
};

/** Normalized 0..1 score for charts (higher is better), when the result has a value. */
export const normalizedScore = (r: EvalResult): number | undefined => {
  if (r.value === undefined) return r.outcome === 'pass' ? 1 : r.outcome === 'fail' ? 0 : undefined;
  const max = r.scoreMax ?? (r.value > 1 ? 5 : 1);
  const min = r.scoreMin ?? (r.value > 1 ? 1 : 0);
  if (max <= min) return undefined;
  const n = Math.min(1, Math.max(0, (r.value - min) / (max - min)));
  return r.direction === 'minimize' ? 1 - n : n;
};

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
  const direction = str(a('opensearch.evaluation.score.direction'));
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
  /** Only results whose outcome is fail (label in the fail set, or a low score). Applied
   *  client-side by `applyClientFilters`: the outcome depends on labels and score ranges. */
  failingOnly?: boolean;
  /** Free text matched against name, label and explanation. */
  search?: string;
}

/** `where` clauses for the filters. Only mapped fields are referenced. */
export const buildEvalWhere = (filters: EvalFilters = {}): string[] => {
  const clauses: string[] = [`${field(EVAL_FIELDS.name)} != ''`];
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

export const buildEvalResultsQuery = (filters: EvalFilters = {}, limit = 500): string =>
  [
    `source = ${AGENT_EVALS_INDEX_PATTERN}`,
    ...buildEvalWhere(filters).map((c) => `where ${c}`),
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');

/** Result counts per evaluation name, level and source: the filter options and the total. */
export const buildEvalFacetsQuery = (filters: EvalFilters = {}): string =>
  [
    `source = ${AGENT_EVALS_INDEX_PATTERN}`,
    ...buildEvalWhere(filters).map((c) => `where ${c}`),
    `stats count() as results by ${field(EVAL_FIELDS.name)}, ${field(EVAL_FIELDS.level)}, ${field(
      EVAL_FIELDS.source
    )}`,
  ].join(' | ');

/** Results that judged a trace, its spans, or its session. */
export const buildTraceEvalsQuery = (traceId: string, sessionId?: string, limit = 200): string => {
  const target = [`${field(EVAL_FIELDS.targetTraceId)} = ${quote(traceId)}`];
  if (sessionId) target.push(`${field(EVAL_FIELDS.sessionId)} = ${quote(sessionId)}`);
  return [
    `source = ${AGENT_EVALS_INDEX_PATTERN}`,
    `where ${target.join(' or ')}`,
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');
};

/** Latest results for a batch of traces (Traces table column). */
export const buildTracesEvalsQuery = (traceIds: string[], limit = 1000): string =>
  [
    `source = ${AGENT_EVALS_INDEX_PATTERN}`,
    `where ${traceIds.map((id) => `${field(EVAL_FIELDS.targetTraceId)} = ${quote(id)}`).join(' or ')}`,
    `sort - ${field(EVAL_FIELDS.time)}`,
    `head ${limit}`,
  ].join(' | ');

export const createEvalsPplService = (
  data: DataPublicPluginStart,
  timeRange?: TimeRange,
  signal?: AbortSignal
) => new PPLService(data, { timeRange, signal });

export const fetchEvalResults = async (ppl: PPLService, query: string): Promise<EvalResult[]> => {
  const response = await ppl.executeQuery(EVALS_DATASET, query);
  return pplResponseToRecords(response).map(recordToEvalResult);
};

export interface EvaluatorSummary {
  name: string;
  levels: string[];
  sources: string[];
  count: number;
  passCount: number;
  failCount: number;
  /** Mean of numeric values, when the evaluator reports numbers. */
  mean?: number;
  /** Mean normalized score 0..1 (higher is better). */
  normalizedMean?: number;
  labels: Array<{ label: string; count: number }>;
  latest?: string;
}

/** Per-evaluator rollup of a set of results. */
export const summarizeByEvaluator = (results: EvalResult[]): EvaluatorSummary[] => {
  const byName = new Map<string, EvalResult[]>();
  results.forEach((r) => {
    const list = byName.get(r.name) ?? [];
    list.push(r);
    byName.set(r.name, list);
  });
  return Array.from(byName.entries())
    .map(([name, list]) => {
      const values = list.map((r) => r.value).filter((v): v is number => v !== undefined);
      const normalized = list.map(normalizedScore).filter((v): v is number => v !== undefined);
      const labels = new Map<string, number>();
      list.forEach((r) => r.label && labels.set(r.label, (labels.get(r.label) ?? 0) + 1));
      return {
        name,
        levels: Array.from(new Set(list.map((r) => r.level))),
        sources: Array.from(new Set(list.map((r) => r.source))),
        count: list.length,
        passCount: list.filter((r) => r.outcome === 'pass').length,
        failCount: list.filter((r) => r.outcome === 'fail').length,
        mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined,
        normalizedMean: normalized.length
          ? normalized.reduce((s, v) => s + v, 0) / normalized.length
          : undefined,
        labels: Array.from(labels.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((x, y) => y.count - x.count),
        latest: list
          .map((r) => r.time)
          .sort()
          .pop(),
      };
    })
    .sort((x, y) => y.failCount / y.count - x.failCount / x.count || y.count - x.count);
};

/** Failures first, then by normalized score ascending: the order to scan results in. */
export const failuresFirst = (results: EvalResult[]): EvalResult[] =>
  [...results].sort((x, y) => {
    const rank = (r: EvalResult) => (r.outcome === 'fail' ? 0 : r.outcome === 'neutral' ? 1 : 2);
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

export const OUTCOME_COLOR: Record<EvalOutcome, 'success' | 'danger' | 'hollow'> = {
  pass: 'success',
  fail: 'danger',
  neutral: 'hollow',
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
