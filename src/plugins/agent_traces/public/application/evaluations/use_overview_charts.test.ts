/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { makeResult } from './eval_test_fixtures';
import { VERDICT_CLAUSES } from './eval_verdict';
import {
  buildRootSpansQuery,
  buildValueCountsQuery,
  clearOverviewChartsCache,
  distributionOf,
  judgedLatencyOf,
  judgedTraces,
  median,
  rootSpansOf,
  useScoreDistribution,
  valueCountsOf,
} from './use_overview_charts';

describe('buildValueCountsQuery', () => {
  it('counts one evaluation by value, threshold and verdict keys, in one aggregation', () => {
    const q = buildValueCountsQuery({}, 'answer_quality', {
      index: 'otel-v1-genai-evaluation*',
      clauses: VERDICT_CLAUSES,
    });
    expect(q).toContain('source = otel-v1-genai-evaluation*');
    expect(q).toContain("`attributes.gen_ai.evaluation.name` = 'answer_quality'");
    expect(q).toContain('where isnotnull(`attributes.gen_ai.evaluation.score.value`)');
    expect(q).toMatch(
      /stats count\(\) as n by `attributes\.gen_ai\.evaluation\.score\.value`, `attributes\.opensearch\.evaluation\.score\.threshold`/
    );
    expect(q).not.toMatch(/lower\(/);
  });

  it('leaves the threshold out when it is not mapped', () => {
    const q = buildValueCountsQuery({}, 'x', {
      missing: new Set(['attributes.opensearch.evaluation.score.threshold']),
      clauses: VERDICT_CLAUSES,
    });
    expect(q).not.toContain('score.threshold`,');
  });
});

describe('distributionOf', () => {
  it('keeps one bin per value on a small whole-number scale, stacked by verdict', () => {
    const d = distributionOf(
      valueCountsOf([
        {
          'attributes.gen_ai.evaluation.score.value': 1,
          evl_verdict: 'fail',
          n: 3,
          'attributes.opensearch.evaluation.score.threshold': 4,
        },
        {
          'attributes.gen_ai.evaluation.score.value': 5,
          evl_verdict: 'pass',
          n: 6,
          'attributes.opensearch.evaluation.score.threshold': 4,
        },
        { 'attributes.gen_ai.evaluation.score.value': 4, evl_verdict: 'pass', n: 1 },
      ])
    );
    expect(d?.width).toBe(1);
    expect(d?.bins.map((b) => [b.x, b.outcome, b.count])).toEqual([
      [1, 'fail', 3],
      [4, 'pass', 1],
      [5, 'pass', 6],
    ]);
    expect(d?.threshold).toBe(4);
    expect(d?.total).toBe(10);
    expect(d?.mean).toBeCloseTo((3 + 30 + 4) / 10);
  });

  it('bins continuous values in ten equal bins', () => {
    const d = distributionOf(
      [0, 0.05, 0.5, 0.95, 1].map((value) => ({ value, outcome: 'neutral' as const, count: 1 }))
    );
    expect(d?.width).toBeCloseTo(0.1);
    expect(d?.bins[0]).toEqual({ x: 0, outcome: 'neutral', count: 2 });
    // 1 lands in the last bin, not an eleventh one.
    expect(d?.bins[d.bins.length - 1].x).toBeCloseTo(0.9);
    expect(d?.bins[d.bins.length - 1].count).toBe(2);
  });

  it('is undefined without values', () => {
    expect(distributionOf([])).toBeUndefined();
  });
});

describe('judged trace latency', () => {
  it('counts a trace with any failing evaluation as failing only', () => {
    const ids = judgedTraces(
      [makeResult({ traceId: 't1' }), makeResult({ traceId: 't1' })],
      [makeResult({ traceId: 't1' }), makeResult({ traceId: 't2' })]
    );
    expect(ids).toEqual({ failing: ['t1'], passing: ['t2'] });
  });

  it('reads root spans of a batch of traces', () => {
    expect(buildRootSpansQuery(['a', "b'c"], 'otel-v1-apm-span-*')).toBe(
      "source = otel-v1-apm-span-* | where parentSpanId = '' and (traceId = 'a' or traceId = 'b\\'c') | fields traceId, startTime, durationInNanos | head 4"
    );
    expect(
      rootSpansOf([{ traceId: 'a', startTime: '2026-10-28 14:00:00', durationInNanos: 2.5e9 }])
    ).toEqual([{ traceId: 'a', startMs: Date.UTC(2026, 9, 28, 14), durationMs: 2500 }]);
  });

  it('computes p50 per interval and the failing vs passing ratio', () => {
    const at = Date.UTC(2026, 9, 28, 14);
    const span = (traceId: string, durationMs: number, offset = 0) => ({
      traceId,
      startMs: at + offset,
      durationMs,
    });
    const l = judgedLatencyOf(
      [
        span('f1', 3000),
        span('f2', 4000),
        span('f3', 5000),
        span('p1', 1000),
        span('p2', 2000),
        span('p3', 3000),
        // a second, shorter root of p3 is ignored
        span('p3', 10),
      ],
      { failing: ['f1', 'f2', 'f3'], passing: ['p1', 'p2', 'p3'] },
      3600 * 1000
    );
    expect(l.failingP50).toBe(4000);
    expect(l.passingP50).toBe(2000);
    expect(l.ratio).toBe(2);
    expect(l.points).toEqual([
      { x: at, group: 'passing', p50: 2000, count: 3 },
      { x: at, group: 'failing', p50: 4000, count: 3 },
    ]);
  });

  it('gives no ratio with too few traces', () => {
    const l = judgedLatencyOf(
      [{ traceId: 'f1', startMs: 0, durationMs: 1 }],
      { failing: ['f1'], passing: [] },
      1000
    );
    expect(l.ratio).toBeUndefined();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});

describe('useScoreDistribution', () => {
  beforeEach(() => clearOverviewChartsCache());

  const dataWith = (rows: unknown[][], schema: Array<{ name: string }>) => {
    const search = jest.fn().mockReturnValue({
      toPromise: () => Promise.resolve({ rawResponse: { jsonData: [], schema, datarows: rows } }),
    });
    return { search: { search } };
  };

  it('queries nothing without a data service or an evaluation', () => {
    const { result } = renderHook(() =>
      useScoreDistribution(undefined, { from: 0, to: 1 }, {}, 'x')
    );
    expect(result.current).toEqual({ loading: false });
  });

  it('does not query while disabled', () => {
    const data = dataWith([], []);
    renderHook(() =>
      useScoreDistribution(data as never, { from: 0, to: 1 }, {}, 'x', undefined, false)
    );
    expect(data.search.search).not.toHaveBeenCalled();
  });
});
