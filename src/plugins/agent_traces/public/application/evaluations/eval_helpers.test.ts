/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildEvalResultsQuery,
  buildRunDetailQuery,
  buildRunEventsQuery,
  buildTraceEvalsQuery,
  buildTracesEvalsQuery,
  metadataOf,
  recordToEvalResult,
  recordsToRunDetail,
  recordsToRunEvents,
} from './eval_data';
import {
  compactAppState,
  filtersOf,
  hasActiveFilters,
  normalizeAppState,
  baselineOf,
  runsTimeOf,
} from './eval_url_state';
import { sessionLink, sessionToOpen, traceDeepLinkPath, traceToOpen } from './eval_links';
import { errorMessage, fetchAggregates, isIndexMissing, queryProblem } from './use_eval_data';
import { clearMissingFieldsCache } from './eval_ppl';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { buildSameTargetQuery, sameTarget } from './result_flyout';
import { buildFacetsAggQuery } from './eval_ppl';
import { makeResult } from './eval_test_fixtures';

const GRADES_ONLY = "where `eventName` = 'gen_ai.evaluation.result'";

describe('eval queries', () => {
  it('reads grades only, never test case or run events', () => {
    expect(buildEvalResultsQuery()).toContain(GRADES_ONLY);
    expect(buildEvalResultsQuery({ runsOnly: true })).toContain(GRADES_ONLY);
    expect(buildFacetsAggQuery()).toContain(GRADES_ONLY);
    expect(buildTraceEvalsQuery('t1', 's1')).toContain(GRADES_ONLY);
    expect(buildTracesEvalsQuery(['t1', 't2'])).toContain(GRADES_ONLY);
    expect(buildSameTargetQuery(makeResult({ traceId: 't' }))).toContain(GRADES_ONLY);
  });
  it('reads test case and run events', () => {
    expect(buildRunEventsQuery(50)).toBe(
      "source = otel-v1-genai-evaluation-* | where `eventName` = 'opensearch.test_case.result' or `eventName` = 'opensearch.test_suite_run.result' | sort - `@timestamp` | head 50"
    );
  });
  it('searches name, label and explanation', () => {
    const q = buildEvalResultsQuery({ search: "it's" });
    expect(q).toContain("like(`attributes.gen_ai.evaluation.explanation`, '%it\\'s%')");
    expect(q).toContain('like(`attributes.gen_ai.evaluation.name`');
  });
  it('restricts to runs', () => {
    expect(buildEvalResultsQuery({ runsOnly: true })).toContain(
      'isnotnull(`attributes.test.suite.run.id`)'
    );
  });
  it('builds the facets query: every filter field and the verdict keys, under no filter', () => {
    const q = buildFacetsAggQuery();
    expect(q).toMatch(
      /stats count\(\) as n by `attributes.gen_ai.evaluation.name`, `attributes.derived.evaluation.level`, `attributes.derived.evaluation.source`, /
    );
    expect(q).not.toContain("= 'session'");
    // An index without a level field still lists names and sources.
    expect(
      buildFacetsAggQuery({ missing: new Set(['attributes.derived.evaluation.level']) })
    ).not.toContain('`attributes.derived.evaluation.level`,');
  });
});

describe('recordToEvalResult (AgentCore)', () => {
  it('reads session trace ids and rating scale', () => {
    const r = recordToEvalResult({
      '@timestamp': '2026-10-26 09:00:00',
      traceId: '',
      attributes: {
        gen_ai: {
          evaluation: {
            name: 'Builtin.Helpfulness',
            score: { label: 'Very Helpful', value: 0.83 },
          },
        },
        derived: { evaluation: { level: 'session', source: 'agentcore' }, session: { id: 's1' } },
        aws: {
          bedrock_agentcore: {
            evaluation_start_trace_id: 't-start',
            evaluation_end_trace_id: 't-end',
            evaluator: {
              arn: 'arn:aws:bedrock-agentcore:::evaluator/Builtin.Helpfulness',
              rating_scale: 'Categorical',
            },
          },
        },
      },
    });
    expect(r.outcome).toBe('pass');
    expect(r.startTraceId).toBe('t-start');
    expect(r.ratingScale).toBe('Categorical');
    expect(r.evaluator).toBe('Builtin.Helpfulness');
    expect(traceToOpen(r)).toBe('t-end');
  });
});

