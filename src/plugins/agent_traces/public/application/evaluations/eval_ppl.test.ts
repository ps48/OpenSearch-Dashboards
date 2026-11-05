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
  buildRootSpansQuery,
  buildRunsLookupQuery,
  buildEvalRunsQuery,
  buildEvalRunCasesQuery,
  buildRunsFacetQuery,
  EMPTY_RUNS_FILTERS,
  buildSessionResultsQuery,
  buildSuiteRunCasesQuery,
  buildSessionRootsQuery,
  buildSpanQuery,
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
} from './eval_ppl';

const I = 'evals-*';
const NONE = EMPTY_RESULTS_FILTERS;
const BASE = ['source = evals-*', "where `eventName` = 'gen_ai.evaluation.result'"];
const VERD =
  "eval verdict = case(isnotnull(`attributes.error.type`), 'error', " +
  "`attributes.gen_ai.evaluation.score.label` = 'pass', 'pass', " +
  "`attributes.gen_ai.evaluation.score.label` = 'fail', 'fail' else 'scored')";

const EVALS_STATS =
  'stats count() as n, count(`attributes.gen_ai.evaluation.score.value`) as nv, avg(`attributes.gen_ai.evaluation.score.value`) as avg_score, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.evaluation.name`, `attributes.gen_ai.agent.version`, verdict, `attributes.gen_ai.evaluation.score.label`, `attributes.opensearch.gen_ai.evaluation.score.direction`';
const RUN_STATS =
  'stats count() as n, min(`@timestamp`) as t0, max(`@timestamp`) as t1 by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.cicd.pipeline.run.url.full`, `attributes.test.case.id`, `attributes.test.case.name`, `attributes.gen_ai.evaluation.name`, verdict, `traceId`';

