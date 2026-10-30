/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  NO_VALUE,
  SpanFacts,
  breakdownFailures,
  buildFailureSpansQuery,
  joinFailures,
  latestFailures,
  recordToSpanFacts,
  spanLookupBatches,
  topConcentration,
} from './eval_drilldown';
import { makeResult } from './eval_test_fixtures';

const facts = (partial: Partial<SpanFacts> & { traceId: string; spanId: string }): SpanFacts => ({
  name: partial.operation ?? 'span',
  ...partial,
});

/** Trace t1 called search_flights and search_hotels; t2 called get_weather; t3 nothing. */
const spans: SpanFacts[] = [
  facts({ traceId: 't1', spanId: 'root1', operation: 'invoke_agent', agentName: 'planner' }),
  facts({
    traceId: 't1',
    spanId: 'tool1',
    parentSpanId: 'x',
    operation: 'execute_tool',
    toolName: 'search_flights',
  }),
  facts({
    traceId: 't1',
    spanId: 'tool2',
    parentSpanId: 'x',
    operation: 'execute_tool',
    toolName: 'search_hotels',
  }),
  facts({ traceId: 't1', spanId: 'chat1', parentSpanId: 'x', operation: 'chat' }),
  facts({ traceId: 't2', spanId: 'root2', operation: 'invoke_agent', agentName: 'planner' }),
  facts({
    traceId: 't2',
    spanId: 'tool3',
    parentSpanId: 'x',
    operation: 'execute_tool',
    toolName: 'get_weather',
  }),
  facts({ traceId: 't3', spanId: 'root3', serviceName: 'svc' }),
];

const fail = (partial: Parameters<typeof makeResult>[0]) =>
  makeResult({ name: 'answer_quality', label: 'fail', value: 0, ...partial });

describe('joinFailures', () => {
  it('joins span results to the judged span and trace results to the agent span', () => {
    const [spanLevel, traceLevel, toolLevel] = joinFailures(
      [
        fail({ traceId: 't1', spanId: 'chat1', level: 'span' }),
        fail({ traceId: 't2', spanId: undefined, level: 'trace' }),
        fail({ traceId: 't1', spanId: 'tool2', level: 'tool_call' }),
      ],
      spans
    );
    expect(spanLevel.span?.spanId).toBe('chat1');
    expect(spanLevel.operation).toBe('chat');
    expect(spanLevel.tools).toEqual(['search_flights', 'search_hotels']);
    expect(spanLevel.agent).toBe('planner');
    expect(traceLevel.span?.spanId).toBe('root2');
    expect(traceLevel.operation).toBe('trace');
    expect(traceLevel.tools).toEqual(['get_weather']);
    expect(toolLevel.tools).toEqual(['search_hotels']);
    expect(toolLevel.operation).toBe('execute_tool');
  });

  it('keeps failures whose spans are not found, using the result fields', () => {
    const [j] = joinFailures(
      [fail({ traceId: 'gone', spanId: 's', serviceName: 'svc-a', agentName: undefined })],
      spans
    );
    expect(j.span).toBeUndefined();
    expect(j.agent).toBe('svc-a');
    expect(j.tools).toEqual([]);
  });

  it('does not join session results to a span', () => {
    const [j] = joinFailures([fail({ traceId: 't1', level: 'session', sessionId: 's1' })], spans);
    expect(j.span).toBeUndefined();
    expect(j.operation).toBe('session');
  });
});

