/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_RESULTS_SORT,
  EMPTY_RESULTS_FILTERS,
  NO_AGENT,
  buildAgentEvaluationsQuery,
  buildAgentSuitesQuery,
  buildAgentTrendQuery,
  buildAgentsQuery,
  buildCaseResultsQuery,
  buildCompareRunsQuery,
  buildFacetQuery,
  buildResultsCountQuery,
  buildResultsPageQuery,
  buildRunCasesQuery,
  buildSuiteRunsQuery,
  buildTraceResultsQuery,
  buildTraceSpansQuery,
  buildTracesTallyQuery,
  trendStep,
} from './eval_ppl';

const I = 'evals-*';
const NONE = EMPTY_RESULTS_FILTERS;
const BASE = ['source = evals-*', "where `eventName` = 'gen_ai.evaluation.result'"];
const VERD =
  "eval verdict = case(isnotnull(`attributes.error.type`), 'error', " +
  "`attributes.gen_ai.evaluation.score.label` = 'pass', 'pass', " +
  "`attributes.gen_ai.evaluation.score.label` = 'fail', 'fail' else 'scored')";

/** The exact PPL of every screen (each was run on a cluster with the P0 data contract). */
describe('evaluation PPL', () => {
  it('Agents: one aggregation by agent, version and verdict', () => {
    expect(buildAgentsQuery(I, 'all')).toBe(
      [
        ...BASE,
        VERD,
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, verdict',
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
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Evaluations table: by evaluation, version and verdict', () => {
    expect(buildAgentEvaluationsQuery(I, 'travel_planner', 'all')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'travel_planner'",
        VERD,
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.evaluation.name`, `attributes.gen_ai.agent.version`, verdict',
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
        'stats count() as n, min(`@timestamp`) as first, max(`@timestamp`) as last by `attributes.gen_ai.evaluation.name`, `attributes.gen_ai.agent.version`, verdict',
        'head 10000',
      ].join(' | ')
    );
  });

  it('Agent, Pass rate over time: pass and fail per bucket', () => {
    expect(buildAgentTrendQuery(I, 'travel_planner', 'online', '3h')).toBe(
      [
        ...BASE,
        "where `attributes.gen_ai.agent.name` = 'travel_planner'",
        'where isnull(`attributes.test.suite.run.id`)',
        VERD,
        "where verdict = 'pass' or verdict = 'fail'",
        'stats count() as n by span(`@timestamp`, 3h) as t, verdict',
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

  it('Run: by case, evaluation, verdict and trace', () => {
    expect(buildRunCasesQuery(I, 'run_1')).toBe(
      [
        ...BASE,
        "where `attributes.test.suite.run.id` = 'run_1'",
        VERD,
        'stats count() as n, min(`@timestamp`) as t0, max(`@timestamp`) as t1 by `attributes.test.suite.name`, `attributes.gen_ai.agent.name`, `attributes.gen_ai.agent.version`, `attributes.cicd.pipeline.run.url.full`, `attributes.test.case.id`, `attributes.test.case.name`, `attributes.gen_ai.evaluation.name`, verdict, `traceId`',
        'head 10000',
      ].join(' | ')
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
