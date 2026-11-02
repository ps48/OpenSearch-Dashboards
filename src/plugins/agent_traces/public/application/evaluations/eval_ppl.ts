/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every PPL query of the Agent Evaluations screens, one builder per screen (see the P0 mock,
 * "Queries on this screen"). The index only holds `gen_ai.evaluation.result` events. The time
 * range is not part of the text: the PPL service adds the `@timestamp` bounds of the dataset.
 *
 * Aggregations end in `head 10000`; raw documents are read only for one page of results (25),
 * one expanded case (100) and one or two traces (200).
 */

export const EVAL_EVENT = 'gen_ai.evaluation.result';

/** Field paths, as PPL names them. */
export const F = {
  time: '@timestamp',
  eventName: 'eventName',
  traceId: 'traceId',
  spanId: 'spanId',
  scope: 'instrumentationScope.name',
  name: 'attributes.gen_ai.evaluation.name',
  value: 'attributes.gen_ai.evaluation.score.value',
  label: 'attributes.gen_ai.evaluation.score.label',
  explanation: 'attributes.gen_ai.evaluation.explanation',
  errorType: 'attributes.error.type',
  agentName: 'attributes.gen_ai.agent.name',
  agentVersion: 'attributes.gen_ai.agent.version',
  conversationId: 'attributes.gen_ai.conversation.id',
  suiteName: 'attributes.test.suite.name',
  runId: 'attributes.test.suite.run.id',
  caseId: 'attributes.test.case.id',
  caseName: 'attributes.test.case.name',
  ciUrl: 'attributes.cicd.pipeline.run.url.full',
  level: 'attributes.opensearch.evaluation.level',
  evaluatorName: 'attributes.opensearch.evaluation.evaluator.name',
  evaluatorType: 'attributes.opensearch.evaluation.evaluator.type',
  scoreMin: 'attributes.opensearch.evaluation.score.min',
  scoreMax: 'attributes.opensearch.evaluation.score.max',
} as const;

export const AGG_LIMIT = 10000;
export const RESULTS_PAGE_SIZE = 25;
export const FACET_LIMIT = 50;
export const CASE_RESULTS_LIMIT = 100;
export const TRACE_RESULTS_LIMIT = 200;
export const COMPARE_SPANS_LIMIT = 2000;

/** The agent key of results without `gen_ai.agent.name` (routes, filters). */
export const NO_AGENT = '~none';

/** Online results have no `test.suite.run.id`; offline results (suite runs) have one. */
export type EvalSource = 'all' | 'online' | 'offline';

export const fld = (f: string) => `\`${f}\``;
export const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The verdict, one rule: evaluator error, else the label's pass or fail, else scored. */
export const VERDICT_EVAL = `eval verdict = case(isnotnull(${fld(F.errorType)}), 'error', ${fld(
  F.label
)} = 'pass', 'pass', ${fld(F.label)} = 'fail', 'fail' else 'scored')`;

const base = (index: string) => [
  `source = ${index}`,
  `where ${fld(F.eventName)} = '${EVAL_EVENT}'`,
];

const sourceWhere = (source: EvalSource = 'all'): string[] =>
  source === 'online'
    ? [`where isnull(${fld(F.runId)})`]
    : source === 'offline'
      ? [`where isnotnull(${fld(F.runId)})`]
      : [];

const agentCond = (agent: string) =>
  agent === NO_AGENT ? `isnull(${fld(F.agentName)})` : `${fld(F.agentName)} = ${quote(agent)}`;

const agentWhere = (agent: string) => `where ${agentCond(agent)}`;

const anyOf = (f: string, values: string[]) =>
  values.map((v) => `${fld(f)} = ${quote(v)}`).join(' or ');

const like = (f: string, q: string) => `where like(${fld(f)}, ${quote(`%${q}%`)})`;

const head = `head ${AGG_LIMIT}`;
const join = (commands: string[]) => commands.join(' | ');

// ---------------------------------------------------------------------- Agents (home)