describe('breakdownFailures', () => {
  const joined = joinFailures(
    [
      fail({ traceId: 't1', spanId: 'root1', level: 'span', runId: 'run-v1', label: 'fail' }),
      fail({ traceId: 't1', spanId: 'root1', level: 'span', runId: 'run-v1', label: 'fail' }),
      fail({ traceId: 't1', spanId: 'root1', level: 'span', runId: 'run-v1', label: 'partial' }),
      fail({ traceId: 't2', spanId: 'root2', level: 'span', runId: 'run-v2', label: undefined }),
      fail({ traceId: 't3', spanId: 'root3', level: 'span', agentName: undefined }),
    ],
    spans
  );
  const breakdown = breakdownFailures(joined);

  it('counts failures per tool (once per tool of the trace), with their share', () => {
    expect(breakdown.total).toBe(5);
    expect(breakdown.dimensions.tool).toEqual([
      { key: 'search_flights', count: 3, share: 0.6 },
      { key: 'search_hotels', count: 3, share: 0.6 },
      { key: 'get_weather', count: 1, share: 0.2 },
      { key: NO_VALUE.tool, count: 1, share: 0.2 },
    ]);
  });

  it('counts failures per agent, operation, label and run', () => {
    expect(breakdown.dimensions.agent[0]).toEqual({ key: 'planner', count: 4, share: 0.8 });
    expect(breakdown.dimensions.agent[1].key).toBe('svc');
    expect(breakdown.dimensions.operation[0]).toMatchObject({ key: 'invoke_agent', count: 4 });
    expect(breakdown.dimensions.label.map((e) => e.key)).toEqual([
      'fail',
      'partial',
      NO_VALUE.label,
    ]);
    expect(breakdown.dimensions.run).toEqual([
      { key: 'run-v1', count: 3, share: 0.6 },
      { key: 'run-v2', count: 1, share: 0.2 },
    ]);
    expect(breakdown.joined).toBe(5);
  });

  it('names the strongest concentration', () => {
    expect(topConcentration(breakdown)).toEqual({
      dimension: 'agent',
      key: 'planner',
      count: 4,
      share: 0.8,
    });
  });

  it('ignores a dimension with a single value everywhere', () => {
    const only = breakdownFailures(
      joinFailures(
        [
          fail({ traceId: 't2', spanId: 'root2', agentName: 'planner' }),
          fail({ traceId: 't2', spanId: 'root2', agentName: 'planner' }),
        ],
        spans
      )
    );
    expect(topConcentration(only)).toBeUndefined();
    // With passing results of another agent, the same concentration is telling.
    const population = [makeResult({ agentName: 'other' }), makeResult({ agentName: 'planner' })];
    expect(topConcentration(only, population)).toMatchObject({ dimension: 'agent', share: 1 });
  });

  it('says all failures come from one run when the results span several runs', () => {
    const runs = breakdownFailures(
      joinFailures(
        [
          fail({ traceId: 'a', runId: 'run-v1', agentName: 'x' }),
          fail({ traceId: 'b', runId: 'run-v1', agentName: 'y' }),
        ],
        []
      )
    );
    const population = [makeResult({ runId: 'run-v1' }), makeResult({ runId: 'run-v2' })];
    expect(topConcentration(runs, population)).toMatchObject({ dimension: 'run', key: 'run-v1' });
  });
});

describe('failure lookups', () => {
  it('keeps the latest failing results only', () => {
    const results = [
      fail({ time: '2026-10-26 09:00:00' }),
      makeResult({ value: 1, time: '2026-10-26 10:00:00' }),
      fail({ time: '2026-10-26 11:00:00', id: 'newest' }),
    ];
    const latest = latestFailures(results, 1);
    expect(latest.map((r) => r.id)).toEqual(['newest']);
  });

  it('batches trace ids with their judged span ids', () => {
    const batches = spanLookupBatches(
      [
        fail({ traceId: 't1', spanId: 's1' }),
        fail({ traceId: 't1', spanId: 's2' }),
        fail({ traceId: 't2', spanId: undefined }),
        fail({ traceId: 't3', spanId: 's3' }),
      ],
      2
    );
    expect(batches).toEqual([
      { traceIds: ['t1', 't2'], spanIds: ['s1', 's2'] },
      { traceIds: ['t3'], spanIds: ['s3'] },
    ]);
  });

  it('reads agent, tool and judged spans of the traces with only the needed fields', () => {
    const q = buildFailureSpansQuery(['t1', "t'2"], ['s1']);
    expect(q).toContain("traceId = 't1' or traceId = 't\\'2'");
    expect(q).toContain("`attributes.gen_ai.operation.name` = 'execute_tool'");
    expect(q).toContain("spanId = 's1'");
    expect(q).toContain('| fields traceId, spanId, parentSpanId');
    expect(q.startsWith('source = otel-v1-apm-span-* |')).toBe(true);
    expect(
      buildFailureSpansQuery(['t1'], [], 10, 'agent-spans*').startsWith('source = agent-spans* |')
    ).toBe(true);
  });

  it('maps PPL rows with flattened attribute columns', () => {
    expect(
      recordToSpanFacts({
        traceId: 't',
        spanId: 's',
        parentSpanId: '',
        name: 'execute_tool x',
        'attributes.gen_ai.operation.name': 'execute_tool',
        'attributes.gen_ai.tool.name': 'x',
      })
    ).toMatchObject({ operation: 'execute_tool', toolName: 'x', parentSpanId: undefined });
  });
});
