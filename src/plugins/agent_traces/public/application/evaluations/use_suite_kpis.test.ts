/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildSuiteEventsQuery,
  buildTraceUsageQuery,
  percentile,
  recentSuiteRuns,
  runKpisOf,
  usageByTrace,
} from './use_suite_kpis';
import type { RunSummary } from './eval_aggregations';

const run = (runId: string, started: number, suiteName = 'golden'): RunSummary =>
  ({
    runId,
    suiteName,
    started,
    ended: started + 1,
    results: 1,
    cases: 2,
    casesPassed: 1,
    casesFailed: 1,
    casesErrored: 0,
    fromCaseEvents: true,
    evaluators: {},
    regressedEvaluators: [],
    passRateDropped: false,
  }) as RunSummary;

const caseRow = (runId: string, traceId: string, duration: number) => ({
  eventName: 'opensearch.test_case.result',
  traceId,
  attributes: {
    'test.suite.run.id': runId,
    'test.case.id': traceId,
    'opensearch.test_case.duration_ms': duration,
  },
});

describe('use_suite_kpis', () => {
  it('keeps the suite runs oldest first, at most ten', () => {
    const runs = Array.from({ length: 12 }, (_, i) => run(`r${i}`, i)).concat(run('x', 5, 'other'));
    const recent = recentSuiteRuns(runs, 'golden');
    expect(recent).toHaveLength(10);
    expect(recent[0].runId).toBe('r2');
    expect(recent[9].runId).toBe('r11');
  });

  it('builds plain where clauses, no script', () => {
    const q = buildSuiteEventsQuery(['a', 'b'], 'evals');
    expect(q).toContain(
      "`attributes.test.suite.run.id` = 'a' or `attributes.test.suite.run.id` = 'b'"
    );
    expect(q).toContain('isnotnull(`attributes.error.type`)');
    const u = buildTraceUsageQuery(['t1', 't2'], 'spans');
    expect(u).toContain("traceId = 't1' or traceId = 't2'");
    expect(u).toContain('by traceId');
  });

  it('computes percentiles by nearest rank', () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
  });

  it('aggregates latency, usage and evaluator errors per run', () => {
    const rows = [
      caseRow('a', 't1', 100),
      caseRow('a', 't2', 300),
      caseRow('b', 't3', 50),
      {
        eventName: 'gen_ai.evaluation.result',
        attributes: {
          'test.suite.run.id': 'b',
          'gen_ai.evaluation.name': 'q',
          'error.type': 'Throttling',
        },
      },
    ];
    const usage = usageByTrace([
      { traceId: 't1', evl_in: 100, evl_out: 50, evl_tools: 1 },
      { traceId: 't2', evl_in: 200, evl_out: 50, evl_tools: 3 },
    ]);
    const byRun = runKpisOf(['a', 'b'], rows, usage);
    expect(byRun.get('a')).toMatchObject({
      latencyP50Ms: 100,
      latencyP95Ms: 300,
      tokensPerCase: 200,
      toolCallsPerCase: 2,
      evaluatorErrors: 0,
    });
    expect(byRun.get('b')).toMatchObject({ latencyP50Ms: 50, evaluatorErrors: 1 });
    expect(byRun.get('b')?.tokensPerCase).toBeUndefined();
  });
});