describe('recordsToRunEvents', () => {
  const testIds = {
    suite: { name: 'travel-planner-golden', run: { id: 'run-9', status: 'failure' } },
    case: { id: 'c1', name: 'Paris', result: { status: 'error' } },
  };
  it('parses test case and run events and ignores grades', () => {
    const events = recordsToRunEvents([
      {
        eventName: 'opensearch.test_case.result',
        '@timestamp': '2026-10-27 10:00:00',
        traceId: 'abc123',
        attributes: {
          test: testIds,
          error: { type: 'TimeoutError' },
          opensearch: {
            test_case: { input: 'in', expected: 'exp', output: 'out', duration_ms: 1234.5 },
          },
          gen_ai: { agent: { name: 'planner' } },
        },
        resource: { attributes: { 'service.name': 'travel-agent' } },
      },
      {
        eventName: 'opensearch.test_suite_run.result',
        '@timestamp': '2026-10-27 10:00:09',
        traceId: '',
        attributes: {
          test: testIds,
          opensearch: {
            test_suite_run: {
              case_count: 3,
              pass_count: 1,
              fail_count: 1,
              error_count: 1,
              duration_ms: 9000,
            },
          },
        },
      },
      { eventName: 'gen_ai.evaluation.result', attributes: { test: testIds } },
    ]);
    expect(events.cases).toEqual([
      {
        time: '2026-10-27 10:00:00',
        runId: 'run-9',
        suiteName: 'travel-planner-golden',
        caseId: 'c1',
        caseName: 'Paris',
        status: 'error',
        errorType: 'TimeoutError',
        input: 'in',
        expected: 'exp',
        output: 'out',
        durationMs: 1234.5,
        traceId: 'abc123',
        agentName: 'planner',
        serviceName: 'travel-agent',
      },
    ]);
    expect(events.runs).toEqual([
      {
        time: '2026-10-27 10:00:09',
        runId: 'run-9',
        suiteName: 'travel-planner-golden',
        status: 'failure',
        caseCount: 3,
        passCount: 1,
        failCount: 1,
        errorCount: 1,
        durationMs: 9000,
      },
    ]);
  });
  it('falls back to the derived target trace, reads dotted keys, drops events without a run id', () => {
    const events = recordsToRunEvents([
      {
        eventName: 'opensearch.test_case.result',
        '@timestamp': '2026-10-27 10:00:00',
        traceId: '',
        attributes: {
          'test.suite.run.id': 'run-1',
          'test.case.id': 'c2',
          'test.case.result.status': 'PASS',
          'derived.evaluation.target_trace_id': 'fallback',
        },
      },
      {
        eventName: 'opensearch.test_case.result',
        attributes: { 'test.case.id': 'orphan', 'test.case.result.status': 'skipped' },
      },
    ]);
    expect(events.cases).toHaveLength(1);
    expect(events.cases[0]).toMatchObject({ caseId: 'c2', status: 'pass', traceId: 'fallback' });
  });
});

describe('url state', () => {
  it('normalizes partial and invalid state', () => {
    expect(normalizeAppState(undefined).tab).toBe('overview');
    const s = normalizeAppState({
      tab: 'runs',
      names: ['a', 3, ''],
      failing: 'true',
      compare: ['x', 'y'],
      result: 'r1',
    });
    expect(s).toEqual({
      tab: 'runs',
      names: ['a'],
      levels: [],
      sources: [],
      failing: true,
      verdicts: [],
      runIds: [],
      q: '',
      result: 'r1',
      compare: ['x', 'y'],
    });
    expect(normalizeAppState({ tab: 'bogus', compare: ['only-one'] })).toEqual(
      normalizeAppState({})
    );
  });
  it('keeps 2-run compare links and reads up to five runs with a baseline', () => {
    const two = normalizeAppState({ compare: ['x', 'y'] });
    expect(baselineOf(two)).toBe('x');
    expect(compactAppState(two)).toEqual({ compare: ['x', 'y'] });
    const many = normalizeAppState({
      compare: ['a', 'b', 'c', 'b', 'd', 'e', 'f'],
      baseline: 'c',
    });
    expect(many.compare).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(baselineOf(many)).toBe('c');
    expect(compactAppState(many)).toMatchObject({ baseline: 'c' });
    expect(normalizeAppState({ compare: ['a', 'b'], baseline: 'z' }).baseline).toBeUndefined();
  });
  it('compacts to non-default keys and derives filters', () => {
    const s = normalizeAppState({ names: ['a'], q: 'x' });
    expect(compactAppState(s)).toEqual({ names: ['a'], q: 'x' });
    expect(filtersOf(s)).toMatchObject({ names: ['a'], search: 'x', failingOnly: false });
    expect(hasActiveFilters(s)).toBe(true);
    expect(hasActiveFilters(normalizeAppState({}))).toBe(false);
    const fromChart = normalizeAppState({ verdicts: ['pass', 'bogus'], runIds: ['run-1'] });
    expect(fromChart).toMatchObject({ verdicts: ['pass'], runIds: ['run-1'] });
    expect(filtersOf(fromChart)).toMatchObject({ outcomes: ['pass'], runIds: ['run-1'] });
    expect(compactAppState(fromChart)).toEqual({ verdicts: ['pass'], runIds: ['run-1'] });
    expect(hasActiveFilters(fromChart)).toBe(true);
  });
});

