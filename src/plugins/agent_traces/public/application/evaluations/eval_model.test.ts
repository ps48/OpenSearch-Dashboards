/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isCompatibleRun,
  runRefsOf,
  runNamesOf,
  withRunNames,
  agentEvaluations,
  agentRows,
  agentVersionRows,
  agentSuites,
  caseStatusOf,
  changeOf,
  recordsToResults,
  comparison,
  defaultVersionPair,
  emptyTally,
  addToTally,
  evaluationRows,
  isLive,
  latestRunPerVersion,
  meanPassRate,
  otherRunsOfSuite,
  parseTime,
  passRate,
  recordToResult,
  runBefore,
  runCases,
  runDetail,
  suiteRuns,
  trendSeries,
  verdictOf,
  versionsOf,
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
const L = 'attributes.gen_ai.evaluation.score.label';
const DIR = 'attributes.opensearch.gen_ai.evaluation.score.direction';

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

  it('derives a case status: error > fail > pass > scored', () => {
    expect(caseStatusOf({ ...emptyTally(), error: 1, fail: 1 })).toBe('error');
    expect(caseStatusOf({ ...emptyTally(), fail: 1, pass: 3 })).toBe('fail');
    expect(caseStatusOf({ ...emptyTally(), pass: 1, scored: 2 })).toBe('pass');
    // Scores without a pass rule only: neither passed nor failed.
    expect(caseStatusOf({ ...emptyTally(), scored: 2 })).toBe('scored');
  });

  it('a change to or from scored is a change, not a regression or a fix', () => {
    expect(changeOf('pass', 'fail')).toBe('regressed');
    expect(changeOf('error', 'pass')).toBe('fixed');
    expect(changeOf('pass', 'scored')).toBe('changed');
    expect(changeOf('scored', 'pass')).toBe('changed');
    expect(changeOf('fail', 'error')).toBe('changed');
  });

  it("reads the judge's own label next to the verdict", () => {
    const [r] = recordsToResults([
      {
        attributes: {
          gen_ai: { evaluation: { name: 'tone', score: { label: 'pass' } } },
          opensearch: { gen_ai: { evaluation: { judge_label: 'Polite' } } },
        },
      },
    ]);
    // The verdict comes from score.label only.
    expect(r.verdict).toBe('pass');
    expect(r.label).toBe('pass');
    expect(r.judgeLabel).toBe('Polite');
    expect(recordsToResults([{ attributes: {} }])[0].judgeLabel).toBeUndefined();
    // Lowercase-exact: a judge label in score.label is not a verdict.
    expect(verdictOf({ label: 'Pass' })).toBe('scored');
  });

  it('reads PPL times as UTC', () => {
    expect(parseTime('2026-10-30 23:27:07.092156928')).toBe(Date.UTC(2026, 9, 30, 23, 27, 7, 92));
    expect(parseTime('2026-10-30 03:00:00')).toBe(Date.UTC(2026, 9, 30, 3));
  });
});

