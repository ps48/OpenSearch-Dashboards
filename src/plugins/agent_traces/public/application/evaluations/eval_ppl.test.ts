/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RESULTS_PAGE_SIZES,
  buildResultsPageQuery,
  fetchResultsPage,
  buildDistinctAggQuery,
  buildMatchingTraceIdsQuery,
  buildSummaryAggQuery,
  buildTrendAggQuery,
  bucketsFromAgg,
  executeEvalPpl,
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
  it('groups by what the verdict reads, not by a verdict computed in the query', () => {
    const q = buildSummaryAggQuery({ names: ['a'] }, { index: 'evals-*' });
    expect(q).toMatch(/^source = evals-\* \| where `eventName` = 'gen_ai.evaluation.result'/);
    expect(q).not.toContain('evl_verdict');
    expect(q).toContain('| eval evl_vb0 = case(');
    expect(q).toContain('count(`attributes.gen_ai.evaluation.score.value`) as nv');
    expect(q).toMatch(
      /by `attributes\.gen_ai\.evaluation\.name`, .*`attributes\.error\.type`, .*evl_vb0, evl_tc \| head 10000$/
    );
  });

  it('buckets time with span() and leaves out fields the index lacks', () => {
    const q = buildTrendAggQuery({}, 5 * 60 * 1000, {
      missing: new Set([F.scoreMin, F.scoreMax, F.direction]),
    });
    expect(q).toContain(
      'by span(`@timestamp`, 5m) as t, `attributes.gen_ai.evaluation.name`, `attributes.gen_ai.evaluation.score.label`'
    );
    expect(q).not.toContain(F.scoreMin);
  });

  it('filters verdicts with the where it is given', () => {
    const q = buildDistinctAggQuery({ failingOnly: true }, { verdictWhere: '`x` = 1' });
    expect(q).toContain('| where `x` = 1 | stats count() as n, distinct_count(');
    expect(buildDistinctAggQuery({ failingOnly: true })).not.toContain('evl_');
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

  it("uses the producer's score range and direction", () => {
    const timed = toAggRows([
      row({
        t: '2026-10-26 08:00:00',
        [F.name]: 'latency',
        [F.scoreMin]: 0,
        [F.scoreMax]: 10,
        [F.direction]: 'minimize',
        n: 2,
        nv: 2,
        sv: 4,
        vmin: 2,
        vmax: 2,
      }),
    ]);
    expect(trendFromAgg(timed)[0].value).toBeCloseTo(0.8);
  });
});

describe('one query on the index pattern', () => {
  it('runs once on the pattern and drops a field PPL does not know, for a while', async () => {
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
    expect(await executeEvalPpl(ppl, 'evals-*', build)).toEqual([{ n: 2 }]);
    expect(build).toHaveBeenLastCalledWith(new Set([F.errorType]), 'evals-*');
    expect(executeQuery).toHaveBeenCalledTimes(2);
    // Remembered: the next query names it no more.
    await executeEvalPpl(ppl, 'evals-*', build);
    expect(executeQuery).toHaveBeenCalledTimes(3);
    expect(executeQuery.mock.calls[2][1]).toBe(`evals-*:${F.errorType}`);
  });

  it('reads nothing when a field the query cannot do without is missing', async () => {
    clearMissingFieldsCache();
    const executeQuery = jest.fn().mockRejectedValue(new Error('Field [run.id] not found.'));
    const ppl = { executeQuery } as unknown as PPLService;
    expect(await executeEvalPpl(ppl, 'evals-*', () => 'q', { emptyWithout: ['run.id'] })).toEqual(
      []
    );
    await expect(executeEvalPpl(ppl, 'evals-*', () => 'q')).rejects.toThrow('run.id');
  });

  it('reads the missing field from a PPL error', () => {
    expect(missingFieldOf(new Error('Field [x.y] not found.'))).toBe('x.y');
    expect(missingFieldOf(new Error('boom'))).toBeUndefined();
  });
});

