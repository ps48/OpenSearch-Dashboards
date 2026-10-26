/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvalResult, outcomeOf } from './eval_data';

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
