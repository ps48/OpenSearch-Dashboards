/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { VERDICT_CLAUSES, VerdictInput, buildVerdictClauses, verdictOf } from './eval_verdict';

const verdict = (input: Partial<VerdictInput>) =>
  verdictOf({ name: 'x', ...input }, VERDICT_CLAUSES);

describe('verdict precedence', () => {
  it('an evaluator error wins over everything', () => {
    expect(verdict({ errorType: 'Timeout', assessment: 'pass', value: 1, threshold: 0 })).toBe(
      'error'
    );
  });

  it('the producer assessment wins over its threshold and the built-in rules', () => {
    expect(verdict({ value: 3, threshold: 5, assessment: 'pass' })).toBe('pass');
    expect(verdict({ name: 'Builtin.Correctness', value: 0.9, assessment: 'fail' })).toBe('fail');
  });

  it('the producer threshold wins over the built-in rules', () => {
    expect(verdict({ name: 'Builtin.Helpfulness', value: 0.67, threshold: 0.8 })).toBe('fail');
    expect(verdict({ name: 'Builtin.Helpfulness', value: 0.3, threshold: 0.2 })).toBe('pass');
  });

  it('uses the producer assessment', () => {
    expect(verdict({ assessment: 'pass' })).toBe('pass');
    expect(verdict({ assessment: 'FAIL' })).toBe('fail');
    expect(verdict({ assessment: 'maybe' })).toBe('neutral');
  });

  it('uses the producer threshold, maximize by default', () => {
    expect(verdict({ value: 0.7, threshold: 0.7 })).toBe('pass');
    expect(verdict({ value: 0.6, threshold: 0.7 })).toBe('fail');
    expect(verdict({ value: 3, threshold: 5, direction: 'minimize' })).toBe('pass');
    expect(verdict({ value: 6, threshold: 5, direction: 'minimize' })).toBe('fail');
    expect(verdict({ threshold: 5 })).toBe('neutral');
  });

  it('is neutral without a declared rule: no label words, no midpoint guess', () => {
    expect(verdict({ label: 'correct', value: 5 })).toBe('neutral');
    expect(verdict({ label: 'fail', value: 0 })).toBe('neutral');
    expect(verdict({ value: 1, direction: 'maximize' })).toBe('neutral');
  });
});

describe('built-in rules', () => {
  it('passes AgentCore built-ins at 0.5 and above', () => {
    expect(verdict({ name: 'Builtin.Helpfulness', value: 0.83, label: 'Very Helpful' })).toBe(
      'pass'
    );
    expect(verdict({ name: 'Builtin.Faithfulness', value: 0.25, label: 'Not Generally' })).toBe(
      'fail'
    );
    expect(verdict({ name: 'Builtin.GoalSuccessRate', value: 0 })).toBe('fail');
    expect(verdict({ name: 'Builtin.Correctness', value: 0.5, label: 'Partially Correct' })).toBe(
      'pass'
    );
  });

  it('decides safety built-ins by label only, and not Refusal', () => {
    expect(verdict({ name: 'Builtin.Harmfulness', value: 1, label: 'Harmful' })).toBe('fail');
    expect(verdict({ name: 'Builtin.Harmfulness', value: 0.2 })).toBe('neutral');
    expect(verdict({ name: 'Builtin.Refusal', value: 1, label: 'Yes' })).toBe('neutral');
  });

  it('reads Pass and Fail labels of AgentCore custom evaluators', () => {
    expect(verdict({ name: 'my_eval', source: 'agentcore', label: 'Pass' })).toBe('pass');
    expect(verdict({ name: 'my_eval', source: 'agentcore', label: 'Fail' })).toBe('fail');
    expect(verdict({ name: 'my_eval', source: 'opensearch-sdk', label: 'Fail' })).toBe('neutral');
  });
});

describe('threshold sign', () => {
  it('compares with the producer threshold from the sign alone', () => {
    const clauses = buildVerdictClauses();
    const at = (thresholdSign: number, direction?: string) =>
      verdictOf({ name: 'x', value: 0, threshold: 0, thresholdSign, direction }, clauses);
    expect(at(0)).toBe('pass');
    expect(at(-1)).toBe('fail');
    expect(at(-1, 'minimize')).toBe('pass');
    expect(at(1, 'minimize')).toBe('fail');
  });
});
