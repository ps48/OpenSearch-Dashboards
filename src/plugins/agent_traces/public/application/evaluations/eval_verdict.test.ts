/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  VerdictInput,
  buildVerdictClauses,
  getActiveClauses,
  getActiveRuleEntries,
  parseEvaluationRules,
  ruleFor,
  setEvaluationRulesSource,
  verdictOf,
} from './eval_verdict';
import { EVALS_RULES_SETTING } from '../../../common';
import { agentTracesUiSettings } from '../../../server/ui_settings';

const verdict = (input: Partial<VerdictInput>, rules: unknown = {}) =>
  verdictOf(
    { name: 'x', ...input },
    buildVerdictClauses(parseEvaluationRules(rules, () => undefined))
  );

describe('verdict precedence', () => {
  it('an evaluator error wins over everything', () => {
    expect(
      verdict(
        { errorType: 'Timeout', assessment: 'pass', value: 1, threshold: 0 },
        { x: { threshold: 0 } }
      )
    ).toBe('error');
  });

  it('the setting wins over the producer assessment and threshold', () => {
    expect(verdict({ value: 3, assessment: 'pass' }, { x: { threshold: 4 } })).toBe('fail');
    expect(verdict({ value: 3, threshold: 5 }, { x: { threshold: 2 } })).toBe('pass');
  });

  it('a setting rule that does not decide leaves the result to the producer', () => {
    expect(verdict({ value: 3, assessment: 'fail' }, { x: { passLabels: ['ok'] } })).toBe('fail');
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

  it('lets the setting override a built-in', () => {
    expect(
      verdict({ name: 'Builtin.Helpfulness', value: 0.67 }, { 'Builtin.*': { threshold: 0.8 } })
    ).toBe('fail');
  });
});

describe('rules setting', () => {
  it('matches labels case-insensitively; one list alone makes others the opposite', () => {
    expect(verdict({ label: 'Friendly' }, { x: { passLabels: ['friendly'] } })).toBe('pass');
    expect(verdict({ label: 'rude' }, { x: { passLabels: ['friendly'] } })).toBe('fail');
    expect(verdict({ label: 'ok' }, { x: { failLabels: ['rude'] } })).toBe('pass');
    expect(verdict({ label: 'meh' }, { x: { passLabels: ['good'], failLabels: ['bad'] } })).toBe(
      'neutral'
    );
  });

  it('prefers exact names, then the longest prefix', () => {
    const rules = {
      'lat*': { threshold: 1 },
      'latency_*': { threshold: 10, direction: 'minimize' },
      latency_p99: { threshold: 100, direction: 'minimize' },
    };
    expect(verdict({ name: 'latency_p99', value: 50 }, rules)).toBe('pass');
    expect(verdict({ name: 'latency_p50', value: 50 }, rules)).toBe('fail');
    expect(verdict({ name: 'lateness', value: 2 }, rules)).toBe('pass');
    const entries = parseEvaluationRules(rules);
    expect(ruleFor(entries, 'latency_p50')?.threshold).toBe(10);
  });

  it('skips invalid entries with a warning and keeps the others', () => {
    const warn = jest.fn();
    const entries = parseEvaluationRules(
      {
        good: { threshold: 3 },
        bad: { threshold: 'high' },
        weird: { colour: 'red' },
        'a*b': { threshold: 1 },
        empty: {},
        range: { min: 5, max: 1 },
        list: { passLabels: [] },
      },
      warn
    );
    expect(entries.map((e) => e.pattern)).toEqual(['good']);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it('accepts JSON text and ignores bad JSON', () => {
    const warn = jest.fn();
    expect(parseEvaluationRules('{"a": {"threshold": 1}}', warn)).toHaveLength(1);
    expect(parseEvaluationRules('{oops', warn)).toEqual([]);
    expect(parseEvaluationRules('[]', warn)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('reads the active rules from uiSettings', () => {
    setEvaluationRulesSource({
      get: (key: string) => (key === EVALS_RULES_SETTING ? { a: { threshold: 2 } } : undefined),
    });
    expect(getActiveRuleEntries()).toHaveLength(1);
    expect(verdictOf({ name: 'a', value: 3 }, getActiveClauses())).toBe('pass');
    setEvaluationRulesSource(undefined);
    expect(getActiveRuleEntries()).toHaveLength(0);
  });

  it('is registered as a json advanced setting', () => {
    const setting = agentTracesUiSettings[EVALS_RULES_SETTING];
    expect(setting.type).toBe('json');
    expect(setting.value).toBe('{}');
    expect(setting.schema.validate('{"a": {"threshold": 1}}')).toEqual({ a: { threshold: 1 } });
  });
});

describe('threshold sign', () => {
  it('compares with the producer threshold from the sign alone', () => {
    const clauses = buildVerdictClauses([]);
    const at = (thresholdSign: number, direction?: string) =>
      verdictOf({ name: 'x', value: 0, threshold: 0, thresholdSign, direction }, clauses);
    expect(at(0)).toBe('pass');
    expect(at(-1)).toBe('fail');
    expect(at(-1, 'minimize')).toBe('pass');
    expect(at(1, 'minimize')).toBe('fail');
  });
});