export const buildAgentsQuery = (index: string, source: EvalSource, q = ''): string =>
  join([
    ...base(index),
    ...sourceWhere(source),
    ...(q.trim() ? [like(F.agentName, q.trim())] : []),
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as first, max(${fld(F.time)}) as last by ${fld(
      F.agentName
    )}, ${fld(F.agentVersion)}, verdict`,
    head,
  ]);

// ---------------------------------------------------------------------- Agent page

/** Evaluations tab table (and the page's version line): evaluations x versions x verdicts. */
export const buildAgentEvaluationsQuery = (
  index: string,
  agent: string,
  source: EvalSource
): string =>
  join([
    ...base(index),
    agentWhere(agent),
    ...sourceWhere(source),
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as first, max(${fld(F.time)}) as last by ${fld(
      F.name
    )}, ${fld(F.agentVersion)}, verdict`,
    head,
  ]);

/** Pass rate over time: pass and fail per time bucket. */
export const buildAgentTrendQuery = (
  index: string,
  agent: string,
  source: EvalSource,
  step: string
): string =>
  join([
    ...base(index),
    agentWhere(agent),
    ...sourceWhere(source),
    VERDICT_EVAL,
    `where verdict = 'pass' or verdict = 'fail'`,
    `stats count() as n by span(${fld(F.time)}, ${step}) as t, verdict`,
    head,
  ]);

/** Suites tab: runs of the agent's suites with their verdicts. */
export const buildAgentSuitesQuery = (index: string, agent: string): string =>
  join([
    ...base(index),
    agentWhere(agent),
    `where isnotnull(${fld(F.runId)})`,
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as started by ${fld(F.suiteName)}, ${fld(
      F.runId
    )}, ${fld(F.agentVersion)}, verdict`,
    head,
  ]);

// ---------------------------------------------------------------------- Suite page

export const buildSuiteRunsQuery = (index: string, suite: string): string =>
  join([
    ...base(index),
    `where ${fld(F.suiteName)} = ${quote(suite)}`,
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as started by ${fld(F.runId)}, ${fld(
      F.agentName
    )}, ${fld(F.agentVersion)}, ${fld(F.ciUrl)}, verdict`,
    head,
  ]);

// ---------------------------------------------------------------------- Run page

export const buildRunCasesQuery = (index: string, runId: string): string =>
  join([
    ...base(index),
    `where ${fld(F.runId)} = ${quote(runId)}`,
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as t0, max(${fld(F.time)}) as t1 by ${[
      F.suiteName,
      F.agentName,
      F.agentVersion,
      F.ciUrl,
      F.caseId,
      F.caseName,
      F.name,
    ]
      .map(fld)
      .join(', ')}, verdict, ${fld(F.traceId)}`,
    head,
  ]);

/** One expanded case: its result documents. */
export const buildCaseResultsQuery = (index: string, runId: string, caseId: string): string =>
  join([
    ...base(index),
    `where ${fld(F.runId)} = ${quote(runId)} and ${fld(F.caseId)} = ${quote(caseId)}`,
    `head ${CASE_RESULTS_LIMIT}`,
  ]);

// ---------------------------------------------------------------------- Compare runs

export const buildCompareRunsQuery = (index: string, runA: string, runB: string): string =>
  join([
    ...base(index),
    `where ${fld(F.runId)} = ${quote(runA)} or ${fld(F.runId)} = ${quote(runB)}`,
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as started by ${[
      F.runId,
      F.suiteName,
      F.agentName,
      F.agentVersion,
      F.caseId,
      F.caseName,
      F.name,
    ]
      .map(fld)
      .join(', ')}, verdict, ${fld(F.traceId)}`,
    head,
  ]);

/** Spans of up to two traces (Compare traces), from the span index. */
export const buildTraceSpansQuery = (spansIndex: string, traceIds: string[]): string =>
  join([
    `source = ${spansIndex}`,
    `where ${anyOf(F.traceId, traceIds)}`,
    'sort startTime',
    `head ${COMPARE_SPANS_LIMIT}`,
  ]);

// ---------------------------------------------------------------------- Traces

/** Result documents of one or two traces (trace flyout, Compare traces). */
export const buildTraceResultsQuery = (index: string, traceIds: string[]): string =>
  join([...base(index), `where ${anyOf(F.traceId, traceIds)}`, `head ${TRACE_RESULTS_LIMIT}`]);

/** Agent Traces table: a tally per trace (or per span) of the listed traces. */
export const buildTracesTallyQuery = (index: string, traceIds: string[], bySpan = false): string =>
  join([
    ...base(index),
    `where ${anyOf(F.traceId, traceIds)}`,
    VERDICT_EVAL,
    `stats count() as n by ${fld(F.traceId)}, ${bySpan ? `${fld(F.spanId)}, ` : ''}verdict`,
    head,
  ]);

