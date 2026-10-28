/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildDistinctAggQuery,
  buildMatchingTraceIdsQuery,
  buildSummaryAggQuery,
  buildTrendAggQuery,
  bucketsFromAgg,
  executeEvalPpl,
  groupsFromProbe,
  kpisFromAgg,
  missingFieldOf,
  spanUnit,
  summariesFromAgg,
  toAggRows,
  trendFromAgg,
  clearMissingFieldsCache,
} from './eval_ppl';
import { EVAL_FIELDS } from './eval_data';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';

const F = EVAL_FIELDS;

const row = (r: Record<string, unknown>) => ({
  [F.name]: 'answer_quality',
  [F.level]: 'span',
  [F.source]: 'opensearch-sdk',
  n: 1,
  nv: 1,
  sv: 4,
  vmin: 4,
  vmax: 4,
  evl_verdict: 'pass',
  ...r,
});

describe('aggregation queries', () => {
  it('computes the verdict in the query and groups by it', () => {
    const q = buildSummaryAggQuery({ names: ['a'] }, { index: 'evals-*' });
    expect(q).toMatch(/^source = evals-\* \| where `eventName` = 'gen_ai.evaluation.result'/);
    expect(q).toContain('| eval evl_verdict = case(');
    expect(q).toContain('count(`attributes.gen_ai.evaluation.score.value`) as nv');
    expect(q).toMatch(/by `attributes\.gen_ai\.evaluation\.name`, .*evl_verdict \| head 10000$/);
  });

  it('buckets time with span() and leaves out fields the index lacks', () => {
    const q = buildTrendAggQuery({}, 5 * 60 * 1000, {
      missing: new Set([F.scoreMin, F.scoreMax, F.direction]),
    });
    expect(q).toContain(
      'by span(`@timestamp`, 5m) as t, `attributes.gen_ai.evaluation.name`, evl_verdict'
    );
    expect(q).not.toContain(F.scoreMin);
  });

  it('filters verdicts after computing them', () => {
    const q = buildDistinctAggQuery({ failingOnly: true });
    expect(q).toContain("| where evl_verdict = 'fail' | stats count() as n, distinct_count(");
    expect(buildDistinctAggQuery({}, { withoutVerdict: true })).not.toContain('evl_verdict');
  });

  it('lists distinct traces of matching results, one more than the cap', () => {
    const q = buildMatchingTraceIdsQuery({ names: ['a'], valueBelow: 3 }, 500);
    expect(q).toContain('`attributes.gen_ai.evaluation.score.value` < 3');
    expect(q).toContain(
      'stats max(`@timestamp`) as last by `attributes.derived.evaluation.target_trace_id`'
    );
    expect(q).toMatch(/head 501$/);
  });

  it('writes PPL span units', () => {
    expect(spanUnit(60 * 1000)).toBe('1m');
    expect(spanUnit(3 * 3600 * 1000)).toBe('3h');
    expect(spanUnit(7 * 24 * 3600 * 1000)).toBe('7d');
  });
});