describe('agents', () => {
  const row = (
    agent: string | null,
    version: string | null,
    name: string,
    verdict: string,
    n: number,
    first: string,
    last: string,
    extra: Record<string, unknown> = {}
  ) => ({ n, first, last, [A]: agent, [V]: version, [N]: name, verdict, ...extra });
  const rows = [
    // v1: acc 8/10, tone 10/10 -> mean 0.9
    row('tp', 'v1', 'acc', 'pass', 8, '2026-10-25 10:00:00', '2026-10-27 10:00:00'),
    row('tp', 'v1', 'acc', 'fail', 2, '2026-10-25 10:00:00', '2026-10-27 10:00:00'),
    row('tp', 'v1', 'tone', 'pass', 10, '2026-10-25 10:00:00', '2026-10-27 10:00:00'),
    // v2: acc 6/10, tone 2/10, help scored only -> mean 0.4
    row('tp', 'v2', 'acc', 'pass', 6, '2026-10-28 10:00:00', '2026-10-30 10:00:00'),
    row('tp', 'v2', 'acc', 'fail', 4, '2026-10-28 11:00:00', '2026-10-30 12:00:00'),
    row('tp', 'v2', 'tone', 'pass', 2, '2026-10-28 10:00:00', '2026-10-30 10:00:00'),
    row('tp', 'v2', 'tone', 'fail', 8, '2026-10-28 10:00:00', '2026-10-30 10:00:00'),
    row('tp', 'v2', 'help', 'scored', 7, '2026-10-28 10:00:00', '2026-10-30 10:00:00'),
    row(null, null, 'tox', 'pass', 5, '2026-10-29 10:00:00', '2026-10-29 11:00:00'),
  ];

  it('rates a version as the mean of its evaluation pass rates', () => {
    const [v1, v2] = versionsOf(rows.filter((r) => r[A] === 'tp'));
    expect(v1.version).toBe('v1');
    expect(v1.rate).toBeCloseTo(0.9);
    expect(v1.decided).toBe(20);
    // A pooled rate would be 8/20; each evaluation counts the same.
    expect(v2.rate).toBeCloseTo(0.4);
    expect(v2.evaluations.get('help')).toMatchObject({ hasPassRule: false, rate: undefined });
    expect(meanPassRate([])).toBeUndefined();
  });

  it('lists versions with the most recent result first, and agents without a version', () => {
    const [tp, none] = agentRows(rows);
    expect(tp.agent).toBe('tp');
    expect(tp.versions.map((v) => v.version)).toEqual(['v2', 'v1']);
    expect(tp.n).toBe(47);
    expect(tp.last).toBe(Date.UTC(2026, 9, 30, 12));
    expect(none.agent).toBe(NO_AGENT);
    expect(none.versions).toHaveLength(1);
    expect(none.versions[0].version).toBeUndefined();
    expect(none.rate).toBe(1);
  });

  it('marks versions with results in the last 6 hours', () => {
    const now = Date.UTC(2026, 9, 30, 15);
    const [tp] = agentRows(rows);
    expect(isLive(tp.versions[0], now)).toBe(true);
    expect(isLive(tp.versions[1], now)).toBe(false);
  });

  it('lists one Agents table row per agent and version', () => {
    const now = Date.UTC(2026, 9, 30, 15);
    const items = agentVersionRows(rows, now);
    expect(items.map((r) => r.id)).toEqual(['tp/v2', 'tp/v1', `${NO_AGENT}/`]);
    expect(items[0]).toMatchObject({
      agent: 'tp',
      version: 'v2',
      decided: 20,
      n: 27,
      last: Date.UTC(2026, 9, 30, 12),
      live: true,
    });
    expect(items[0].rate).toBeCloseTo(0.4);
    expect(items[1]).toMatchObject({ version: 'v1', decided: 20, n: 20, live: false });
    expect(items[1].rate).toBeCloseTo(0.9);
    expect(items[2]).toMatchObject({ agent: NO_AGENT, version: undefined, rate: 1, n: 5 });
    expect(agentVersionRows([])).toEqual([]);
  });

  it('builds the Evaluations table for any two versions, average and top label without a rule', () => {
    const evalRows = [
      ...rows.filter((r) => r[A] === 'tp'),
      row('tp', 'v1', 'latency', 'scored', 4, '2026-10-25 10:00:00', '2026-10-26 10:00:00', {
        nv: 4,
        avg_score: 2.5,
        [DIR]: 'minimize',
      }),
      row('tp', 'v2', 'latency', 'scored', 6, '2026-10-28 10:00:00', '2026-10-29 10:00:00', {
        nv: 6,
        avg_score: 2,
        [DIR]: 'minimize',
      }),
      row('tp', 'v1', 'kind', 'scored', 6, '2026-10-25 10:00:00', '2026-10-26 10:00:00', {
        [L]: 'direct',
      }),
      row('tp', 'v1', 'kind', 'scored', 4, '2026-10-25 10:00:00', '2026-10-26 10:00:00', {
        [L]: 'refusal',
      }),
    ];
    const { summary, versions } = agentEvaluations('tp', evalRows);
    expect(summary?.versions[0].version).toBe('v2');
    expect(defaultVersionPair(versions)).toEqual({ b: 'v2', a: 'v1' });
    expect(defaultVersionPair(versions, { b: 'v1', a: 'v1' })).toEqual({ b: 'v1', a: 'v2' });
    expect(defaultVersionPair(versions, { b: 'gone' })).toEqual({ b: 'v2', a: 'v1' });
    const table = evaluationRows(versions, 'v2', 'v1');
    const acc = table.find((e) => e.name === 'acc');
    expect(acc?.hasPassRule).toBe(true);
    expect(acc?.b?.rate).toBe(0.6);
    expect(acc?.a?.rate).toBe(0.8);
    expect(acc?.delta).toBeCloseTo(-0.2);
    const latency = table.find((e) => e.name === 'latency');
    expect(latency).toMatchObject({ hasPassRule: false, delta: undefined });
    expect(latency?.a).toMatchObject({ avg: 2.5, nv: 4, direction: 'minimize' });
    expect(latency?.b?.avg).toBe(2);
    expect(table.find((e) => e.name === 'kind')?.a?.top).toEqual({ label: 'direct', share: 0.6 });
    // Only one version: no A side.
    expect(evaluationRows(versions, 'v2', undefined)[0].a).toBeUndefined();
  });

  it('offline: keeps each version at its latest run only', () => {
    const r = (version: string | null, run: string | null, first: string, name = 'acc') => ({
      n: 1,
      first,
      last: first,
      [V]: version,
      [RUN]: run,
      [N]: name,
      verdict: 'pass',
    });
    const offlineRows = [
      r('v1', 'r1', '2026-10-25 10:00:00'),
      r('v1', 'r1', '2026-10-25 10:05:00', 'tone'),
      // r2 started later than r1: v1 is read at r2, even though r1 has a later result.
      r('v1', 'r2', '2026-10-26 10:00:00'),
      r('v1', 'r1', '2026-10-27 10:00:00', 'late'),
      r('v2', 'r3', '2026-10-28 10:00:00'),
      r(null, 'r4', '2026-10-20 10:00:00'),
      r(null, 'r5', '2026-10-21 10:00:00'),
      // No run id (should not happen offline): kept.
      r('v1', null, '2026-10-29 10:00:00'),
    ];
    const kept = latestRunPerVersion(offlineRows);
    expect(kept.map((x) => [x[V], x[RUN], x[N]])).toEqual([
      ['v1', 'r2', 'acc'],
      ['v2', 'r3', 'acc'],
      [null, 'r5', 'acc'],
      ['v1', null, 'acc'],
    ]);
    expect(latestRunPerVersion([])).toEqual([]);
  });

  it('turns trend buckets into one series per version, top 5 by results', () => {
    const T = 'attributes.gen_ai.agent.version';
    const series = trendSeries([
      { n: 3, t: '2026-10-28 03:00:00', [T]: 'v2', verdict: 'pass' },
      { n: 1, t: '2026-10-28 03:00:00', [T]: 'v2', verdict: 'fail' },
      { n: 2, t: '2026-10-28 00:00:00', [T]: 'v2', verdict: 'fail' },
      { n: 1, t: '2026-10-28 00:00:00', [T]: 'v1', verdict: 'pass' },
    ]);
    expect(series.map((x) => x.version)).toEqual(['v2', 'v1']);
    expect(series[0].points).toEqual([
      { t: Date.UTC(2026, 9, 28, 0), rate: 0, n: 2 },
      { t: Date.UTC(2026, 9, 28, 3), rate: 0.75, n: 4 },
    ]);
    const many = Array.from({ length: 7 }, (_, i) => ({
      n: i + 1,
      t: '2026-10-28 00:00:00',
      [T]: `v${i}`,
      verdict: 'pass',
    }));
    expect(trendSeries(many).map((x) => x.version)).toEqual(['v6', 'v5', 'v4', 'v3', 'v2']);
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

  it('reads one run out of the rows of two, and finds the run before', () => {
    const r = (run: string, caseId: string, verdict: string) => ({
      n: 1,
      t0: '2026-10-28 07:00:00',
      [RUN]: run,
      [CASE]: caseId,
      [N]: 'acc',
      verdict,
    });
    const rows = [r('r2', 'c1', 'pass'), r('r2', 'c2', 'fail'), r('r1', 'c1', 'fail')];
    const now = runDetail('r2', rows);
    expect(now).toMatchObject({ casesPassed: 1, evaluations: ['acc'] });
    expect(now?.cases).toHaveLength(2);
    expect(runDetail('r1', rows)?.casesPassed).toBe(0);
    const lookup = [
      { started: '2026-10-26 07:00:00', [SUITE]: 'g', [RUN]: 'r0' },
      { started: '2026-10-27 07:00:00', [SUITE]: 'g', [RUN]: 'r1' },
      { started: '2026-10-27 08:00:00', [SUITE]: 'other', [RUN]: 'x' },
      { started: '2026-10-28 07:00:00', [SUITE]: 'g', [RUN]: 'r2' },
    ];
    expect(runBefore(lookup, 'r2')?.runId).toBe('r1');
    expect(runBefore(lookup, 'r0')).toBeUndefined();
    expect(runBefore(lookup, 'missing')).toBeUndefined();
  });

  it('reads cases and cases passed per run', () => {
    const m = runCases([
      { [RUN]: 'r1', cases: 12, passed: 7 },
      { [RUN]: 'r2', cases: '3', passed: null },
      { cases: 1, passed: 1 },
    ]);
    expect([...m.entries()]).toEqual([
      ['r1', { cases: 12, passed: 7 }],
      ['r2', { cases: 3, passed: 0 }],
    ]);
  });

  it('counts the other runs of a run suite', () => {
    const lookup = [
      { started: '2026-10-26 07:00:00', [SUITE]: 'g', [RUN]: 'r0' },
      { started: '2026-10-27 07:00:00', [SUITE]: 'g', [RUN]: 'r1' },
      { started: '2026-10-27 08:00:00', [SUITE]: 'other', [RUN]: 'x' },
    ];
    expect(otherRunsOfSuite(lookup, 'r1')).toBe(1);
    expect(otherRunsOfSuite(lookup, 'x')).toBe(0);
    expect(otherRunsOfSuite(lookup, 'missing')).toBe(0);
    expect(otherRunsOfSuite([], 'r1')).toBe(0);
  });
});

describe('compare runs', () => {
  it('names a case change', () => {
    expect(changeOf('pass', 'fail')).toBe('regressed');
    expect(changeOf('pass', 'error')).toBe('regressed');
    expect(changeOf('fail', 'pass')).toBe('fixed');
    expect(changeOf('fail', 'error')).toBe('changed');
    expect(changeOf('pass', undefined)).toBe('onlyA');
    expect(changeOf(undefined, 'fail')).toBe('onlyB');
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
    expect(cmp.evaluations).toEqual([{ name: 'acc', a: 0.5, b: 0.5, delta: 0, nA: 2, nB: 2 }]);
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
          gen_ai: {
            evaluation: {
              score: { min: 0, max: 1, threshold: 0.5, direction: 'maximize' },
              evaluator: { name: 'judge', type: 'llm_judge', version: '2' },
              judge: { trace_id: 'j1' },
            },
          },
          test: { case: { expected: 'Paris', expected_truncated: true } },
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
      evaluatorVersion: '2',
      scoreMin: 0,
      scoreMax: 1,
      scoreThreshold: 0.5,
      scoreDirection: 'maximize',
      judgeTraceId: 'j1',
      expected: 'Paris',
      expectedTruncated: true,
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
        attributes: { opensearch: { gen_ai: { evaluation: { level: 'Trace' } } } },
      }).level
    ).toBe('trace');
    expect(recordToResult({ attributes: {} }).expectedTruncated).toBe(false);
  });

  it('reads the run name, evaluator description and judge context, and works without them', () => {
    const r = recordToResult({
      attributes: {
        gen_ai: {
          evaluation: { name: 'help' },
          request: { model: 'judge-model-1' },
          prompt: { name: 'helpfulness', version: '3' },
          system_instructions: 'You are a strict grader.',
        },
        opensearch: {
          gen_ai: {
            evaluation: {
              evaluator: { description: 'Checks the answer is helpful' },
              system_instructions_truncated: true,
            },
          },
          test: { suite: { run: { name: 'v5 shorter prompt', description: 'Prompt trim' } } },
        },
        test: { suite: { run: { id: 'r1' } } },
      },
    });
    expect(r).toMatchObject({
      runName: 'v5 shorter prompt',
      runDescription: 'Prompt trim',
      evaluatorDescription: 'Checks the answer is helpful',
      judgeModel: 'judge-model-1',
      promptName: 'helpfulness',
      promptVersion: '3',
      systemInstructions: 'You are a strict grader.',
      systemInstructionsTruncated: true,
    });
    const bare = recordToResult({ attributes: { gen_ai: { evaluation: { name: 'x' } } } });
    expect(bare.runName).toBeUndefined();
    expect(bare.runDescription).toBeUndefined();
    expect(bare.evaluatorDescription).toBeUndefined();
    expect(bare.judgeModel).toBeUndefined();
    expect(bare.promptName).toBeUndefined();
    expect(bare.promptVersion).toBeUndefined();
    expect(bare.systemInstructions).toBeUndefined();
    expect(bare.systemInstructionsTruncated).toBe(false);
  });
});