// ---------------------------------------------------------------------- Results

export type ResultsSortField = 'time' | 'agent' | 'evaluation' | 'score';
export interface ResultsSort {
  field: ResultsSortField;
  direction: 'asc' | 'desc';
}
export const DEFAULT_RESULTS_SORT: ResultsSort = { field: 'time', direction: 'desc' };

const SORT_FIELD: Record<ResultsSortField, string> = {
  time: F.time,
  agent: F.agentName,
  evaluation: F.name,
  score: F.value,
};

export type Facet = 'agents' | 'names' | 'verdicts';

export interface ResultsFilters {
  /** The agent page locks the view to one agent. */
  lockAgent?: string;
  agents: string[];
  names: string[];
  verdicts: string[];
  source: EvalSource;
  /** Search in explanations. */
  q: string;
}

export const EMPTY_RESULTS_FILTERS: ResultsFilters = {
  agents: [],
  names: [],
  verdicts: [],
  source: 'all',
  q: '',
};

/** The `where` commands of the filters, without the verdict (it needs the `eval`). */
const resultsWhere = (f: ResultsFilters, except?: Facet): string[] => {
  const out: string[] = [];
  if (f.lockAgent) out.push(agentWhere(f.lockAgent));
  else if (f.agents.length && except !== 'agents')
    out.push(`where ${f.agents.map(agentCond).join(' or ')}`);
  if (f.names.length && except !== 'names') out.push(`where ${anyOf(F.name, f.names)}`);
  out.push(...sourceWhere(f.source));
  if (f.q.trim()) out.push(like(F.explanation, f.q.trim()));
  return out;
};

const verdictWhere = (f: ResultsFilters, except?: Facet): string[] =>
  f.verdicts.length && except !== 'verdicts'
    ? [VERDICT_EVAL, `where ${f.verdicts.map((v) => `verdict = ${quote(v)}`).join(' or ')}`]
    : [];

/** One page of result documents, sorted and paged on the server. */
export const buildResultsPageQuery = (
  index: string,
  filters: ResultsFilters,
  sort: ResultsSort,
  pageIndex: number
): string =>
  join([
    ...base(index),
    ...resultsWhere(filters),
    ...verdictWhere(filters),
    `sort ${sort.direction === 'desc' ? '- ' : ''}${fld(SORT_FIELD[sort.field])}`,
    `head ${RESULTS_PAGE_SIZE} from ${pageIndex * RESULTS_PAGE_SIZE}`,
  ]);

/** The total for the pager. */
export const buildResultsCountQuery = (index: string, filters: ResultsFilters): string =>
  join([
    ...base(index),
    ...resultsWhere(filters),
    ...verdictWhere(filters),
    'stats count() as total',
  ]);

/** A filter menu's values (top 50 with counts), with the other filters applied. */
export const buildFacetQuery = (index: string, filters: ResultsFilters, facet: Facet): string => {
  const by = facet === 'agents' ? fld(F.agentName) : facet === 'names' ? fld(F.name) : 'verdict';
  return join([
    ...base(index),
    ...resultsWhere(filters, facet),
    ...verdictWhere(filters, facet),
    ...(facet === 'verdicts' ? [VERDICT_EVAL] : []),
    `stats count() as n by ${by}`,
    'sort - n',
    `head ${FACET_LIMIT}`,
  ]);
};

// ---------------------------------------------------------------------- Time buckets

const STEPS: Array<{ step: string; ms: number }> = [
  { step: '1m', ms: 60e3 },
  { step: '5m', ms: 5 * 60e3 },
  { step: '15m', ms: 15 * 60e3 },
  { step: '1h', ms: 3600e3 },
  { step: '3h', ms: 3 * 3600e3 },
  { step: '12h', ms: 12 * 3600e3 },
  { step: '1d', ms: 24 * 3600e3 },
  { step: '1w', ms: 7 * 24 * 3600e3 },
];

/** The smallest bucket that keeps a range to about 60 points (24 h: 1h, 7 d: 3h, 30 d: 12h). */
export const trendStep = (rangeMs: number): { step: string; ms: number } =>
  STEPS.find((s) => rangeMs / s.ms <= 60) ?? STEPS[STEPS.length - 1];
