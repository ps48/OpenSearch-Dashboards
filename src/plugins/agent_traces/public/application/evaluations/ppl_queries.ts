/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every PPL query of Agent Evaluations and of the evaluation parts of Agent Traces (column,
 * trace flyout, session results), one builder each, with its exact text asserted in
 * `ppl_queries.test.ts`. The index only holds `gen_ai.evaluation.result` events. The time range
 * is not part of the text: the PPL service adds the `@timestamp` bounds of the dataset.
 *
 * Aggregations end in `head 10000`; raw documents are read only for one page of results (25),
 * one case (100), one document per run (100) or per case (500), one per evaluation of a run
 * (100), the judged spans of one or two results (1 / 2), up to 10 AI-root candidates of a trace, one
 * trace (200), the two traces of Compare traces (2000)
 * and the turns of one session (50).
 *
 * Attribute names follow OTel; OpenSearch gap fields mirror them under `opensearch.*`
 * (`opensearch.gen_ai.evaluation.*`, `opensearch.test.case.*`).
 */

import { AI_ROOT_FIELD, aiRootConditionOf } from '../utils/ai_root';

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
  /** Human-readable run name and description (SDK gap fields, optional). */
  runName: 'attributes.opensearch.test.suite.run.name',
  runDescription: 'attributes.opensearch.test.suite.run.description',
  caseId: 'attributes.test.case.id',
  caseName: 'attributes.test.case.name',
  ciUrl: 'attributes.cicd.pipeline.run.url.full',
  level: 'attributes.opensearch.gen_ai.evaluation.level',
  evaluatorName: 'attributes.opensearch.gen_ai.evaluation.evaluator.name',
  evaluatorType: 'attributes.opensearch.gen_ai.evaluation.evaluator.type',
  evaluatorVersion: 'attributes.opensearch.gen_ai.evaluation.evaluator.version',
  /** What the evaluator checks (SDK gap field, optional). */
  evaluatorDescription: 'attributes.opensearch.gen_ai.evaluation.evaluator.description',
  /** The LLM judge's model, prompt template and system prompt (semconv, all optional). */
  judgeModel: 'attributes.gen_ai.request.model',
  promptName: 'attributes.gen_ai.prompt.name',
  promptVersion: 'attributes.gen_ai.prompt.version',
  systemInstructions: 'attributes.gen_ai.system_instructions',
  systemInstructionsTruncated:
    'attributes.opensearch.gen_ai.evaluation.system_instructions_truncated',
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
  operation: 'attributes.gen_ai.operation.name',
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

/**
 * An aggregation of `verdictStats`: `first` runs on the result documents, `then` re-aggregates
 * its column per verdict (counts and sums add up, min and max compose).
 */
export interface VerdictAgg {
  first: string;
  /** An `eval` assignment on the first stats' rows, before they are re-aggregated. */
  mid?: string;
  then: string;
}

export const countOf = (f: string, as: string): VerdictAgg => ({
  first: `count(${fld(f)}) as ${as}`,
  then: `sum(${as}) as ${as}`,
});
export const sumOf = (f: string, as: string): VerdictAgg => ({
  first: `sum(${fld(f)}) as ${as}`,
  then: `sum(${as}) as ${as}`,
});
/**
 * The sum of a numeric field as `avg * count` per group, so it stays a double: `sum()` of a
 * field mapped as `long` in some indices (whole-number scores without the template) drops the
 * decimals of the others. `count` names the `countOf` of the same field.
 */
export const decimalSumOf = (f: string, as: string, count: string): VerdictAgg => ({
  first: `avg(${fld(f)}) as ${as}_avg`,
  mid: `${as} = ${as}_avg * ${count}`,
  then: `sum(${as}) as ${as}`,
});
export const minOf = (f: string, as: string): VerdictAgg => ({
  first: `min(${fld(f)}) as ${as}`,
  then: `min(${as}) as ${as}`,
});
export const maxOf = (f: string, as: string): VerdictAgg => ({
  first: `max(${fld(f)}) as ${as}`,
  then: `max(${as}) as ${as}`,
});

