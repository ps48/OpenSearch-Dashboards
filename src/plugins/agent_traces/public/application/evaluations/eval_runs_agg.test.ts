/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './eval_test_fixtures';
import {
  buildRunCaseEventsAggQuery,
  buildRunCasesAggQuery,
  buildRunEventsOnlyQuery,
  buildRunGradesAggQuery,
  runAggTruncated,
  runSummariesFromAgg,
} from './eval_runs_agg';

const RUN = 'attributes.test.suite.run.id';
const SUITE = 'attributes.test.suite.name';
const NAME = 'attributes.gen_ai.evaluation.name';

describe('run aggregation queries', () => {
  it('aggregates grades by run, evaluation and verdict, without unmapped fields', () => {
    const q = buildRunGradesAggQuery(
      { names: ['accuracy'] },
      { index: 'idx-a', missing: new Set(['attributes.gen_ai.evaluation.score.label']) }
    );
    expect(q).toContain('source = idx-a');
    expect(q).toContain('isnotnull(`attributes.test.suite.run.id`)');
    expect(q).toContain("`attributes.gen_ai.evaluation.name` = 'accuracy'");
    expect(q).toContain('eval evl_verdict = case(');
    expect(q).toMatch(
      /stats count\(\) as n, count\(.*\) as nv, .* min\(`@timestamp`\) as t0, max\(`@timestamp`\) as t1 by `attributes\.test\.suite\.run\.id`, `attributes\.test\.suite\.name`, `attributes\.gen_ai\.evaluation\.name`/
    );
    expect(q).not.toContain('score.label');
    expect(q).toMatch(/evl_verdict \| head 10000$/);
  });

  it('counts test cases by run from grades', () => {
    expect(buildRunCasesAggQuery({}, 'all', { withoutVerdict: true })).not.toContain('evl_verdict');
    expect(buildRunCasesAggQuery({}, 'fail')).toContain("where evl_verdict = 'fail'");
    expect(buildRunCasesAggQuery({}, 'decided')).toMatch(
      /stats distinct_count\(`attributes\.test\.case\.id`\) as nc by `attributes\.test\.suite\.run\.id`/
    );
  });

  it('counts case events by run and status, and reads run events', () => {
    expect(buildRunCaseEventsAggQuery('idx')).toContain(
      "`eventName` = 'opensearch.test_case.result'"
    );
    expect(buildRunCaseEventsAggQuery('idx')).toContain('`attributes.test.case.result.status`');
    expect(buildRunEventsOnlyQuery(50, 'idx')).toBe(
      "source = idx | where `eventName` = 'opensearch.test_suite_run.result' | sort - `@timestamp` | head 50"
    );
  });
});

describe('runSummariesFromAgg', () => {
  const grade = (runId: string, verdict: string, n: number, sum: number, t: string) => ({
    [RUN]: runId,
    [SUITE]: 'suite',
    [NAME]: 'accuracy',
    'attributes.opensearch.evaluation.score.min': 0,
    'attributes.opensearch.evaluation.score.max': 1,
    evl_verdict: verdict,
    n,
    nv: n,
    sv: sum,
    vmin: 0.1,
    vmax: 0.9,
    t0: t,
    t1: t,
  });

  it('builds runs from the run event, case events and grades, linked to the previous run', () => {
    const runs = runSummariesFromAgg({
      grades: [
        grade('r1', 'pass', 2, 1.6, '2026-10-25 10:00:00'),
        grade('r2', 'pass', 1, 0.8, '2026-10-26 10:00:00'),
        grade('r2', 'fail', 1, 0.1, '2026-10-26 10:00:01'),
      ],
      gradeCases: {
        all: [{ [RUN]: 'r1', nc: 2 }],
        fail: [],
        decided: [{ [RUN]: 'r1', nc: 2 }],
      },
      caseEvents: [
        {
          [RUN]: 'r2',
          [SUITE]: 'suite',
          'attributes.test.case.result.status': 'pass',
          'attributes.gen_ai.agent.name': 'planner',
          n: 1,
          nc: 1,
          t0: '2026-10-26 10:00:00',
          t1: '2026-10-26 10:00:00',
        },
        {
          [RUN]: 'r2',
          [SUITE]: 'suite',
          'attributes.test.case.result.status': 'fail',
          n: 1,
          nc: 1,
          t0: '2026-10-26 10:00:01',
          t1: '2026-10-26 10:00:01',
        },
      ],
      runEvents: [
        {
          eventName: 'opensearch.test_suite_run.result',
          '@timestamp': '2026-10-26 10:00:05',
          attributes: {
            test: { suite: { run: { id: 'r2', status: 'success' }, name: 'suite' } },
            opensearch: { test_suite_run: { duration_ms: 6000 } },
            agent: { version: 'v2' },
          },
        },
      ],
    });
    expect(runs.map((r) => r.runId)).toEqual(['r2', 'r1']);
    const [r2, r1] = runs;
    expect(r1).toMatchObject({ cases: 2, casesPassed: 2, casesFailed: 0, fromCaseEvents: false });
    expect(r1.evaluators.accuracy).toMatchObject({ count: 2, mean: 0.8, passRate: 1 });
    expect(r2).toMatchObject({
      cases: 2,
      casesPassed: 1,
      casesFailed: 1,
      fromCaseEvents: true,
      status: 'success',
      durationMs: 6000,
      agentName: 'planner',
      previousRunId: 'r1',
      passRateDropped: true,
    });
    expect(r2.metadata).toEqual({ 'agent.version': 'v2' });
    expect(r2.evaluators.accuracy.mean).toBeCloseTo(0.45);
    expect(r2.regressedEvaluators).toEqual(['accuracy']);
  });

  it('keeps only runs with grades when the grades were narrowed', () => {
    const runs = runSummariesFromAgg(
      {
        grades: [grade('r1', 'pass', 1, 0.9, '2026-10-25 10:00:00')],
        gradeCases: { all: [], fail: [], decided: [] },
        caseEvents: [{ [RUN]: 'r9', n: 1 }],
        runEvents: [],
      },
      { onlyWithGrades: true }
    );
    expect(runs.map((r) => r.runId)).toEqual(['r1']);
  });

  it('says when an aggregation may be cut', () => {
    const many = Array.from({ length: 10000 }, () => ({}));
    const empty = { all: [], fail: [], decided: [] };
    expect(
      runAggTruncated({ grades: many, gradeCases: empty, caseEvents: [], runEvents: [] })
    ).toBe(true);
    expect(runAggTruncated({ grades: [], gradeCases: empty, caseEvents: [], runEvents: [] })).toBe(
      false
    );
  });
});
