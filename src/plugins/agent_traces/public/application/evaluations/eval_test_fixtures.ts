/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvalResult, RunEvents, SuiteRunEvent, TestCaseEvent, outcomeOf } from './eval_data';

let seq = 0;

/** An evaluation result for tests; the outcome is derived like the real mapping does. */
export const makeResult = (partial: Partial<EvalResult> = {}): EvalResult => {
  seq += 1;
  const base = {
    time: '2026-10-26 09:00:00.000',
    name: 'helpfulness',
    level: 'span',
    source: 'opensearch-sdk',
    evaluator: 'judge',
    traceId: `trace${seq}`,
    spanId: `span${seq}`,
    ...partial,
  };
  return {
    id: partial.id ?? `r${seq}`,
    ...base,
    outcome: partial.outcome ?? outcomeOf(base),
  };
};

/** Two runs of the same suite: case-a improves, case-b regresses, case-c is new. */
export const twoRunFixture = (): EvalResult[] => {
  const run = (runId: string, time: string, caseId: string, value: number, caseStatus?: string) =>
    makeResult({
      runId,
      suiteName: 'travel-suite',
      caseId,
      caseName: `Case ${caseId}`,
      name: 'accuracy',
      value,
      scoreMin: 0,
      scoreMax: 1,
      time,
      caseStatus,
    });
  return [
    run('run-1', '2026-10-25 10:00:00.000', 'a', 0.4),
    run('run-1', '2026-10-25 10:00:01.000', 'b', 0.9),
    run('run-2', '2026-10-26 10:00:00.000', 'a', 0.8),
    run('run-2', '2026-10-26 10:00:01.000', 'b', 0.2),
    run('run-2', '2026-10-26 10:00:02.000', 'c', 0.7),
  ];
};

export const makeCaseEvent = (partial: Partial<TestCaseEvent> = {}): TestCaseEvent => ({
  time: '2026-10-26 10:00:00.000',
  runId: 'run-2',
  suiteName: 'travel-suite',
  ...partial,
});

export const makeRunEvent = (partial: Partial<SuiteRunEvent> = {}): SuiteRunEvent => ({
  time: '2026-10-26 10:00:10.000',
  runId: 'run-2',
  suiteName: 'travel-suite',
  ...partial,
});

/**
 * Case and run events for `twoRunFixture` as current SDKs emit them. run-1 has case
 * events too; run-2 adds case d that errored before any scorer ran (no grades).
 */
export const twoRunEventsFixture = (): RunEvents => {
  const kase = (runId: string, time: string, caseId: string, extra: Partial<TestCaseEvent>) =>
    makeCaseEvent({
      runId,
      time,
      caseId,
      caseName: `Case ${caseId}`,
      input: `Plan a trip ${caseId}`,
      expected: `Itinerary ${caseId}`,
      durationMs: 1500,
      traceId: `${runId}-trace-${caseId}`,
      ...extra,
    });
  return {
    cases: [
      kase('run-1', '2026-10-25 10:00:00.000', 'a', { status: 'fail', output: 'old a' }),
      kase('run-1', '2026-10-25 10:00:01.000', 'b', { status: 'pass', output: 'old b' }),
      kase('run-1', '2026-10-25 10:00:02.000', 'd', { status: 'pass', output: 'old d' }),
      kase('run-2', '2026-10-26 10:00:00.000', 'a', { status: 'pass', output: 'new a' }),
      kase('run-2', '2026-10-26 10:00:01.000', 'b', { status: 'fail', output: 'new b' }),
      kase('run-2', '2026-10-26 10:00:02.000', 'c', { status: 'pass', output: 'new c' }),
      kase('run-2', '2026-10-26 10:00:03.000', 'd', {
        status: 'error',
        errorType: 'TimeoutError',
        output: undefined,
      }),
    ],
    runs: [
      makeRunEvent({
        runId: 'run-1',
        time: '2026-10-25 10:00:05.000',
        status: 'success',
        caseCount: 3,
        passCount: 2,
        failCount: 1,
        errorCount: 0,
        durationMs: 6000,
      }),
      makeRunEvent({
        runId: 'run-2',
        time: '2026-10-26 10:00:05.000',
        status: 'failure',
        caseCount: 4,
        passCount: 2,
        failCount: 1,
        errorCount: 1,
        durationMs: 8000,
      }),
    ],
  };
};