/** Where `verdictStats` groups by the verdict (else last). */
export const VERDICT = 'verdict';

/** The raw fields the verdict is computed from, grouped by before the verdict exists. */
const VERDICT_KEYS = [fld(F.errorType), fld(F.label)];

/**
 * `stats count() as n, <aggs> by <groups>, verdict`, stats first: PPL runs an `eval` before a
 * `stats` or `where` as a script on the documents, which fails (and silently drops their results)
 * on the indices behind the pattern that do not map a field it names. So the documents are grouped
 * by the raw `error.type` and `score.label` too (a missing value is a null group), the verdict is
 * computed on those rows, and they are re-aggregated by verdict. `groups` are PPL group
 * expressions (`` `field` `` or `span(...) as t`); `VERDICT` marks where the verdict goes.
 */
export const verdictStats = (groups: string[], aggs: VerdictAgg[] = []): string[] => {
  const at = groups.includes(VERDICT) ? groups : [...groups, VERDICT];
  const firstBy = at.flatMap((g) =>
    g === VERDICT ? VERDICT_KEYS.filter((k) => !groups.includes(k)) : [g]
  );
  const thenBy = at.map((g) => g.replace(/^.* as (\w+)$/, '$1'));
  const list = (head: string, more: string[]) => [head, ...more].join(', ');
  return [
    `stats ${list(
      'count() as n',
      aggs.map((a) => a.first)
    )} by ${firstBy.join(', ')}`,
    [VERDICT_EVAL, ...aggs.flatMap((a) => (a.mid ? [a.mid] : []))].join(', '),
    `stats ${list(
      'sum(n) as n',
      aggs.map((a) => a.then)
    )} by ${thenBy.join(', ')}`,
  ];
};

/** `where` conditions on the raw fields that select one verdict (as `VERDICT_EVAL`). */
export const verdictCond = (verdict: string): string => {
  const err = fld(F.errorType);
  const label = fld(F.label);
  switch (verdict) {
    case 'error':
      return `isnotnull(${err})`;
    case 'pass':
    case 'fail':
      return `${label} = ${quote(verdict)} and isnull(${err})`;
    default:
      return `isnull(${err}) and (isnull(${label}) or (${label} != 'pass' and ${label} != 'fail'))`;
  }
};

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

// ---------------------------------------------------------------------- Setup and settings

/** The number of results in an index (setup detection, Settings). */
export const buildResultsTotalQuery = (index: string): string =>
  join([...base(index), 'stats count() as n']);

// ---------------------------------------------------------------------- Agents (home)

export const buildAgentsQuery = (index: string, source: EvalSource, q = ''): string =>
  join([
    ...base(index),
    ...sourceWhere(source),
    ...(q.trim() ? [like(F.agentName, q.trim())] : []),
    ...verdictStats([F.agentName, F.agentVersion, F.name].map(fld), [
      minOf(F.time, 'first'),
      maxOf(F.time, 'last'),
    ]),
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
    ...verdictStats(
      [
        fld(F.name),
        fld(F.agentVersion),
        VERDICT,
        fld(F.label),
        fld(F.scoreDirection),
        // Offline: by run too, so each version can be read at its latest run.
        ...(source === 'offline' ? [fld(F.runId)] : []),
      ],
      [
        countOf(F.value, 'nv'),
        decimalSumOf(F.value, 'sum_score', 'nv'),
        minOf(F.time, 'first'),
        maxOf(F.time, 'last'),
      ]
    ),
    // The average from the sums (averages do not re-aggregate).
    'eval avg_score = sum_score / nv',
    'fields - sum_score',
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
    `where (${verdictCond('pass')}) or (${verdictCond('fail')})`,
    ...verdictStats([`span(${fld(F.time)}, ${step}) as t`, fld(F.agentVersion)]),
    head,
  ]);

/** Suites tab: runs of the agent's suites with their verdicts. */
export const buildAgentSuitesQuery = (index: string, agent: string): string =>
  join([
    ...base(index),
    agentWhere(agent),
    `where isnotnull(${fld(F.runId)})`,
    ...runsStats([F.suiteName, F.runId, F.agentVersion]),
    head,
  ]);