describe('trace deep link', () => {
  it('opens the trace with a time window around it', () => {
    const at = Date.UTC(2026, 9, 26, 12, 0, 0);
    expect(traceDeepLinkPath('abc123', at)).toBe(
      "#/?_g=(time:(from:'2026-10-26T06:00:00.000Z',to:'2026-10-26T13:00:00.000Z'))&_a=(ui:(activeTabId:traces,showHistogram:!t))&openTraceId=abc123"
    );
  });
  it('encodes unusual ids', () => {
    expect(traceDeepLinkPath('a b&c', 0)).toContain('openTraceId=a%20b%26c');
  });
  it('opens a session-level result as its session, with a time window around it', () => {
    const at = Date.parse('2026-10-26T12:00:00.000Z');
    expect(sessionLink('evalpoc-r2-s1', at)).toBe(
      "#/?_g=(time:(from:'2026-10-26T06:00:00.000Z',to:'2026-10-26T13:00:00.000Z'))&_a=(ui:(activeTabId:traces,showHistogram:!t))&openSessionId=evalpoc-r2-s1"
    );
    expect(sessionLink('a b&c', at)).toContain('openSessionId=a%20b%26c');
    expect(sessionToOpen(makeResult({ level: 'session', sessionId: 's1' }))).toBe('s1');
    expect(sessionToOpen(makeResult({ level: 'trace', sessionId: 's1' }))).toBeUndefined();
  });
});

