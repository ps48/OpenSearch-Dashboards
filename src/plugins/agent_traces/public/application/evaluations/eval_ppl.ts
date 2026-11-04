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
 * one case (100), one or two root spans (1 / 2), one trace (200), the two traces of Compare
 * traces (2000) and the turns of one session (50).
 *
 * Attribute names follow OTel; OpenSearch gap fields mirror them under `opensearch.*`
 * (`opensearch.gen_ai.evaluation.*`, `opensearch.test.case.*`).
 */

export const EVAL_EVENT = 'gen_ai.evaluation.result';

/**
 * The time field of the evaluation events, for the queries and the dataset "Create" makes:
 * `@timestamp`, which the onboarding Data Prepper pipeline copies from the OTel `time`.
 */
export const EVALS_TIME_FIELD = '@timestamp';

/** Field paths, as PPL names them. */
export const F = {
  time: EVALS_TIME_FIELD,
  eventName: 'eventName',
  traceId: 'traceId',
  spanId: 'spanId',
  scope: 'instrumentationScope.name',
  name: 'attributes.gen_ai.evaluation.name',
  value: 'attributes.gen_ai.evaluation.score.value',
  /** The verdict (`pass` / `fail`, lowercase) when there is one, else the judge's label. */
  label: 'attributes.gen_ai.evaluation.score.label',
  /** The judge's own label when `score.label` holds a pass/fail verdict (SDK, gap field). */
  judgeLabel: 'attributes.opensearch.gen_ai.evaluation.judge_label',
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
  level: 'attributes.opensearch.gen_ai.evaluation.level',
  evaluatorName: 'attributes.opensearch.gen_ai.evaluation.evaluator.name',
  evaluatorType: 'attributes.opensearch.gen_ai.evaluation.evaluator.type',
  evaluatorVersion: 'attributes.opensearch.gen_ai.evaluation.evaluator.version',
  scoreMin: 'attributes.opensearch.gen_ai.evaluation.score.min',
  scoreMax: 'attributes.opensearch.gen_ai.evaluation.score.max',
  scoreThreshold: 'attributes.opensearch.gen_ai.evaluation.score.threshold',
  scoreDirection: 'attributes.opensearch.gen_ai.evaluation.score.direction',
  judgeTraceId: 'attributes.opensearch.gen_ai.evaluation.judge.trace_id',
  /** Expected output of a case (offline results only). */
  caseExpected: 'attributes.opensearch.test.case.expected',
  caseExpectedTruncated: 'attributes.opensearch.test.case.expected_truncated',
} as const;

/** Span fields, as PPL names them (the span index). */
export const SF = {
  traceId: 'traceId',
  spanId: 'spanId',
  parentSpanId: 'parentSpanId',
  input: 'attributes.gen_ai.input.messages',
  output: 'attributes.gen_ai.output.messages',
  conversationId: 'attributes.gen_ai.conversation.id',
  startTime: 'startTime',
} as const;

export const AGG_LIMIT = 10000;
export const RESULTS_PAGE_SIZE = 25;
export const FACET_LIMIT = 50;
export const CASE_RESULTS_LIMIT = 100;
export const TRACE_RESULTS_LIMIT = 200;
export const COMPARE_SPANS_LIMIT = 2000;
export const SESSION_TURNS_LIMIT = 50;

/** The key of results without `gen_ai.agent.name` (routes, filters), or without a version. */
export const NO_AGENT = '~none';
export const NO_VERSION = NO_AGENT;

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

/** `field = value`, or `isnull(field)` for the no-value key. */
const valueCond = (f: string, v: string) =>
  v === NO_AGENT ? `isnull(${fld(f)})` : `${fld(f)} = ${quote(v)}`;

const agentCond = (agent: string) => valueCond(F.agentName, agent);

const agentWhere = (agent: string) => `where ${agentCond(agent)}`;

const anyOf = (f: string, values: string[]) =>
  values.map((v) => `${fld(f)} = ${quote(v)}`).join(' or ');