// ---------------------------------------------------------------------- Suite page

/** The runs aggregation: results and first result time per run (and `by`) and verdict. */
const runsStats = (by: string[]) => verdictStats(by.map(fld), [minOf(F.time, 'started')]);

export const buildSuiteRunsQuery = (index: string, suite: string): string =>
  join([
    ...base(index),
    `where ${fld(F.suiteName)} = ${quote(suite)}`,
    ...runsStats([F.runId, F.agentName, F.agentVersion]),
    head,
  ]);

/**
 * Cases passed per run: a case passes when one of its results passed and none failed or
 * errored (as `caseStatusOf`). Aggregations per case (on the raw fields, stats first, as
 * `verdictStats`), then per run: one row per run.
 */
const runCasesStats = [
  `stats count() as n by ${[F.runId, F.caseId, F.errorType, F.label].map(fld).join(', ')}`,
  `eval bad = if(isnotnull(${fld(F.errorType)}) or ${fld(F.label)} = 'fail', n, 0), good = if(${fld(
    F.label
  )} = 'pass', n, 0)`,
  `stats sum(bad) as bad, sum(good) as good by ${fld(F.runId)}, ${fld(F.caseId)}`,
  'eval ok = if(bad = 0 and good > 0, 1, 0)',
  `stats count() as cases, sum(ok) as passed by ${fld(F.runId)}`,
  head,
];

/** Cases passed per run of a suite. */
export const buildSuiteRunCasesQuery = (index: string, suite: string): string =>
  join([...base(index), `where ${fld(F.suiteName)} = ${quote(suite)}`, ...runCasesStats]);

// ---------------------------------------------------------------------- Eval runs (home)

export type RunsFacet = 'agents' | 'suites';
export const RUNS_FACETS: RunsFacet[] = ['agents', 'suites'];

/** Eval runs tab filters: agents and suites (any of), and a search in run id, suite and agent. */
export interface RunsFilters {
  agents: string[];
  suites: string[];
  q: string;
}

export const EMPTY_RUNS_FILTERS: RunsFilters = { agents: [], suites: [], q: '' };

/** Offline results only, with the filters (but `except`, for its own filter menu). */
const runsFiltersWhere = (f: RunsFilters, except?: RunsFacet): string[] => {
  const out = [`where isnotnull(${fld(F.runId)})`];
  if (f.agents.length && except !== 'agents')
    out.push(`where ${f.agents.map(agentCond).join(' or ')}`);
  if (f.suites.length && except !== 'suites')
    out.push(`where ${f.suites.map((v) => valueCond(F.suiteName, v)).join(' or ')}`);
  const q = f.q.trim();
  if (q) {
    const pattern = quote(`%${likeLiteral(q)}%`);
    out.push(
      `where ${[F.runId, F.suiteName, F.agentName]
        .map((x) => `like(${fld(x)}, ${pattern})`)
        .join(' or ')}`
    );
  }
  return out;
};

/**
 * Every run in the range across suites and agents: the suite page's runs aggregation without
 * the suite, by suite name too, latest first (the cap drops the oldest runs).
 */
export const buildEvalRunsQuery = (index: string, filters: RunsFilters): string =>
  join([
    ...base(index),
    ...runsFiltersWhere(filters),
    ...runsStats([F.runId, F.suiteName, F.agentName, F.agentVersion]),
    'sort - started',
    head,
  ]);

/** Cases passed per run, for the runs of `buildEvalRunsQuery`. */
export const buildEvalRunCasesQuery = (index: string, filters: RunsFilters): string =>
  join([...base(index), ...runsFiltersWhere(filters), ...runCasesStats]);

/** An Eval runs filter menu's values (top 50, with their number of runs). */
export const buildRunsFacetQuery = (index: string, filters: RunsFilters, facet: RunsFacet) =>
  join([
    ...base(index),
    ...runsFiltersWhere(filters, facet),
    `stats dc(${fld(F.runId)}) as n by ${fld(facet === 'agents' ? F.agentName : F.suiteName)}`,
    'sort - n',
    `head ${FACET_LIMIT}`,
  ]);

