/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeResult, twoRunFixture } from './eval_test_fixtures';
import { summarizeByEvaluator } from './eval_data';
import { summarizeRuns } from './eval_aggregations';
import { needsAttention, topChanges } from './eval_attention';

const results = (name: string, values: number[], extra = {}) =>
  values.map((value) => makeResult({ name, value, scoreMin: 0, scoreMax: 1, ...extra }));

describe('needsAttention', () => {
  it('names the biggest drop, the lowest pass rate, new failing labels and silent evaluations', () => {
    const previous = summarizeByEvaluator([
      ...results('accuracy', [0.9, 0.9, 0.9, 0.9]),
      ...results('helpfulness', [0.9, 0.2]),
      ...results('tool_diversity', [0.9]),
      makeResult({ name: 'tone', label: 'pass' }),
    ]);
    const current = summarizeByEvaluator([
      ...results('accuracy', [0.9, 0.2, 0.2, 0.9]),
      ...results('helpfulness', [0.9, 0.2, 0.2]),
      makeResult({ name: 'tone', label: 'fail' }),
    ]);
    const findings = needsAttention(current, previous);
    expect(findings.map((f) => f.kind)).toEqual(['drop', 'lowest', 'newLabel', 'silent']);
    expect(findings[0]).toMatchObject({ name: 'tone', from: 1, to: 0 });
    expect(findings[1]).toMatchObject({ kind: 'lowest', name: 'helpfulness' });
    expect(findings[2]).toMatchObject({ name: 'tone', label: 'fail', count: 1 });
    expect(findings[3]).toMatchObject({ name: 'tool_diversity', previousCount: 1 });
  });

  it('names the most regressed run in the range', () => {
    const runs = summarizeRuns(twoRunFixture());
    const findings = needsAttention([], [], runs);
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'runRegression',
        run: expect.objectContaining({ runId: 'run-2' }),
      }),
    ]);
  });

  it('finds nothing in a steady range', () => {
    const same = summarizeByEvaluator(results('accuracy', [0.9, 0.9]));
    expect(needsAttention(same, same)).toEqual([]);
  });
});

describe('topChanges', () => {
  it('sorts by the worst change, pass rate or normalized mean, new ones last', () => {
    const previous = summarizeByEvaluator([
      ...results('accuracy', [0.9, 0.9]),
      makeResult({ name: 'latency', value: 2, direction: 'minimize', scoreMin: 0, scoreMax: 10 }),
    ]);
    const current = summarizeByEvaluator([
      ...results('accuracy', [0.9, 0.2]),
      makeResult({ name: 'latency', value: 1, direction: 'minimize', scoreMin: 0, scoreMax: 10 }),
      ...results('helpfulness', [0.9]),
    ]);
    const changes = topChanges(current, previous);
    expect(changes.map((c) => [c.name, c.metric, c.change])).toEqual([
      ['accuracy', 'passRate', 'regressed'],
      // Lower is better: 2 to 1 is an improvement.
      ['latency', 'mean', 'improved'],
      ['helpfulness', 'passRate', undefined],
    ]);
    expect(changes[0].score).toBeCloseTo(-0.5);
  });
});
