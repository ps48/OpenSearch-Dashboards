/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AGG_LIMIT,
  DEFAULT_RESULTS_SORT,
  EMPTY_RESULTS_FILTERS,
  NO_AGENT,
  NO_VERSION,
  buildAgentEvaluationsQuery,
  buildAgentSuitesQuery,
  buildAgentTrendQuery,
  buildAgentsQuery,
  buildCaseResultsQuery,
  buildCompareRunsQuery,
  buildFacetQuery,
  buildOneTraceSpansQuery,
  buildResultSpansQuery,
  buildAiRootCandidatesQuery,
  buildMarkedSpansQuery,
  AI_ROOT_CANDIDATES_LIMIT,
  buildRunsLookupQuery,
  buildRunNamesQuery,
  RUN_NAMES_LIMIT,
  CASE_NAMES_LIMIT,
  buildCaseNamesQuery,
  buildRunEvaluatorsQuery,
  buildResultsTotalQuery,
  buildEvalRunsQuery,
  buildEvalRunCasesQuery,
  buildRunsFacetQuery,
  EMPTY_RUNS_FILTERS,
  buildSessionResultsQuery,
  buildSuiteRunCasesQuery,
  buildSessionRootsQuery,
  buildResultsCountQuery,
  buildResultsPageQuery,
  buildRunCasesQuery,
  buildRunWindowQuery,
  buildSuiteRunsQuery,
  buildTraceResultsQuery,
  buildTraceSpansQuery,
  buildTracesTallyQuery,
  isTruncated,
  likeLiteral,
  trendStep,
  verdictStats,
  verdictCond,
  countOf,
  sumOf,
  minOf,
  maxOf,
  VERDICT,
} from './ppl_queries';

const I = 'evals-*';
const NONE = EMPTY_RESULTS_FILTERS;
const BASE = ['source = evals-*', "where `eventName` = 'gen_ai.evaluation.result'"];
const VERD =
  "eval verdict = case(isnotnull(`attributes.error.type`), 'error', " +
  "`attributes.gen_ai.evaluation.score.label` = 'pass', 'pass', " +
  "`attributes.gen_ai.evaluation.score.label` = 'fail', 'fail' else 'scored')";

/** Grouped by before the verdict exists (stats first: an `eval` first drops results). */
const VKEYS = '`attributes.error.type`, `attributes.gen_ai.evaluation.score.label`';

/** Evaluations table, the `by` list per stage (the label is a group already: not twice). */
const EVALS_BY_1 =
  '`attributes.gen_ai.evaluation.name`, `attributes.gen_ai.agent.version`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`, `attributes.opensearch.gen_ai.evaluation.score.direction`';
const EVALS_BY_2 =
  '`attributes.gen_ai.evaluation.name`, `attributes.gen_ai.agent.version`, verdict, `attributes.gen_ai.evaluation.score.label`, `attributes.opensearch.gen_ai.evaluation.score.direction`';
const EVALS_AGGS_1 =
  'stats count() as n, count(`attributes.gen_ai.evaluation.score.value`) as nv, avg(`attributes.gen_ai.evaluation.score.value`) as sum_score_avg, min(`@timestamp`) as first, max(`@timestamp`) as last by ';
const EVALS_AGGS_2 =
  'stats sum(n) as n, sum(nv) as nv, sum(sum_score) as sum_score, min(first) as first, max(last) as last by ';
// The sum as avg * count per group: `sum()` drops decimals where the score is mapped as long.
const EVALS_VERD = `${VERD}, sum_score = sum_score_avg * nv`;
const EVALS_AVG = ['eval avg_score = sum_score / nv', 'fields - sum_score'];

const RUN_STATS = [
  'stats count() as n, min(`@timestamp`) as t0, max(`@timestamp`) as t1 by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.test.case.id`, `attributes.gen_ai.evaluation.name`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`, `traceId`',
  VERD,
  'stats sum(n) as n, min(t0) as t0, max(t1) as t1 by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.test.case.id`, `attributes.gen_ai.evaluation.name`, verdict, `traceId`',
];

