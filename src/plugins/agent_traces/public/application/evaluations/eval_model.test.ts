/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  agentEvaluations,
  agentRows,
  agentSuites,
  caseStatusOf,
  changeOf,
  comparison,
  emptyTally,
  addToTally,
  parseTime,
  passRate,
  recordToResult,
  runDetail,
  suiteRuns,
  trendPoints,
  verdictOf,
  versionMarkers,
} from './eval_model';
import { NO_AGENT } from './eval_ppl';

const A = 'attributes.gen_ai.agent.name';
const V = 'attributes.gen_ai.agent.version';
const N = 'attributes.gen_ai.evaluation.name';
const RUN = 'attributes.test.suite.run.id';
const SUITE = 'attributes.test.suite.name';
const CASE = 'attributes.test.case.id';
const CASE_NAME = 'attributes.test.case.name';
const CI = 'attributes.cicd.pipeline.run.url.full';

describe('verdict and pass rate', () => {
  it('applies the one rule: error, else the label pass or fail, else scored', () => {
    expect(verdictOf({ errorType: 'Throttling', label: 'pass' })).toBe('error');
    expect(verdictOf({ label: 'pass' })).toBe('pass');
    expect(verdictOf({ label: 'fail' })).toBe('fail');
    expect(verdictOf({ label: 'good' })).toBe('scored');
    expect(verdictOf({})).toBe('scored');
  });

  it('counts pass / (pass + fail) only', () => {
    const t = emptyTally();
    addToTally(t, 'pass', 3);
    addToTally(t, 'fail', 1);
    addToTally(t, 'scored', 10);
    addToTally(t, 'error', 2);
    expect(passRate(t)).toBe(0.75);
    expect(t.n).toBe(16);
    expect(passRate(emptyTally())).toBeUndefined();
  });

  it('derives a case status: error > fail > pass', () => {
    expect(caseStatusOf({ ...emptyTally(), error: 1, fail: 1 })).toBe('error');
    expect(caseStatusOf({ ...emptyTally(), fail: 1, pass: 3 })).toBe('fail');
    expect(caseStatusOf({ ...emptyTally(), scored: 2 })).toBe('pass');
  });

  it('reads PPL times as UTC', () => {
    expect(parseTime('2026-10-30 23:27:07.092156928')).toBe(Date.UTC(2026, 9, 30, 23, 27, 7, 92));
    expect(parseTime('2026-10-30 03:00:00')).toBe(Date.UTC(2026, 9, 30, 3));
  });
});

describe('agents', () => {
  const rows = [
    {
      n: 8,
      first: '2026-10-25 10:00:00',
      last: '2026-10-27 10:00:00',
      [A]: 'tp',
      [V]: 'v1',
      verdict: 'pass',
    },
    {
      n: 2,
      first: '2026-10-25 10:00:00',
      last: '2026-10-27 10:00:00',
      [A]: 'tp',
      [V]: 'v1',
      verdict: 'fail',
    },
    {
      n: 6,
      first: '2026-10-28 10:00:00',
      last: '2026-10-30 10:00:00',
      [A]: 'tp',
      [V]: 'v2',
      verdict: 'pass',
    },
    {
      n: 4,
      first: '2026-10-28 11:00:00',
      last: '2026-10-30 12:00:00',
      [A]: 'tp',
      [V]: 'v2',
      verdict: 'fail',
    },
    {
      n: 5,
      first: '2026-10-29 10:00:00',
      last: '2026-10-29 11:00:00',
      [A]: null,
      [V]: null,
      verdict: 'pass',
    },
  ];

  it('takes the latest version by first result, against the one before it', () => {
    const [tp, none] = agentRows(rows);
    expect(tp.agent).toBe('tp');
    expect(tp.latest.version).toBe('v2');
    expect(tp.previous?.version).toBe('v1');
    expect(tp.rate).toBe(0.6);
    expect(tp.previousRate).toBe(0.8);
    expect(tp.delta).toBeCloseTo(-0.2);
    expect(tp.n).toBe(20);
    expect(tp.last).toBe(Date.UTC(2026, 9, 30, 12));
    expect(none.agent).toBe(NO_AGENT);
    expect(none.previous).toBeUndefined();
  });

  it('builds the Evaluations table and the page header from one query', () => {
    const evalRows = [
      {
        n: 9,
        first: '2026-10-25 10:00:00',
        last: '2026-10-26 10:00:00',
        [N]: 'acc',
        [V]: 'v1',
        verdict: 'pass',
      },
      {
        n: 1,
        first: '2026-10-25 10:00:00',
        last: '2026-10-26 10:00:00',
        [N]: 'acc',
        [V]: 'v1',
        verdict: 'fail',
      },
      {
        n: 5,
        first: '2026-10-28 10:00:00',
        last: '2026-10-29 10:00:00',
        [N]: 'acc',
        [V]: 'v2',
        verdict: 'pass',
      },
      {
        n: 5,
        first: '2026-10-28 10:00:00',
        last: '2026-10-29 10:00:00',
        [N]: 'acc',
        [V]: 'v2',
        verdict: 'fail',
      },
      {
        n: 7,
        first: '2026-10-28 10:00:00',
        last: '2026-10-29 10:00:00',
        [N]: 'help',
        [V]: 'v2',
        verdict: 'scored',
      },
    ];
    const { summary, rows: evals } = agentEvaluations('tp', evalRows);
    expect(summary?.latest.version).toBe('v2');
    const acc = evals.find((e) => e.name === 'acc');
    expect(acc).toMatchObject({ latestRate: 0.5, previousRate: 0.9, n: 20, hasPassRule: true });
    expect(acc?.delta).toBeCloseTo(-0.4);
    expect(evals.find((e) => e.name === 'help')).toMatchObject({ hasPassRule: false, n: 7 });
    expect(versionMarkers(summary?.versions ?? [])).toEqual([
      { t: Date.UTC(2026, 9, 28, 10), label: 'v2' },
    ]);
  });

  it('turns trend buckets into pass rates', () => {
    expect(
      trendPoints([
        { n: 3, t: '2026-10-28 03:00:00', verdict: 'pass' },
        { n: 1, t: '2026-10-28 03:00:00', verdict: 'fail' },
        { n: 2, t: '2026-10-28 00:00:00', verdict: 'fail' },
      ])
    ).toEqual([
      { t: Date.UTC(2026, 9, 28, 0), rate: 0 },
      { t: Date.UTC(2026, 9, 28, 3), rate: 0.75 },
    ]);
  });
});