describe('Results paging', () => {
  it('pages in PPL with head from, sorted by the column', () => {
    expect(buildResultsPageQuery({}, { field: 'time', direction: 'desc' }, 50, 25)).toMatch(
      /\| sort - `@timestamp` \| head 25 from 50$/
    );
    expect(buildResultsPageQuery({}, { field: 'name', direction: 'asc' }, 0, 25)).toMatch(
      /\| sort `attributes\.gen_ai\.evaluation\.name`, - `@timestamp` \| head 25$/
    );
    const byResult = buildResultsPageQuery({}, { field: 'result', direction: 'asc' }, 0, 25, {
      verdictWhere: '`x` = 1',
    });
    expect(byResult).not.toContain('case(');
    expect(byResult).toMatch(
      /where `x` = 1 \| sort `attributes\.gen_ai\.evaluation\.score\.value`, - `@timestamp` \| head 25$/
    );
    expect(RESULTS_PAGE_SIZES.every((size) => 10000 % size === 0)).toBe(true);
  });

  /** A PPL service answering verdict group queries with `groups`, other queries with one row. */
  const pplWithGroups = (groups: Array<Record<string, unknown>>) => {
    const executeQuery = jest.fn().mockImplementation((_d: unknown, query: string) => {
      if (query.includes('stats count() as n by')) {
        const cols = Object.keys(groups[0] ?? { n: 0 });
        return Promise.resolve({
          schema: cols.map((name) => ({ name })),
          datarows: groups.map((g) => cols.map((c) => g[c])),
        });
      }
      return Promise.resolve({
        schema: [{ name: '@timestamp' }, { name: F.name }],
        datarows: [['2026-10-28 10:00:00', 'answer_quality']],
      });
    });
    return { executeQuery, ppl: { executeQuery } as unknown as PPLService };
  };
  const group = (r: Record<string, unknown>) => ({
    n: 1,
    [F.name]: 'answer_quality',
    [F.label]: null,
    [F.errorType]: null,
    [F.assessment]: null,
    [F.direction]: null,
    [F.source]: 'opensearch-sdk',
    evl_vb0: -1,
    evl_tc: -2,
    ...r,
  });

  it('reads a page of one query without a verdict filter', async () => {
    clearMissingFieldsCache();
    const { executeQuery, ppl } = pplWithGroups([]);
    const page = await fetchResultsPage(ppl, 'evals-*', {}, DEFAULT_SORT, 400, 25);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0][1]).toMatch(/sort - `@timestamp` \| head 25 from 10000$/);
    expect(page.rows).toHaveLength(1);
  });

  it('turns a verdict filter into a where on the verdict groups', async () => {
    clearMissingFieldsCache();
    const { executeQuery, ppl } = pplWithGroups([
      group({ n: 3, [F.assessment]: 'fail' }),
      group({ n: 5, [F.assessment]: 'pass' }),
    ]);
    const page = await fetchResultsPage(ppl, 'evals-*', { failingOnly: true }, DEFAULT_SORT, 0, 25);
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(executeQuery.mock.calls[1][1]).toContain(
      "where (`attributes.gen_ai.evaluation.name` = 'answer_quality' and `attributes.opensearch.evaluation.assessment` = 'fail') | sort - `@timestamp` | head 25"
    );
    expect(page.rows).toHaveLength(1);
  });

  it('reads nothing when no group has the verdict', async () => {
    clearMissingFieldsCache();
    const { executeQuery, ppl } = pplWithGroups([group({ [F.assessment]: 'pass' })]);
    const page = await fetchResultsPage(ppl, 'evals-*', { failingOnly: true }, DEFAULT_SORT, 0, 25);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(page.rows).toHaveLength(0);
  });

  it('by Result, pages each verdict apart: failures first, then the next verdict', async () => {
    clearMissingFieldsCache();
    const { executeQuery, ppl } = pplWithGroups([
      group({ n: 30, [F.assessment]: 'fail' }),
      group({ n: 4, [F.errorType]: 'Timeout' }),
      group({ n: 50, [F.assessment]: 'pass' }),
    ]);
    await fetchResultsPage(ppl, 'evals-*', {}, { field: 'result', direction: 'asc' }, 1, 25);
    const queries = executeQuery.mock.calls.map((c) => c[1] as string).slice(1);
    // Rows 25..49: failures 25..29, errors 0..3, passes 0..15.
    expect(queries).toHaveLength(3);
    expect(queries[0]).toMatch(/assessment` = 'fail'.*head 5 from 25$/);
    expect(queries[1]).toMatch(/error\.type` = 'Timeout'.*head 4$/);
    expect(queries[2]).toMatch(/assessment` = 'pass'.*head 16$/);
  });
});

const DEFAULT_SORT = { field: 'time', direction: 'desc' } as const;