/** The verdict filter on raw fields, one condition per verdict. */
const W_PASS =
  "`attributes.gen_ai.evaluation.score.label` = 'pass' and isnull(`attributes.error.type`)";
const W_FAIL =
  "`attributes.gen_ai.evaluation.score.label` = 'fail' and isnull(`attributes.error.type`)";
const W_SCORED =
  "isnull(`attributes.error.type`) and (isnull(`attributes.gen_ai.evaluation.score.label`) or (`attributes.gen_ai.evaluation.score.label` != 'pass' and `attributes.gen_ai.evaluation.score.label` != 'fail'))";
const W_ERROR = 'isnotnull(`attributes.error.type`)';

/** The exact PPL of every screen (each was run on a cluster with the P0 data contract). */
describe('evaluation PPL', () => {
  it('Agents: one aggregation by agent, version, evaluation and verdict', () => {
    expect(buildAgentsQuery(I, 'all')).toBe(
      [
        ...BASE,
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.gen_ai.evaluation.name`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`',
        VERD,
        'stats sum(n) as n, min(first) as first, max(last) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.gen_ai.evaluation.name`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agents: Online and search pushed down', () => {
    expect(buildAgentsQuery(I, 'online', "o'brien")).toBe(
      [
        ...BASE,
        'where isnull(`attributes.test.suite.run.id`)',
        "where like(`attributes.gen_ai.agent.name`, '%o\\'brien%')",
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.gen_ai.evaluation.name`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`',
        VERD,
        'stats sum(n) as n, min(first) as first, max(last) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.gen_ai.evaluation.name`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Evaluations table: by evaluation, version, verdict, label and direction', () => {
    expect(buildAgentEvaluationsQuery(I, 'travel_planner', 'all')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'travel_planner'",
        EVALS_AGGS_1 + EVALS_BY_1,
        EVALS_VERD,
        EVALS_AGGS_2 + EVALS_BY_2,
        ...EVALS_AVG,
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Evaluations table: results without an agent name, offline', () => {
    expect(buildAgentEvaluationsQuery(I, NO_AGENT, 'offline')).toBe(
      [
        ...BASE,
        'where isnull(`attributes.gen_ai.agent.name`)',
        'where isnotnull(`attributes.test.suite.run.id`)',
        // Offline: by run too, so each version is read at its latest run.
        `${EVALS_AGGS_1}${EVALS_BY_1}, \`attributes.test.suite.run.id\``,
        EVALS_VERD,
        `${EVALS_AGGS_2}${EVALS_BY_2}, \`attributes.test.suite.run.id\``,
        ...EVALS_AVG,
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Pass rate over time: pass and fail per bucket and version', () => {
    expect(buildAgentTrendQuery(I, 'travel_planner', 'online', '3h')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'travel_planner'",
        'where isnull(`attributes.test.suite.run.id`)',
        `where (${W_PASS}) or (${W_FAIL})`,
        `stats count() as n by span(\`@timestamp\`, 3h) as t, \`attributes.gen_ai.agent.version\`, ${VKEYS}`,
        VERD,
        'stats sum(n) as n by t, `attributes.gen_ai.agent.version`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Suites tab: by suite, run, version and verdict', () => {
    expect(buildAgentSuitesQuery(I, 'support_bot')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'support_bot'",
        'where isnotnull(`attributes.test.suite.run.id`)',
        `stats count() as n, min(\`@timestamp\`) as started by \`attributes.test.suite.name\`, \`attributes.test.suite.run.id\`, \`attributes.gen_ai.agent.version\`, ${VKEYS}`,
        VERD,
        'stats sum(n) as n, min(started) as started by `attributes.test.suite.name`, `attributes.test.suite.run.id`, `attributes.gen_ai.agent.version`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Suite: by run, agent, version and verdict (no CI URL)', () => {
    expect(buildSuiteRunsQuery(I, 'golden')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.name` = 'golden'",
        `stats count() as n, min(\`@timestamp\`) as started by \`attributes.test.suite.run.id\`, \`attributes.gen_ai.agent.name\`, \`attributes.gen_ai.agent.version\`, ${VKEYS}`,
        VERD,
        'stats sum(n) as n, min(started) as started by `attributes.test.suite.run.id`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Suite: cases and cases passed per run (two aggregations)', () => {
    expect(buildSuiteRunCasesQuery(I, "it's")).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.name` = 'it\\'s'",
        `stats count() as n by \`attributes.test.suite.run.id\`, \`attributes.test.case.id\`, ${VKEYS}`,
        "eval bad = if(isnotnull(`attributes.error.type`) or `attributes.gen_ai.evaluation.score.label` = 'fail', n, 0), good = if(`attributes.gen_ai.evaluation.score.label` = 'pass', n, 0)",
        'stats sum(bad) as bad, sum(good) as good by `attributes.test.suite.run.id`, `attributes.test.case.id`',
        // A case with scores only (no pass rule) has not passed.
        'eval ok = if(bad = 0 and good > 0, 1, 0)',
        'stats count() as cases, sum(ok) as passed by `attributes.test.suite.run.id`',
        'head 10000',
      ].join(' | ')
    );
  });

  describe('Eval runs', () => {
    const RUNS_STATS = [
      `stats count() as n, min(\`@timestamp\`) as started by \`attributes.test.suite.run.id\`, \`attributes.test.suite.name\`, \`attributes.gen_ai.agent.name\`, \`attributes.gen_ai.agent.version\`, ${VKEYS}`,
      VERD,
      'stats sum(n) as n, min(started) as started by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, verdict',
    ];
    const OFFLINE = 'where isnotnull(`attributes.test.suite.run.id`)';

    it('every run: the suite runs aggregation without the suite, by suite, latest first', () => {
      expect(buildEvalRunsQuery(I, EMPTY_RUNS_FILTERS)).toBe(
        [...BASE, OFFLINE, ...RUNS_STATS, 'sort - started', 'head 10000'].join(' | ')
      );
    });

    it('filters by agents, suites and an escaped search in run id, suite and agent', () => {
      const filters = { agents: ['tp', '~none'], suites: ["it's"], q: "50%_o'k" };
      const pattern = "'%50\\\\%\\\\_o\\'k%'";
      const where = [
        OFFLINE,
        "where `attributes.gen_ai.agent.name` = 'tp' or isnull(`attributes.gen_ai.agent.name`)",
        "where `attributes.test.suite.name` = 'it\\'s'",
        `where like(\`attributes.test.suite.run.id\`, ${pattern}) or like(\`attributes.test.suite.name\`, ${pattern}) or like(\`attributes.gen_ai.agent.name\`, ${pattern})`,
      ];
      expect(buildEvalRunsQuery(I, filters)).toBe(
        [...BASE, ...where, ...RUNS_STATS, 'sort - started', 'head 10000'].join(' | ')
      );
      // Cases passed per run: the same filters, the suite page's two aggregations.
      expect(buildEvalRunCasesQuery(I, filters)).toBe(
        [
          ...BASE,
          ...where,
          `stats count() as n by \`attributes.test.suite.run.id\`, \`attributes.test.case.id\`, ${VKEYS}`,
          "eval bad = if(isnotnull(`attributes.error.type`) or `attributes.gen_ai.evaluation.score.label` = 'fail', n, 0), good = if(`attributes.gen_ai.evaluation.score.label` = 'pass', n, 0)",
          'stats sum(bad) as bad, sum(good) as good by `attributes.test.suite.run.id`, `attributes.test.case.id`',
          'eval ok = if(bad = 0 and good > 0, 1, 0)',
          'stats count() as cases, sum(ok) as passed by `attributes.test.suite.run.id`',
          'head 10000',
        ].join(' | ')
      );
    });

    it('a filter menu counts runs, without its own filter', () => {
      const filters = { agents: ['tp'], suites: ['golden'], q: '' };
      expect(buildRunsFacetQuery(I, filters, 'suites')).toBe(
        [
          ...BASE,
          OFFLINE,
          "where `attributes.gen_ai.agent.name` = 'tp'",
          'stats dc(`attributes.test.suite.run.id`) as n by `attributes.test.suite.name`',
          'sort - n',
          'head 50',
        ].join(' | ')
      );
      expect(buildRunsFacetQuery(I, filters, 'agents')).toContain(
        "where `attributes.test.suite.name` = 'golden' | stats dc(`attributes.test.suite.run.id`) as n by `attributes.gen_ai.agent.name`"
      );
    });
  });

  it('Run: by run, case, evaluation, verdict and trace (no case name or CI URL)', () => {
    expect(buildRunCasesQuery(I, 'run_1')).toBe(
      [...BASE, "where `attributes.test.suite.run.id` = 'run_1'", ...RUN_STATS, 'head 10000'].join(
        ' | '
      )
    );
  });

  it('No aggregation groups by the case name or the CI URL', () => {
    const queries = [
      buildRunCasesQuery(I, 'run_1'),
      buildCompareRunsQuery(I, 'a', 'b'),
      buildSuiteRunsQuery(I, 'golden'),
      buildEvalRunsQuery(I, EMPTY_RUNS_FILTERS),
      buildAgentSuitesQuery(I, 'travel'),
    ];
    queries.forEach((q) => {
      expect(q).not.toContain('test.case.name');
      expect(q).not.toContain('cicd.pipeline.run.url.full');
    });
  });

  it('Run names: one whole document per run, never grouped by the optional name', () => {
    // One run: `head 1` keeps one document, no dedup.
    expect(buildRunNamesQuery(I, ['r1'])).toBe(
      [...BASE, "where `attributes.test.suite.run.id` = 'r1'", 'head 1'].join(' | ')
    );
    expect(buildRunNamesQuery(I, ['r1', 'r2'])).toBe(
      [
        ...BASE,
        "where (`attributes.test.suite.run.id` = 'r1' or `attributes.test.suite.run.id` = 'r2')",
        'dedup `attributes.test.suite.run.id`',
        'head 2',
      ].join(' | ')
    );
    const many = Array.from({ length: RUN_NAMES_LIMIT + 5 }, (_, i) => `r${i}`);
    const q = buildRunNamesQuery(I, many);
    expect(q).toContain(`head ${RUN_NAMES_LIMIT}`);
    expect(q).not.toContain(`'r${RUN_NAMES_LIMIT}'`);
    expect(q).not.toContain('run.name');
    expect(q).not.toContain('cicd');
  });

  it('Case names: one whole document per case of one or two runs', () => {
    expect(buildCaseNamesQuery(I, ['r1'])).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'r1'",
        'dedup `attributes.test.case.id`',
        `head ${CASE_NAMES_LIMIT}`,
      ].join(' | ')
    );
    expect(buildCaseNamesQuery(I, ['r1', "r'2"])).toBe(
      [
        ...BASE,
        "where (`attributes.test.suite.run.id` = 'r1' or `attributes.test.suite.run.id` = 'r\\'2')",
        'dedup `attributes.test.case.id`',
        'head 500',
      ].join(' | ')
    );
  });

  it('Run page: one document per evaluation of the run, for what each checks', () => {
    expect(buildRunEvaluatorsQuery(I, "r'1")).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'r\\'1'",
        'dedup `attributes.gen_ai.evaluation.name`',
        'head 100',
      ].join(' | ')
    );
  });

  it('Setup and Settings: the number of results', () => {
    expect(buildResultsTotalQuery(I)).toBe([...BASE, 'stats count() as n'].join(' | '));
  });

  it('Run: the runs in the range, to find the run before', () => {
    // One suite's runs by agent (only the same agent's run is the run before), latest first:
    // the cap drops the oldest runs.
    expect(buildRunsLookupQuery(I, "it's")).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.name` = 'it\\'s'",
        'stats min(`@timestamp`) as started by `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.test.suite.run.id`',
        'sort - started',
        'head 10000',
      ].join(' | ')
    );
  });

  it('escapes LIKE wildcards in search text', () => {
    expect(likeLiteral('50%_a\\b')).toBe('50\\%\\_a\\\\b');
    expect(buildAgentsQuery(I, 'all', 'a_b')).toContain(
      "where like(`attributes.gen_ai.agent.name`, '%a\\\\_b%')"
    );
  });

  it('flags an aggregation that hit the cap', () => {
    expect(isTruncated(new Array(AGG_LIMIT))).toBe(true);
    expect(isTruncated(new Array(AGG_LIMIT - 1))).toBe(false);
  });

  it('Run, compare runs: the first and last result of the runs (their window)', () => {
    expect(buildRunWindowQuery(I, ['run_1'])).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_1'",
        'stats min(`@timestamp`) as first, max(`@timestamp`) as last',
      ].join(' | ')
    );
    expect(buildRunWindowQuery(I, ['run_a', "it's"])).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_a' or `attributes.test.suite.run.id` = 'it\\'s'",
        'stats min(`@timestamp`) as first, max(`@timestamp`) as last',
      ].join(' | ')
    );
  });

  it('Result flyout, session results: the AI-root spans of the session turns, oldest first', () => {
    // The marker is unmapped: parentless GenAI spans only (as Agent Traces).
    expect(buildSessionRootsQuery('spans-*', "conv'1")).toBe(
      [
        'source = spans-*',
        "where `attributes.gen_ai.conversation.id` = 'conv\\'1' and (parentSpanId = \"\" AND isnotnull(`attributes.gen_ai.operation.name`))",
        'sort `startTime`',
        'fields `traceId`, `spanId`, `parentSpanId`, `startTime`, `attributes.gen_ai.operation.name`, `attributes.gen_ai.input.messages`, `attributes.gen_ai.output.messages`',
        'head 50',
      ].join(' | ')
    );
    // The marker is mapped: marked spans too, and the marker is read.
    expect(buildSessionRootsQuery('spans-*', 'c', true)).toBe(
      [
        'source = spans-*',
        'where `attributes.gen_ai.conversation.id` = \'c\' and ((parentSpanId = "" AND isnotnull(`attributes.gen_ai.operation.name`)) OR `attributes.derived.gen_ai.is_root` = true)',
        'sort `startTime`',
        'fields `traceId`, `spanId`, `parentSpanId`, `startTime`, `attributes.gen_ai.operation.name`, `attributes.derived.gen_ai.is_root`, `attributes.gen_ai.input.messages`, `attributes.gen_ai.output.messages`',
        'head 50',
      ].join(' | ')
    );
  });

  it('Compare runs, result flyout: one case in two runs', () => {
    expect(buildCaseResultsQuery(I, ['run_a', 'run_b'], 'c-1')).toBe(
      [
        ...BASE,
        "where (`attributes.test.suite.run.id` = 'run_a' or `attributes.test.suite.run.id` = 'run_b') and `attributes.test.case.id` = 'c-1'",
        'head 100',
      ].join(' | ')
    );
  });

  it('Judged spans: the span each result points to, by exact trace and span id', () => {
    expect(buildResultSpansQuery('spans-*', [{ traceId: 't1', spanId: 's1' }])).toBe(
      "source = spans-* | where `traceId` = 't1' and `spanId` = 's1' | head 1"
    );
    expect(
      buildResultSpansQuery('spans-*', [
        { traceId: 't1', spanId: 's1' },
        { traceId: "t'2", spanId: 's2' },
      ])
    ).toBe(
      [
        'source = spans-*',
        "where (`traceId` = 't1' and `spanId` = 's1') or (`traceId` = 't\\'2' and `spanId` = 's2')",
        'head 2',
      ].join(' | ')
    );
  });

  it("AI-root candidates: a trace's root and GenAI spans, earliest first, at most 10", () => {
    expect(buildAiRootCandidatesQuery('spans-*', 't1')).toBe(
      [
        'source = spans-*',
        "where `traceId` = 't1' and (`parentSpanId` = '' or isnotnull(`attributes.gen_ai.operation.name`))",
        'sort startTime',
        `head ${AI_ROOT_CANDIDATES_LIMIT}`,
      ].join(' | ')
    );
    expect(AI_ROOT_CANDIDATES_LIMIT).toBe(10);
    // The AI-root marker is read from the documents, never named (it may be unmapped).
    expect(buildAiRootCandidatesQuery('spans-*', 't1')).not.toContain('is_root');
  });

  it('the marked spans of one or two traces, read apart from the candidates', () => {
    expect(buildMarkedSpansQuery('spans-*', ['t1'])).toBe(
      [
        'source = spans-*',
        "where `traceId` = 't1' and `attributes.derived.gen_ai.is_root` = true",
        'sort startTime',
        'head 10',
      ].join(' | ')
    );
    expect(buildMarkedSpansQuery('spans-*', ['t1', 't2'])).toBe(
      [
        'source = spans-*',
        "where (`traceId` = 't1' or `traceId` = 't2') and `attributes.derived.gen_ai.is_root` = true",
        'sort startTime',
        'head 20',
      ].join(' | ')
    );
  });

  it('Result flyout: the judge trace', () => {
    expect(buildOneTraceSpansQuery('spans-*', 'j1')).toBe(
      "source = spans-* | where `traceId` = 'j1' | sort startTime | head 200"
    );
  });

  it('Run: an expanded case reads at most 100 documents', () => {
    expect(buildCaseResultsQuery(I, 'run_1', 'c-1')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_1' and `attributes.test.case.id` = 'c-1'",
        'head 100',
      ].join(' | ')
    );
  });

  it('Compare runs: one aggregation over both runs', () => {
    expect(buildCompareRunsQuery(I, 'run_a', 'run_b')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_a' or `attributes.test.suite.run.id` = 'run_b'",
        'stats count() as n, min(`@timestamp`) as started by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.test.case.id`, `attributes.gen_ai.evaluation.name`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`, `traceId`',
        VERD,
        'stats sum(n) as n, min(started) as started by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.test.case.id`, `attributes.gen_ai.evaluation.name`, verdict, `traceId`',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Compare traces: spans of both traces', () => {
    expect(buildTraceSpansQuery('spans-*', ['t1', 't2'])).toBe(
      [
        'source = spans-*',
        "where `traceId` = 't1' or `traceId` = 't2'",
        'sort startTime',
        'head 2000',
      ].join(' | ')
    );
  });

  it('Trace flyout: results of one trace', () => {
    expect(buildTraceResultsQuery(I, ['t1'])).toBe(
      [...BASE, "where `traceId` = 't1'", 'head 200'].join(' | ')
    );
  });

  it('Session flyout: the session-level results of a conversation', () => {
    expect(buildSessionResultsQuery(I, 'conv-1')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.conversation.id` = 'conv-1' and `attributes.opensearch.gen_ai.evaluation.level` = 'session'",
        'head 200',
      ].join(' | ')
    );
  });

  it('Agent Traces column: a tally per trace of the page', () => {
    expect(buildTracesTallyQuery(I, ['t1', 't2'])).toBe(
      [
        ...BASE,
        "where `traceId` = 't1' or `traceId` = 't2'",
        `stats count() as n by \`traceId\`, ${VKEYS}`,
        VERD,
        'stats sum(n) as n by `traceId`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent Traces spans column: a tally per span', () => {
    expect(buildTracesTallyQuery(I, ['t1'], true)).toBe(
      [
        ...BASE,
        "where `traceId` = 't1'",
        `stats count() as n by \`traceId\`, \`spanId\`, ${VKEYS}`,
        VERD,
        'stats sum(n) as n by `traceId`, `spanId`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Results: one page, newest first', () => {
    expect(buildResultsPageQuery(I, NONE, DEFAULT_RESULTS_SORT, 0)).toBe(
      [...BASE, 'sort - `@timestamp`', 'head 25 from 0'].join(' | ')
    );
  });

  it('Results: every filter pushed down, sort by score, page 3', () => {
    expect(
      buildResultsPageQuery(
        I,
        {
          ...NONE,
          agents: ['a1', NO_AGENT],
          names: ['helpfulness'],
          verdicts: ['fail', 'scored'],
          source: 'online',
          q: 'vague',
        },
        { field: 'score', direction: 'asc' },
        2
      )
    ).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'a1' or isnull(`attributes.gen_ai.agent.name`)",
        "where `attributes.gen_ai.evaluation.name` = 'helpfulness'",
        'where isnull(`attributes.test.suite.run.id`)',
        "where like(`attributes.gen_ai.evaluation.explanation`, '%vague%')",
        `where (${W_FAIL}) or (${W_SCORED})`,
        'sort `attributes.gen_ai.evaluation.score.value`',
        'head 25 from 50',
      ].join(' | ')
    );
  });

  it('Results: locked to an agent (agent filter ignored), sort by agent', () => {
    expect(
      buildResultsPageQuery(
        I,
        { ...NONE, lockAgent: 'a1', agents: ['ignored'], source: 'offline' },
        { field: 'agent', direction: 'desc' },
        0
      )
    ).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'a1'",
        'where isnotnull(`attributes.test.suite.run.id`)',
        'sort - `attributes.gen_ai.agent.name`',
        'head 25 from 0',
      ].join(' | ')
    );
  });

  it('Results: total', () => {
    expect(buildResultsCountQuery(I, NONE)).toBe([...BASE, 'stats count() as total'].join(' | '));
  });

  it('Results: total with a verdict filter', () => {
    expect(buildResultsCountQuery(I, { ...NONE, verdicts: ['fail'] })).toBe(
      [...BASE, `where ${W_FAIL}`, 'stats count() as total'].join(' | ')
    );
  });

  it('Results: Evaluation menu values (own filter left out)', () => {
    expect(buildFacetQuery(I, { ...NONE, names: ['x'], agents: ['a1'] }, 'names')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'a1'",
        'stats count() as n by `attributes.gen_ai.evaluation.name`',
        'sort - n',
        'head 50',
      ].join(' | ')
    );
  });

  it('Results: Verdict menu values', () => {
    expect(buildFacetQuery(I, { ...NONE, verdicts: ['pass'], names: ['x'] }, 'verdicts')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.evaluation.name` = 'x'",
        `stats count() as n by ${VKEYS}`,
        VERD,
        'stats sum(n) as n by verdict',
        'sort - n',
        'head 50',
      ].join(' | ')
    );
  });

  it('Results: Version filter pushed down (no version: isnull)', () => {
    expect(
      buildResultsPageQuery(
        I,
        { ...NONE, lockAgent: 'a1', versions: ['v2', NO_VERSION], verdicts: ['fail'] },
        DEFAULT_RESULTS_SORT,
        0
      )
    ).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'a1'",
        "where `attributes.gen_ai.agent.version` = 'v2' or isnull(`attributes.gen_ai.agent.version`)",
        `where ${W_FAIL}`,
        'sort - `@timestamp`',
        'head 25 from 0',
      ].join(' | ')
    );
    expect(buildResultsCountQuery(I, { ...NONE, versions: ['v2'] })).toBe(
      [...BASE, "where `attributes.gen_ai.agent.version` = 'v2'", 'stats count() as total'].join(
        ' | '
      )
    );
  });

  it('Results: Version menu values (own filter left out)', () => {
    expect(buildFacetQuery(I, { ...NONE, lockAgent: 'a1', versions: ['v2'] }, 'versions')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'a1'",
        'stats count() as n by `attributes.gen_ai.agent.version`',
        'sort - n',
        'head 50',
      ].join(' | ')
    );
  });

  it('Results: Agent menu values', () => {
    expect(buildFacetQuery(I, { ...NONE, lockAgent: 'a1' }, 'agents')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'a1'",
        'stats count() as n by `attributes.gen_ai.agent.name`',
        'sort - n',
        'head 50',
      ].join(' | ')
    );
  });

  it('picks a bucket that keeps a range to about 60 points', () => {
    const H = 3600e3;
    expect(trendStep(H).step).toBe('1m');
    expect(trendStep(24 * H).step).toBe('1h');
    expect(trendStep(7 * 24 * H).step).toBe('3h');
    expect(trendStep(30 * 24 * H).step).toBe('12h');
    expect(trendStep(365 * 24 * H).step).toBe('1w');
  });
});

/**
 * PPL runs an `eval` before a `stats` or `where` as a script, which drops the results of indices
 * that do not map a field it names: the verdict is computed after a first `stats` on raw fields.
 */
describe('verdict, stats first', () => {
  it('no groups: by the raw verdict fields, then by verdict', () => {
    expect(verdictStats([])).toEqual([
      `stats count() as n by ${VKEYS}`,
      VERD,
      'stats sum(n) as n by verdict',
    ]);
  });

  it('field groups, the verdict last; each aggregation re-aggregates its own column', () => {
    expect(
      verdictStats(
        ['`a`', '`b`'],
        [countOf('x', 'nx'), sumOf('x', 'sx'), minOf('t', 'first'), maxOf('t', 'last')]
      )
    ).toEqual([
      `stats count() as n, count(\`x\`) as nx, sum(\`x\`) as sx, min(\`t\`) as first, max(\`t\`) as last by \`a\`, \`b\`, ${VKEYS}`,
      VERD,
      'stats sum(n) as n, sum(nx) as nx, sum(sx) as sx, min(first) as first, max(last) as last by `a`, `b`, verdict',
    ]);
  });

  it('the verdict where VERDICT marks it, and a raw verdict field grouped by only once', () => {
    expect(
      verdictStats(['`a`', VERDICT, '`attributes.gen_ai.evaluation.score.label`', '`b`'])
    ).toEqual([
      'stats count() as n by `a`, `attributes.error.type`, `attributes.gen_ai.evaluation.score.label`, `b`',
      VERD,
      'stats sum(n) as n by `a`, verdict, `attributes.gen_ai.evaluation.score.label`, `b`',
    ]);
  });

  it('a span bucket is re-grouped by its name', () => {
    expect(verdictStats(['span(`@timestamp`, 1h) as t'])).toEqual([
      `stats count() as n by span(\`@timestamp\`, 1h) as t, ${VKEYS}`,
      VERD,
      'stats sum(n) as n by t, verdict',
    ]);
  });

  it('verdict filters are conditions on the raw fields (as the verdict rule)', () => {
    expect(verdictCond('error')).toBe(W_ERROR);
    expect(verdictCond('pass')).toBe(W_PASS);
    expect(verdictCond('fail')).toBe(W_FAIL);
    expect(verdictCond('scored')).toBe(W_SCORED);
    expect(buildResultsCountQuery(I, { ...NONE, verdicts: ['error', 'pass'] })).toBe(
      [...BASE, `where (${W_ERROR}) or (${W_PASS})`, 'stats count() as total'].join(' | ')
    );
  });

  it('no builder runs an eval before an aggregation or a filter', () => {
    const F_ALL = { ...NONE, verdicts: ['pass', 'fail', 'scored', 'error'] };
    const runs = { agents: ['a'], suites: ['s'], q: 'x' };
    const queries = [
      buildAgentsQuery(I, 'all', 'x'),
      buildAgentEvaluationsQuery(I, 'a', 'offline'),
      buildAgentTrendQuery(I, 'a', 'all', '1h'),
      buildAgentSuitesQuery(I, 'a'),
      buildSuiteRunsQuery(I, 's'),
      buildSuiteRunCasesQuery(I, 's'),
      buildEvalRunsQuery(I, runs),
      buildEvalRunCasesQuery(I, runs),
      buildRunCasesQuery(I, 'r'),
      buildCompareRunsQuery(I, 'a', 'b'),
      buildTracesTallyQuery(I, ['t'], true),
      buildResultsPageQuery(I, F_ALL, DEFAULT_RESULTS_SORT, 0),
      buildResultsCountQuery(I, F_ALL),
      buildFacetQuery(I, F_ALL, 'verdicts'),
      buildFacetQuery(I, F_ALL, 'names'),
    ];
    queries.forEach((q) => {
      const commands = q.split(' | ');
      const firstStats = commands.findIndex((c) => c.startsWith('stats '));
      commands.forEach((c, i) => {
        if (c.startsWith('eval ')) expect(firstStats >= 0 && i > firstStats).toBe(true);
      });
      expect(q).not.toContain('where verdict');
    });
  });
});