describe('suites and runs', () => {
  const runRows = [
    { n: 4, started: '2026-10-26 07:00:00', [SUITE]: 'g', [RUN]: 'r1', [V]: 'v1', verdict: 'pass' },
    { n: 4, started: '2026-10-28 07:00:00', [SUITE]: 'g', [RUN]: 'r2', [V]: 'v2', verdict: 'pass' },
    { n: 4, started: '2026-10-28 07:00:00', [SUITE]: 'g', [RUN]: 'r2', [V]: 'v2', verdict: 'fail' },
    {
      n: 2,
      started: '2026-10-28 07:00:00',
      [SUITE]: 'g',
      [RUN]: 'r2',
      [V]: 'v2',
      verdict: 'error',
    },
  ];

  it('rolls runs up into suites: last run against the run before', () => {
    const [s] = agentSuites(runRows);
    expect(s).toMatchObject({ suite: 'g', runs: 2 });
    expect(s.last.runId).toBe('r2');
    expect(s.last.rate).toBe(0.5);
    expect(s.delta).toBe(-0.5);
  });

  it('lists a suite runs oldest first with errors and CI links', () => {
    const runs = suiteRuns([
      ...runRows.map((r) => ({ ...r, [A]: 'tp' })),
      { ...runRows[0], n: 0, [CI]: 'https://ci/1' },
    ]);
    expect(runs.map((r) => r.runId)).toEqual(['r1', 'r2']);
    expect(runs[0]).toMatchObject({ agent: 'tp', ciUrl: 'https://ci/1' });
    expect(runs[1].tally.error).toBe(2);
  });

  it('reads a run: header, duration and cases with failed evaluations', () => {
    const base = { [SUITE]: 'g', [A]: 'tp', [V]: 'v2', [CI]: 'https://ci/9' };
    const run = runDetail('r2', [
      {
        ...base,
        n: 1,
        t0: '2026-10-28 07:00:00',
        t1: '2026-10-28 07:00:10',
        [CASE]: 'c1',
        [CASE_NAME]: 'Case 1',
        [N]: 'acc',
        verdict: 'fail',
        traceId: 't1',
      },
      {
        ...base,
        n: 1,
        t0: '2026-10-28 07:00:00',
        t1: '2026-10-28 07:00:10',
        [CASE]: 'c1',
        [CASE_NAME]: 'Case 1',
        [N]: 'tone',
        verdict: 'pass',
        traceId: 't1',
      },
      {
        ...base,
        n: 1,
        t0: '2026-10-28 07:00:20',
        t1: '2026-10-28 07:01:00',
        [CASE]: 'c2',
        [CASE_NAME]: 'Case 2',
        [N]: 'acc',
        verdict: 'error',
        traceId: 't2',
      },
      {
        ...base,
        n: 1,
        t0: '2026-10-28 07:00:20',
        t1: '2026-10-28 07:01:00',
        [CASE]: 'c3',
        [CASE_NAME]: 'Case 3',
        [N]: 'acc',
        verdict: 'pass',
        traceId: 't3',
      },
    ]);
    expect(run).toMatchObject({
      suite: 'g',
      agent: 'tp',
      version: 'v2',
      ciUrl: 'https://ci/9',
      durationMs: 60000,
    });
    expect(run?.rate).toBeCloseTo(2 / 3);
    expect(run?.tally.error).toBe(1);
    const c1 = run?.cases.find((c) => c.caseId === 'c1');
    expect(c1).toMatchObject({
      status: 'fail',
      failed: ['acc'],
      traceId: 't1',
      caseName: 'Case 1',
    });
    expect(run?.cases.find((c) => c.caseId === 'c2')).toMatchObject({
      status: 'error',
      errored: ['acc'],
    });
    expect(runDetail('x', [])).toBeUndefined();
  });
});