// ---------------------------------------------------------------------- Run page

/**
 * The runs of a suite in the range with their agent and start, latest first: finds the run
 * before a run of the same suite and agent (the cap drops the oldest runs, not the recent ones).
 */
export const buildRunsLookupQuery = (index: string, suite: string): string =>
  join([
    ...base(index),
    `where ${fld(F.suiteName)} = ${quote(suite)}`,
    `stats min(${fld(F.time)}) as started by ${[F.suiteName, F.agentName, F.runId]
      .map(fld)
      .join(', ')}`,
    'sort - started',
    head,
  ]);

/** An aggregation that returned `AGG_LIMIT` rows may have been cut off. */
export const isTruncated = (rows: unknown[]): boolean => rows.length >= AGG_LIMIT;

const runsWhere = (runIds: string[]) =>
  runIds.map((id) => `${fld(F.runId)} = ${quote(id)}`).join(' or ');

/** At most this many runs get their name read (`buildRunNamesQuery`), the latest first. */
export const RUN_NAMES_LIMIT = 100;

/**
 * One result document per run, for its optional name, description and CI run link
 * (`opensearch.test.suite.run.name` / `.description`, `cicd.pipeline.run.url.full`). They are
 * read from whole documents, not grouped by: PPL fails on a field the index mapping does not
 * have (old data, no run names), and they are the same on every result of a run. One run needs
 * no `dedup` (`head 1`).
 */
export const buildRunNamesQuery = (index: string, runIds: string[]): string => {
  const ids = runIds.slice(0, RUN_NAMES_LIMIT);
  return join([
    ...base(index),
    `where ${ids.length > 1 ? `(${runsWhere(ids)})` : runsWhere(ids)}`,
    ...(ids.length > 1 ? [`dedup ${fld(F.runId)}`] : []),
    `head ${ids.length}`,
  ]);
};

/** At most this many cases of a run (or of two) get their name read (`buildCaseNamesQuery`). */
export const CASE_NAMES_LIMIT = 500;

/**
 * One result document per case of one or two runs, for the case's optional name
 * (`test.case.name`), read from whole documents like the run names (not grouped by).
 */
export const buildCaseNamesQuery = (index: string, runIds: string[]): string =>
  join([
    ...base(index),
    `where ${runIds.length > 1 ? `(${runsWhere(runIds)})` : runsWhere(runIds)}`,
    `dedup ${fld(F.caseId)}`,
    `head ${CASE_NAMES_LIMIT}`,
  ]);

/**
 * One result document per evaluation of a run, for what each evaluator checks
 * (`opensearch.gen_ai.evaluation.evaluator.description`). Whole documents, not grouped by: PPL
 * fails on a field the index mapping does not have (old data).
 */
export const buildRunEvaluatorsQuery = (index: string, runId: string): string =>
  join([...base(index), `where ${runsWhere([runId])}`, `dedup ${fld(F.name)}`, 'head 100']);

/** First and last result of one or two runs: the window the run and compare pages read. */
export const buildRunWindowQuery = (index: string, runIds: string[]): string =>
  join([
    ...base(index),
    `where ${runsWhere(runIds)}`,
    `stats min(${fld(F.time)}) as first, max(${fld(F.time)}) as last`,
  ]);

/**
 * The cases of a run. Case names and the CI link are not grouped by (`buildCaseNamesQuery`,
 * `buildRunNamesQuery`).
 */
export const buildRunCasesQuery = (index: string, runId: string): string =>
  join([
    ...base(index),
    `where ${runsWhere([runId])}`,
    ...verdictStats(
      [
        ...[F.runId, F.suiteName, F.agentName, F.agentVersion, F.caseId, F.name].map(fld),
        VERDICT,
        fld(F.traceId),
      ],
      [minOf(F.time, 't0'), maxOf(F.time, 't1')]
    ),
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
    ...verdictStats(
      [
        ...[F.runId, F.suiteName, F.agentName, F.agentVersion, F.caseId, F.name].map(fld),
        VERDICT,
        fld(F.traceId),
      ],
      [minOf(F.time, 'started')]
    ),
    head,
  ]);