describe('errors', () => {
  it('extracts the engine reason from a PPL error body', () => {
    const error = {
      body: {
        message: JSON.stringify({
          error: { reason: 'Error occurred', details: 'Field [x] not found.' },
        }),
      },
    };
    expect(errorMessage(error)).toBe('Field [x] not found.');
    expect(errorMessage(new Error('plain'))).toBe('plain');
  });
  it('detects a missing index', () => {
    expect(
      isIndexMissing({ body: { message: 'no such index [otel-v1-genai-evaluation-*]' } })
    ).toBe(true);
    expect(isIndexMissing(new Error('timeout'))).toBe(false);
  });

  it('names a script size limit in a few words', () => {
    const error = {
      body: {
        message: JSON.stringify({
          error: {
            reason: 'Error',
            details:
              'IllegalArgumentException[exceeded max allowed inline script size in bytes [65535] with size [71894]]',
          },
        }),
      },
    };
    expect(queryProblem(error)).toMatch(/^Pass rules too large for one query \(/);
    expect(queryProblem(new Error('boom'))).toBe('boom');
  });

  it('keeps the other aggregations when one fails, and says which and why', async () => {
    clearMissingFieldsCache();
    const executeQuery = jest.fn().mockImplementation((_d: unknown, query: string) =>
      query.includes('span(')
        ? Promise.reject(new Error('exceeded max allowed inline script size in bytes [65535]'))
        : Promise.resolve({
            schema: [{ name: 'n' }, { name: 'attributes.gen_ai.evaluation.name' }],
            datarows: [[3, 'answer_quality']],
          })
    );
    const agg = await fetchAggregates(
      { executeQuery } as unknown as PPLService,
      'evals-*',
      {},
      3600 * 1000
    );
    expect(agg.summaries.map((s) => [s.name, s.count])).toEqual([['answer_quality', 3]]);
    expect(agg.failed).toBe(false);
    expect(agg.buckets).toEqual([]);
    expect(agg.warnings).toHaveLength(1);
    expect(agg.warnings[0]).toMatch(/^Score trend and results over time: Pass rules too large/);
  });

  it('marks the counts unknown, not zero, when the summary fails', async () => {
    clearMissingFieldsCache();
    const executeQuery = jest.fn().mockRejectedValue(new Error('boom'));
    const agg = await fetchAggregates(
      { executeQuery } as unknown as PPLService,
      'evals-*',
      {},
      undefined
    );
    expect(agg.failed).toBe(true);
    expect(agg.warnings.length).toBeGreaterThan(0);
  });
});

describe('same target', () => {
  it('matches span results by span and session results by session', () => {
    const a = makeResult({ level: 'span', traceId: 't', spanId: 's' });
    expect(sameTarget(a, makeResult({ level: 'tool_call', traceId: 't', spanId: 's' }))).toBe(true);
    expect(sameTarget(a, makeResult({ level: 'span', traceId: 't', spanId: 'other' }))).toBe(false);
    expect(sameTarget(a, makeResult({ level: 'trace', traceId: 't' }))).toBe(false);
    const s = makeResult({ level: 'session', sessionId: 'x' });
    expect(sameTarget(s, makeResult({ level: 'session', sessionId: 'x' }))).toBe(true);
  });
  it('queries by session or trace', () => {
    expect(buildSameTargetQuery(makeResult({ level: 'session', sessionId: 'x' }))).toContain(
      "`attributes.derived.session.id` = 'x'"
    );
    expect(buildSameTargetQuery(makeResult({ traceId: 't' }))).toContain(
      "`attributes.derived.evaluation.target_trace_id` = 't'"
    );
    expect(
      buildSameTargetQuery(makeResult({ traceId: undefined, level: 'trace' }))
    ).toBeUndefined();
  });
});

describe('run detail records', () => {
  it('splits a run into grades and events, and keeps user metadata', () => {
    const rows = [
      {
        eventName: 'gen_ai.evaluation.result',
        '@timestamp': '2026-10-27 22:32:50',
        traceId: 't1',
        attributes: {
          gen_ai: { evaluation: { name: 'tool_selection', score: { value: 1 } } },
          test: { suite: { run: { id: 'run-1' } } },
        },
      },
      {
        eventName: 'opensearch.test_suite_run.result',
        '@timestamp': '2026-10-27 22:32:51',
        attributes: {
          agent: { model: 'haiku', version: 'v1' },
          test: { suite: { name: 's', run: { id: 'run-1', status: 'failure' } } },
          opensearch: { test_suite_run: { case_count: 8 } },
        },
      },
    ];
    const detail = recordsToRunDetail(rows);
    expect(detail.results.map((r) => r.name)).toEqual(['tool_selection']);
    expect(detail.events.runs[0]).toMatchObject({
      runId: 'run-1',
      caseCount: 8,
      metadata: { 'agent.model': 'haiku', 'agent.version': 'v1' },
    });
  });

  it('reads every event of one run, without a time range', () => {
    expect(buildRunDetailQuery("run'1", 50)).toBe(
      "source = otel-v1-genai-evaluation-* | where `attributes.test.suite.run.id` = 'run\\'1' | sort - `@timestamp` | head 50"
    );
  });

  it('flattens metadata and leaves the contract attributes out', () => {
    expect(
      metadataOf({ agent: { version: 'v2' }, test: { case: { id: 'x' } }, git: { sha: 'abc' } })
    ).toEqual({ 'agent.version': 'v2', 'git.sha': 'abc' });
    expect(metadataOf({ test: { suite: { name: 's' } } })).toBeUndefined();
  });
});

describe('run page and runs time range in the URL', () => {
  it('keeps the run key used by external links, and the runs time range when not default', () => {
    const s = normalizeAppState({
      tab: 'runs',
      run: 'run_20261027_153137_4ed49a57',
      runsTime: { from: 'now-30d', to: 'now' },
      evaluation: 'answer_quality',
    });
    expect(s).toMatchObject({
      tab: 'runs',
      run: 'run_20261027_153137_4ed49a57',
      runsTime: { from: 'now-30d', to: 'now' },
      evaluation: 'answer_quality',
    });
    expect(compactAppState(s)).toEqual({
      tab: 'runs',
      run: 'run_20261027_153137_4ed49a57',
      runsTime: { from: 'now-30d', to: 'now' },
      evaluation: 'answer_quality',
    });
  });

  it('defaults the runs time range to the last 7 days and leaves it out of the URL', () => {
    const s = normalizeAppState({ tab: 'runs', runsTime: { from: 1 } });
    expect(runsTimeOf(s)).toEqual({ from: 'now-7d', to: 'now' });
    expect(compactAppState({ ...s, runsTime: { from: 'now-7d', to: 'now' } })).toEqual({
      tab: 'runs',
    });
  });
});