describe('compare runs', () => {
  it('names a case change', () => {
    expect(changeOf('pass', 'fail')).toBe('regressed');
    expect(changeOf('pass', 'error')).toBe('regressed');
    expect(changeOf('fail', 'pass')).toBe('fixed');
    expect(changeOf('fail', 'error')).toBe('changed');
    expect(changeOf('pass', undefined)).toBe('changed');
    expect(changeOf('fail', 'fail')).toBe('same');
  });

  it('matches cases on their id and compares evaluations', () => {
    const row = (
      run: string,
      version: string,
      caseId: string,
      name: string,
      verdict: string,
      traceId: string
    ) => ({
      n: 1,
      started: run === 'a' ? '2026-10-26 07:00:00' : '2026-10-28 07:00:00',
      [RUN]: run,
      [SUITE]: 'g',
      [A]: 'tp',
      [V]: version,
      [CASE]: caseId,
      [N]: name,
      verdict,
      traceId,
    });
    const cmp = comparison('a', 'b', [
      row('a', 'v1', 'c1', 'acc', 'pass', 'ta1'),
      row('a', 'v1', 'c2', 'acc', 'fail', 'ta2'),
      row('b', 'v2', 'c1', 'acc', 'fail', 'tb1'),
      row('b', 'v2', 'c2', 'acc', 'pass', 'tb2'),
    ]);
    expect(cmp).toMatchObject({ suite: 'g', agent: 'tp' });
    expect(cmp.a).toMatchObject({ version: 'v1', casesPassed: 1, cases: 2, rate: 0.5 });
    expect(cmp.cases.find((c) => c.caseId === 'c1')).toMatchObject({
      change: 'regressed',
      traceA: 'ta1',
      traceB: 'tb1',
    });
    expect(cmp.cases.find((c) => c.caseId === 'c2')?.change).toBe('fixed');
    expect(cmp.evaluations).toEqual([{ name: 'acc', a: 0.5, b: 0.5, delta: 0 }]);
  });
});

describe('result documents', () => {
  it('reads a document with nested attributes, its verdict and level', () => {
    const r = recordToResult({
      '@timestamp': '2026-10-30 23:27:07.092',
      traceId: 't1',
      spanId: 's1',
      instrumentationScope: { name: 'opensearch-genai-observability-sdk-py' },
      attributes: {
        gen_ai: {
          evaluation: { name: 'help', score: { value: 0.4, label: 'fail' }, explanation: 'Vague' },
          agent: { name: 'tp', version: 'v3' },
        },
        opensearch: {
          evaluation: {
            score: { min: 0, max: 1 },
            evaluator: { name: 'judge', type: 'llm_judge' },
          },
        },
        test: { suite: { name: 'g', run: { id: 'r1' } }, case: { id: 'c1' } },
      },
    });
    expect(r).toMatchObject({
      name: 'help',
      verdict: 'fail',
      value: 0.4,
      level: 'span',
      agentName: 'tp',
      agentVersion: 'v3',
      evaluatorName: 'judge',
      evaluatorType: 'llm_judge',
      scoreMin: 0,
      scoreMax: 1,
      runId: 'r1',
      caseId: 'c1',
      scope: 'opensearch-genai-observability-sdk-py',
    });
    expect(
      recordToResult({ traceId: 't', attributes: { gen_ai: { evaluation: { name: 'x' } } } }).level
    ).toBe('trace');
    expect(
      recordToResult({
        spanId: 's',
        attributes: { opensearch: { evaluation: { level: 'Trace' } } },
      }).level
    ).toBe('trace');
  });
});