/** A LIKE pattern matching `q` literally: its `\\`, `%` and `_` are escaped. */
export const likeLiteral = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const like = (f: string, q: string) => `where like(${fld(f)}, ${quote(`%${likeLiteral(q)}%`)})`;

const head = `head ${AGG_LIMIT}`;
const join = (commands: string[]) => commands.join(' | ');

// ---------------------------------------------------------------------- Agents (home)

export const buildAgentsQuery = (index: string, source: EvalSource, q = ''): string =>
  join([
    ...base(index),
    ...sourceWhere(source),
    ...(q.trim() ? [like(F.agentName, q.trim())] : []),
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as first, max(${fld(F.time)}) as last by ${[
      F.agentName,
      F.agentVersion,
      F.name,
    ]
      .map(fld)
      .join(', ')}, verdict`,
    head,
  ]);

// ---------------------------------------------------------------------- Agent page

/**
 * Evaluations tab table (and the page's version line): evaluations x versions x labels (pass and
 * fail are labels too), with the average score for evaluations without a pass rule.
 */
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
    `stats count() as n, count(${fld(F.value)}) as nv, avg(${fld(
      F.value
    )}) as avg_score, min(${fld(F.time)}) as first, max(${fld(F.time)}) as last by ${fld(
      F.name
    )}, ${fld(F.agentVersion)}, verdict, ${fld(F.label)}, ${fld(F.scoreDirection)}${
      // Offline: by run too, so each version can be read at its latest run.
      source === 'offline' ? `, ${fld(F.runId)}` : ''
    }`,
    head,
  ]);

/** Pass rate over time: pass and fail per time bucket and version. */
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
    `stats count() as n by span(${fld(F.time)}, ${step}) as t, ${fld(F.agentVersion)}, verdict`,
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

/**
 * Cases passed per run of a suite: a case passes when one of its results passed and none
 * failed or errored (as `caseStatusOf`). Two aggregations (per case, then per run): one row
 * per run.
 */
export const buildSuiteRunCasesQuery = (index: string, suite: string): string =>
  join([
    ...base(index),
    `where ${fld(F.suiteName)} = ${quote(suite)}`,
    `eval bad = if(isnotnull(${fld(F.errorType)}) or ${fld(F.label)} = 'fail', 1, 0), good = if(${fld(
      F.label
    )} = 'pass', 1, 0)`,
    `stats sum(bad) as bad, sum(good) as good by ${fld(F.runId)}, ${fld(F.caseId)}`,
    'eval ok = if(bad = 0 and good > 0, 1, 0)',
    `stats count() as cases, sum(ok) as passed by ${fld(F.runId)}`,
    head,
  ]);

// ---------------------------------------------------------------------- Run page

/**
 * The runs of a suite in the range with their start, latest first: finds the run before a run
 * (the cap drops the oldest runs, not the recent ones). Without a suite: every run.
 */
export const buildRunsLookupQuery = (index: string, suite?: string): string =>
  join([
    ...base(index),
    suite !== undefined
      ? `where ${fld(F.suiteName)} = ${quote(suite)}`
      : `where isnotnull(${fld(F.runId)})`,
    `stats min(${fld(F.time)}) as started by ${fld(F.suiteName)}, ${fld(F.runId)}`,
    ...(suite !== undefined ? ['sort - started'] : []),
    head,
  ]);

/** An aggregation that returned `AGG_LIMIT` rows may have been cut off. */
export const isTruncated = (rows: unknown[]): boolean => rows.length >= AGG_LIMIT;

const runsWhere = (runIds: string[]) =>
  runIds.map((id) => `${fld(F.runId)} = ${quote(id)}`).join(' or ');

/** First and last result of one or two runs: the window the run and compare pages read. */
export const buildRunWindowQuery = (index: string, runIds: string[]): string =>
  join([
    ...base(index),
    `where ${runsWhere(runIds)}`,
    `stats min(${fld(F.time)}) as first, max(${fld(F.time)}) as last`,
  ]);

/** The cases of a run and of the run before it (when there is one), in one query. */
export const buildRunCasesQuery = (index: string, runId: string, beforeId?: string): string =>
  join([
    ...base(index),
    `where ${runsWhere(beforeId ? [runId, beforeId] : [runId])}`,
    VERDICT_EVAL,
    `stats count() as n, min(${fld(F.time)}) as t0, max(${fld(F.time)}) as t1 by ${[
      F.runId,
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

/** One case: its result documents in one run, or in two (Compare runs, the result flyout). */
export const buildCaseResultsQuery = (
  index: string,
  runIds: string | string[],
  caseId: string
): string => {
  const ids = typeof runIds === 'string' ? [runIds] : runIds;
  const runs = ids.length > 1 ? `(${runsWhere(ids)})` : runsWhere(ids);
  return join([
    ...base(index),
    `where ${runs} and ${fld(F.caseId)} = ${quote(caseId)}`,
    `head ${CASE_RESULTS_LIMIT}`,
  ]);
};

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

/** The root spans of one or two traces: their input and output messages. */
export const buildRootSpansQuery = (spansIndex: string, traceIds: string[]): string => {
  const ids = anyOf(SF.traceId, traceIds);
  return join([
    `source = ${spansIndex}`,
    `where ${traceIds.length > 1 ? `(${ids})` : ids} and ${fld(SF.parentSpanId)} = ''`,
    `fields ${[SF.traceId, SF.input, SF.output].map(fld).join(', ')}`,
    // A trace can have several spans without a parent (broken context propagation): one
    // each, so a trace cannot take another's place under the head.
    `dedup ${fld(SF.traceId)}`,
    `head ${traceIds.length}`,
  ]);
};

/** The root spans of a session (`gen_ai.conversation.id`), oldest first: its turns. */
export const buildSessionRootsQuery = (spansIndex: string, conversationId: string): string =>
  join([
    `source = ${spansIndex}`,
    `where ${fld(SF.conversationId)} = ${quote(conversationId)} and ${fld(SF.parentSpanId)} = ''`,
    `sort ${fld(SF.startTime)}`,
    `fields ${[SF.traceId, SF.startTime, SF.input, SF.output].map(fld).join(', ')}`,
    `head ${SESSION_TURNS_LIMIT}`,
  ]);

/** One span (a span-level result's judged span), the whole document (tool fields included). */
export const buildSpanQuery = (spansIndex: string, traceId: string, spanId: string): string =>
  join([
    `source = ${spansIndex}`,
    `where ${fld(SF.traceId)} = ${quote(traceId)} and ${fld(SF.spanId)} = ${quote(spanId)}`,
    'head 1',
  ]);

/** The spans of one trace (a judge trace), oldest first. */
export const buildOneTraceSpansQuery = (spansIndex: string, traceId: string): string =>
  join([
    `source = ${spansIndex}`,
    `where ${fld(SF.traceId)} = ${quote(traceId)}`,
    'sort startTime',
    `head ${TRACE_RESULTS_LIMIT}`,
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

/** The session-level results of a session (`gen_ai.conversation.id`). */
export const buildSessionResultsQuery = (index: string, conversationId: string): string =>
  join([
    ...base(index),
    `where ${fld(F.conversationId)} = ${quote(conversationId)} and ${fld(F.level)} = 'session'`,
    `head ${TRACE_RESULTS_LIMIT}`,
  ]);

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

export type Facet = 'agents' | 'names' | 'versions' | 'verdicts';
export const FACETS: Facet[] = ['agents', 'names', 'versions', 'verdicts'];

export interface ResultsFilters {
  /** The agent page locks the view to one agent. */
  lockAgent?: string;
  agents: string[];
  names: string[];
  versions: string[];
  verdicts: string[];
  source: EvalSource;
  /** Search in explanations. */
  q: string;
}

export const EMPTY_RESULTS_FILTERS: ResultsFilters = {
  agents: [],
  names: [],
  versions: [],
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
  if (f.versions.length && except !== 'versions')
    out.push(`where ${f.versions.map((v) => valueCond(F.agentVersion, v)).join(' or ')}`);
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
  const by =
    facet === 'agents'
      ? fld(F.agentName)
      : facet === 'names'
        ? fld(F.name)
        : facet === 'versions'
          ? fld(F.agentVersion)
          : 'verdict';
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