describe('aggregated rows', () => {
  const rows = toAggRows([
    row({
      [F.label]: 'correct',
      n: 20,
      nv: 20,
      sv: 90,
      vmin: 4,
      vmax: 5,
      [F.scoreMin]: 1,
      [F.scoreMax]: 5,
    }),
    row({
      [F.label]: 'incorrect',
      n: 5,
      nv: 5,
      sv: 5,
      vmin: 1,
      vmax: 1,
      evl_verdict: 'fail',
      [F.scoreMin]: 1,
      [F.scoreMax]: 5,
    }),
    row({
      [F.name]: 'coverage',
      [F.label]: 'Full',
      n: 10,
      nv: 10,
      sv: 10,
      vmin: 1,
      vmax: 1,
      evl_verdict: 'neutral',
    }),
    row({
      [F.name]: 'coverage',
      [F.label]: null,
      n: 2,
      nv: 0,
      sv: 0,
      vmin: null,
      vmax: null,
      evl_verdict: 'error',
    }),
  ]);

  it('adds up counts, verdicts, means and labels per evaluation, most failing first', () => {
    const [aq, coverage] = summariesFromAgg(rows, []);
    expect(aq).toMatchObject({
      name: 'answer_quality',
      count: 25,
      passCount: 20,
      failCount: 5,
      neutralCount: 0,
      mean: 95 / 25,
      levels: ['span'],
    });
    // (4.5 - 1) / 4 for 20 results, 0 for 5
    expect(aq.normalizedMean).toBeCloseTo((0.875 * 20) / 25);
    expect(aq.labels).toEqual([
      { label: 'correct', count: 20, outcome: 'pass' },
      { label: 'incorrect', count: 5, outcome: 'fail' },
    ]);
    expect(coverage).toMatchObject({ count: 12, neutralCount: 10, errorCount: 2, passCount: 0 });
    // values seen within 0..1 read as a 0..1 scale
    expect(coverage.normalizedMean).toBe(1);
  });

  it('computes KPIs: pass rate without neutral results and errors', () => {
    const kpis = kpisFromAgg(summariesFromAgg(rows, []), { traces: 7, sessions: 2 });
    expect(kpis).toEqual({
      results: 37,
      evaluators: 2,
      passRate: 0.8,
      failing: 5,
      errors: 2,
      scored: 10,
      traces: 7,
      sessions: 2,
    });
  });

  it('builds outcome buckets and a normalized trend from time rows', () => {
    const timed = toAggRows([
      row({
        t: '2026-10-26 08:00:00',
        n: 3,
        nv: 3,
        sv: 15,
        vmin: 5,
        vmax: 5,
        [F.scoreMin]: 1,
        [F.scoreMax]: 5,
      }),
      row({
        t: '2026-10-26 08:00:00',
        n: 1,
        nv: 1,
        sv: 1,
        vmin: 1,
        vmax: 1,
        evl_verdict: 'fail',
        [F.scoreMin]: 1,
        [F.scoreMax]: 5,
      }),
      row({
        t: '2026-10-26 08:00:00',
        [F.name]: 'latency',
        n: 2,
        nv: 2,
        sv: 30,
        vmin: 10,
        vmax: 20,
        evl_verdict: 'neutral',
      }),
    ]);
    const x = Date.parse('2026-10-26T08:00:00Z');
    const { all, byName } = bucketsFromAgg(timed);
    expect(all).toEqual(
      expect.arrayContaining([
        { x, outcome: 'pass', count: 3 },
        { x, outcome: 'fail', count: 1 },
        { x, outcome: 'neutral', count: 2 },
      ])
    );
    expect(byName.get('latency')).toEqual([{ x, outcome: 'neutral', count: 2 }]);
    // latency has no known range: not on the normalized trend
    expect(trendFromAgg(timed, [])).toEqual([{ x, name: 'answer_quality', value: 0.75, count: 4 }]);
  });

  it('uses the rules setting for the score range and direction', () => {
    const timed = toAggRows([
      row({ t: '2026-10-26 08:00:00', [F.name]: 'latency', n: 2, nv: 2, sv: 10, vmin: 5, vmax: 5 }),
    ]);
    const rules = [
      { pattern: 'latency', rule: { min: 0, max: 10, direction: 'minimize' as const } },
    ];
    expect(trendFromAgg(timed, rules)[0].value).toBeCloseTo(0.5);
  });
});

describe('index groups', () => {
  it('groups indices by the optional fields their results hold', () => {
    const bucket = (key: string, present: number[]) => {
      const b: Record<string, unknown> = { key, doc_count: 10 };
      for (let i = 0; i < 12; i++) b[`f${i}`] = { doc_count: present.includes(i) ? 3 : 0 };
      return b;
    };
    const all = Array.from({ length: 12 }, (_, i) => i);
    const groups = groupsFromProbe({
      rawResponse: {
        aggregations: {
          idx: {
            buckets: [
              bucket('evals-2026.10.28', all),
              bucket('evals-2026.10.26', all.slice(2)),
              bucket('evals-2026.10.27', all.slice(2)),
            ],
          },
        },
      },
    });
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.source).sort()).toEqual([
      'evals-2026.10.26,evals-2026.10.27',
      'evals-2026.10.28',
    ]);
    const older = groups.find((g) => g.source.includes('10.26'));
    expect(older?.missing.has(F.assessment)).toBe(true);
    expect(older?.missing.has(F.threshold)).toBe(true);
    expect(older?.missing.has(F.label)).toBe(false);
  });

  it('runs once per group and drops a field PPL does not know', async () => {
    clearMissingFieldsCache();
    const executeQuery = jest
      .fn()
      .mockRejectedValueOnce({
        body: { message: '{"error":{"reason":"Field [attributes.error.type] not found."}}' },
      })
      .mockResolvedValue({ schema: [{ name: 'n' }], datarows: [[2]] });
    const ppl = { executeQuery } as unknown as PPLService;
    const build = jest.fn(
      (missing: ReadonlySet<string>, source: string) => `${source}:${Array.from(missing).join(',')}`
    );
    const rows = await executeEvalPpl(ppl, 'evals-*', build, [
      { source: 'a', missing: new Set() },
      { source: 'b', missing: new Set([F.assessment]) },
    ]);
    expect(rows).toEqual([{ n: 2 }, { n: 2 }]);
    expect(build).toHaveBeenCalledWith(new Set([F.errorType]), 'a');
    expect(executeQuery).toHaveBeenCalledTimes(3);
  });

  it('reads the missing field from a PPL error', () => {
    expect(missingFieldOf(new Error('Field [x.y] not found.'))).toBe('x.y');
    expect(missingFieldOf(new Error('boom'))).toBeUndefined();
  });
});