/** At most this many spans per trace are read to find its AI root (`buildAiRootCandidatesQuery`). */
export const AI_ROOT_CANDIDATES_LIMIT = 10;

/**
 * The spans results point to, by exact trace and span id (what each result judged): whole
 * documents, so a tool span's arguments and result are there too. One span per pair.
 */
export const buildResultSpansQuery = (
  spansIndex: string,
  refs: Array<{ traceId: string; spanId: string }>
): string => {
  const conds = refs.map(
    (r) => `${fld(SF.traceId)} = ${quote(r.traceId)} and ${fld(SF.spanId)} = ${quote(r.spanId)}`
  );
  return join([
    `source = ${spansIndex}`,
    `where ${conds.length > 1 ? conds.map((c) => `(${c})`).join(' or ') : conds[0]}`,
    `head ${refs.length}`,
  ]);
};

/**
 * The spans that can be a trace's AI root, for results without a span id: its root and its
 * GenAI spans, earliest first (the root and the outermost GenAI spans start first). The browser
 * picks the AI root by Agent Traces' rule (`aiRootSpanOf`): a GenAI or marked root, else the
 * earliest marked span, else the earliest GenAI span (an agent behind an HTTP handler), else the
 * root. The marker is read from the documents, not named in PPL (it may be unmapped).
 */
export const buildAiRootCandidatesQuery = (spansIndex: string, traceId: string): string =>
  join([
    `source = ${spansIndex}`,
    `where ${fld(SF.traceId)} = ${quote(traceId)} and (${fld(SF.parentSpanId)} = '' or isnotnull(${fld(
      SF.operation
    )}))`,
    'sort startTime',
    `head ${AI_ROOT_CANDIDATES_LIMIT}`,
  ]);

/**
 * The turns of a session (`gen_ai.conversation.id`), oldest first: its spans that are AI roots by
 * the Agent Traces rule (`aiRootConditionOf`): a GenAI span without a parent, or a span marked
 * `derived.gen_ai.is_root`. The marker is named only when the span index maps it
 * (`markerMapped`, checked as Agent Traces does): PPL rejects a query on an unmapped field. The
 * browser keeps one span per trace (`sessionTurnsOf`).
 */
export const buildSessionRootsQuery = (
  spansIndex: string,
  conversationId: string,
  markerMapped = false
): string =>
  join([
    `source = ${spansIndex}`,
    `where ${fld(SF.conversationId)} = ${quote(conversationId)} and (${aiRootConditionOf(
      markerMapped
    )})`,
    `sort ${fld(SF.startTime)}`,
    `fields ${[
      SF.traceId,
      SF.spanId,
      SF.parentSpanId,
      SF.startTime,
      SF.operation,
      ...(markerMapped ? [AI_ROOT_FIELD] : []),
      SF.input,
      SF.output,
    ]
      .map(fld)
      .join(', ')}`,
    `head ${SESSION_TURNS_LIMIT}`,
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
    `where ${anyOf(SF.traceId, traceIds)}`,
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
    ...verdictStats([fld(F.traceId), ...(bySpan ? [fld(F.spanId)] : [])]),
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

/** The `where` commands of the filters, without the verdict (`verdictWhere`). */
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

/** The verdict filter, as conditions on the raw fields (an `eval` first would drop results). */
const verdictWhere = (f: ResultsFilters, except?: Facet): string[] =>
  f.verdicts.length && except !== 'verdicts'
    ? [
        `where ${
          f.verdicts.length > 1
            ? f.verdicts.map((v) => `(${verdictCond(v)})`).join(' or ')
            : verdictCond(f.verdicts[0])
        }`,
      ]
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
    facet === 'agents' ? fld(F.agentName) : facet === 'names' ? fld(F.name) : fld(F.agentVersion);
  return join([
    ...base(index),
    ...resultsWhere(filters, facet),
    ...verdictWhere(filters, facet),
    ...(facet === 'verdicts' ? verdictStats([]) : [`stats count() as n by ${by}`]),
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