/** The exact PPL of every screen (each was run on a cluster with the P0 data contract). */
describe('evaluation PPL', () => {
  it('Agents: one aggregation by agent, version, evaluation and verdict', () => {
    expect(buildAgentsQuery(I, 'all')).toBe(
      [
        ...BASE,
        VERD,
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.gen_ai.evaluation.name`, verdict',
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
        VERD,
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.gen_ai.evaluation.name`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Evaluations table: by evaluation, version, verdict, label and direction', () => {
    expect(buildAgentEvaluationsQuery(I, 'travel_planner', 'all')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'travel_planner'",
        VERD,
        EVALS_STATS,
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
        VERD,
        // Offline: by run too, so each version is read at its latest run.
        `${EVALS_STATS}, \`attributes.test.suite.run.id\``,
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
        VERD,
        "where verdict = 'pass' or verdict = 'fail'",
        'stats count() as n by span(`@timestamp`, 3h) as t, `attributes.gen_ai.agent.version`, verdict',
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
        VERD,
        'stats count() as n, min(`@timestamp`) as started by `attributes.test.suite.name`, `attributes.test.suite.run.id`, `attributes.gen_ai.agent.version`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Suite: by run, agent, version, CI URL and verdict', () => {
    expect(buildSuiteRunsQuery(I, 'golden')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.name` = 'golden'",
        VERD,
        'stats count() as n, min(`@timestamp`) as started by `attributes.test.suite.run.id`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.cicd.pipeline.run.url.full`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Suite: cases and cases passed per run (two aggregations)', () => {
    expect(buildSuiteRunCasesQuery(I, "it's")).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.name` = 'it\\'s'",
        "eval bad = if(isnotnull(`attributes.error.type`) or `attributes.gen_ai.evaluation.score.label` = 'fail', 1, 0), good = if(`attributes.gen_ai.evaluation.score.label` = 'pass', 1, 0)",
        'stats sum(bad) as bad, sum(good) as good by `attributes.test.suite.run.id`, `attributes.test.case.id`',
        // A case with scores only (no pass rule) has not passed.
        'eval ok = if(bad = 0 and good > 0, 1, 0)',
        'stats count() as cases, sum(ok) as passed by `attributes.test.suite.run.id`',
        'head 10000',
      ].join(' | ')
    );
  });

  describe('Eval runs', () => {
    const RUNS_STATS =
      'stats count() as n, min(`@timestamp`) as started by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, verdict';
    const OFFLINE = 'where isnotnull(`attributes.test.suite.run.id`)';

    it('every run: the suite runs aggregation without the suite, by suite, latest first', () => {
      expect(buildEvalRunsQuery(I, EMPTY_RUNS_FILTERS)).toBe(
        [...BASE, OFFLINE, VERD, RUNS_STATS, 'sort - started', 'head 10000'].join(' | ')
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
        [...BASE, ...where, VERD, RUNS_STATS, 'sort - started', 'head 10000'].join(' | ')
      );
      // Cases passed per run: the same filters, the suite page's two aggregations.
      expect(buildEvalRunCasesQuery(I, filters)).toBe(
        [
          ...BASE,
          ...where,
          "eval bad = if(isnotnull(`attributes.error.type`) or `attributes.gen_ai.evaluation.score.label` = 'fail', 1, 0), good = if(`attributes.gen_ai.evaluation.score.label` = 'pass', 1, 0)",
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

  it('Run: by run, case, evaluation, verdict and trace (no run before)', () => {
    expect(buildRunCasesQuery(I, 'run_1')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_1'",
        VERD,
        RUN_STATS,
        'head 10000',
      ].join(' | ')
    );
  });

  it('Run: one query reads the run and the run before', () => {
    expect(buildRunCasesQuery(I, 'run_2', 'run_1')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_2' or `attributes.test.suite.run.id` = 'run_1'",
        VERD,
        RUN_STATS,
        'head 10000',
      ].join(' | ')
    );
  });

  it('Run: the runs in the range, to find the run before', () => {
    // Every run, by agent too (the Eval runs tab's compatible runs), latest first.
    expect(buildRunsLookupQuery(I)).toBe(
      [
        ...BASE,
        'where isnotnull(`attributes.test.suite.run.id`)',
        'stats min(`@timestamp`) as started by `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.test.suite.run.id`',
        'sort - started',
        'head 10000',
      ].join(' | ')
    );
    // One suite's runs, latest first: the cap drops the oldest runs.
    expect(buildRunsLookupQuery(I, "it's")).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.name` = 'it\\'s'",
        'stats min(`@timestamp`) as started by `attributes.test.suite.name`, `attributes.test.suite.run.id`',
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

  it('Result flyout, session results: the root spans of the session turns, oldest first', () => {
    expect(buildSessionRootsQuery('spans-*', "conv'1")).toBe(
      [
        'source = spans-*',
        "where `attributes.gen_ai.conversation.id` = 'conv\\'1' and `parentSpanId` = ''",
        'sort `startTime`',
        'fields `traceId`, `startTime`, `attributes.gen_ai.input.messages`, `attributes.gen_ai.output.messages`',
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

  it('Root spans: input and output of one or two traces', () => {
    expect(buildRootSpansQuery('spans-*', ['t1'])).toBe(
      [
        'source = spans-*',
        "where `traceId` = 't1' and `parentSpanId` = ''",
        'fields `traceId`, `attributes.gen_ai.input.messages`, `attributes.gen_ai.output.messages`',
        'dedup `traceId`',
        'head 1',
      ].join(' | ')
    );
    expect(buildRootSpansQuery('spans-*', ['t1', 't2'])).toBe(
      [
        'source = spans-*',
        "where (`traceId` = 't1' or `traceId` = 't2') and `parentSpanId` = ''",
        'fields `traceId`, `attributes.gen_ai.input.messages`, `attributes.gen_ai.output.messages`',
        // One root per trace, so a trace with two parentless spans cannot take the other's place.
        'dedup `traceId`',
        'head 2',
      ].join(' | ')
    );
  });

  it('Result flyout: the judged span, and the judge trace', () => {
    expect(buildSpanQuery('spans-*', 't1', 's1')).toBe(
      "source = spans-* | where `traceId` = 't1' and `spanId` = 's1' | head 1"
    );
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
        VERD,
        'stats count() as n, min(`@timestamp`) as started by `attributes.test.suite.run.id`, `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.test.case.id`, `attributes.test.case.name`, `attributes.gen_ai.evaluation.name`, verdict, `traceId`',
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
        VERD,
        'stats count() as n by `traceId`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent Traces spans column: a tally per span', () => {
    expect(buildTracesTallyQuery(I, ['t1'], true)).toBe(
      [
        ...BASE,
        "where `traceId` = 't1'",
        VERD,
        'stats count() as n by `traceId`, `spanId`, verdict',
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
        VERD,
        "where verdict = 'fail' or verdict = 'scored'",
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
      [...BASE, VERD, "where verdict = 'fail'", 'stats count() as total'].join(' | ')
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
        VERD,
        'stats count() as n by verdict',
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
        VERD,
        "where verdict = 'fail'",
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