describe('run names', () => {
  const doc = (id: string, name?: string, description?: string) => ({
    attributes: {
      test: { suite: { run: { id } } },
      opensearch: { test: { suite: { run: { name, description } } } },
    },
  });

  it('reads one name per run, skips runs without one, and merges them into rows', () => {
    const names = runNamesOf([
      doc('r1', 'First', 'About r1'),
      doc('r1', 'Ignored'),
      doc('r2'),
      doc('r3', '  ', 'Only a description'),
    ]);
    expect(names.get('r1')).toEqual({ name: 'First', description: 'About r1' });
    expect(names.has('r2')).toBe(false);
    expect(names.get('r3')).toEqual({ name: undefined, description: 'Only a description' });
    const rows = withRunNames([{ runId: 'r1' }, { runId: 'r2' }], names);
    expect(rows[0]).toMatchObject({ runId: 'r1', name: 'First', description: 'About r1' });
    expect(rows[1]).toEqual({ runId: 'r2' });
    const same = [{ runId: 'r1' }];
    expect(withRunNames(same, new Map())).toBe(same);
  });
});

describe('Eval runs compatibility', () => {
  const run = (runId: string, suite?: string, agent?: string) => ({ runId, suite, agent });
  it('same suite and same agent, not the same run', () => {
    expect(isCompatibleRun(run('a', 'g', 'tp'), run('b', 'g', 'tp'))).toBe(true);
    expect(isCompatibleRun(run('a', 'g', 'tp'), run('a', 'g', 'tp'))).toBe(false);
    expect(isCompatibleRun(run('a', 'g', 'tp'), run('b', 'g', 'bot'))).toBe(false);
    expect(isCompatibleRun(run('a', 'g', 'tp'), run('b', 'r', 'tp'))).toBe(false);
    // Runs without an agent name compare with each other; runs without a suite do not.
    expect(isCompatibleRun(run('a', 'g'), run('b', 'g'))).toBe(true);
    expect(isCompatibleRun(run('a'), run('b'))).toBe(false);
  });

  it('reads the runs lookup rows, agent included', () => {
    expect(
      runRefsOf([
        {
          started: '2026-10-28 07:00:00',
          'attributes.test.suite.run.id': 'r1',
          'attributes.test.suite.name': 'g',
          'attributes.gen_ai.agent.name': 'tp',
        },
        { started: '2026-10-28 07:00:00' },
      ])
    ).toEqual([{ runId: 'r1', suite: 'g', agent: 'tp', started: Date.UTC(2026, 9, 28, 7) }]);
  });
});
