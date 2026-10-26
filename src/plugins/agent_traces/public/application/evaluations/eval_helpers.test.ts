/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildEvalFacetsQuery, buildEvalResultsQuery, recordToEvalResult } from './eval_data';
import { compactAppState, filtersOf, hasActiveFilters, normalizeAppState } from './eval_url_state';
import { traceDeepLinkPath, traceToOpen } from './eval_links';
import { errorMessage, isIndexMissing } from './use_eval_data';
import { buildSameTargetQuery, sameTarget } from './result_flyout';
import { makeResult } from './eval_test_fixtures';

describe('eval queries', () => {
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
  it('builds the facets query', () => {
    expect(buildEvalFacetsQuery({ levels: ['session'] })).toMatch(
      /where \(`attributes.derived.evaluation.level` = 'session'\) \| stats count\(\) as results by/
    );
  });
});

describe('recordToEvalResult (AgentCore)', () => {
  it('reads session trace ids and rating scale', () => {
    const r = recordToEvalResult({
      '@timestamp': '2026-10-26 09:00:00',
      traceId: '',
      attributes: {
        gen_ai: { evaluation: { name: 'Builtin.Helpfulness', score: { label: 'Very Helpful' } } },
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
      q: '',
      result: 'r1',
      compare: ['x', 'y'],
    });
    expect(normalizeAppState({ tab: 'bogus', compare: ['only-one'] })).toEqual(
      normalizeAppState({})
    );
  });
  it('compacts to non-default keys and derives filters', () => {
    const s = normalizeAppState({ names: ['a'], q: 'x' });
    expect(compactAppState(s)).toEqual({ names: ['a'], q: 'x' });
    expect(filtersOf(s)).toMatchObject({ names: ['a'], search: 'x', failingOnly: false });
    expect(hasActiveFilters(s)).toBe(true);
    expect(hasActiveFilters(normalizeAppState({}))).toBe(false);
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
