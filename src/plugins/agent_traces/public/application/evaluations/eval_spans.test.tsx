/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderHook } from '@testing-library/react';
import { EvalContext } from './eval_context';
import { fakePpl, testContext } from './eval_test_utils';
import {
  aiRootSpanOf,
  sessionTurnsOf,
  spanIOOf,
  useJudgedSpans,
  useSessionTurns,
} from './eval_spans';
import { resetAiRootFieldChecks, setAiRootFieldPresent } from '../utils/ai_root';
import {
  buildAiRootCandidatesQuery,
  buildResultSpansQuery,
  buildSessionRootsQuery,
} from './ppl_queries';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined, unknown]) => mockPpl.hook(...args),
}));

const ctx = testContext();
const wrapper: React.FC = ({ children }) => (
  <EvalContext.Provider value={ctx}>{children}</EvalContext.Provider>
);

const messages = (role: string, text: string) =>
  JSON.stringify([{ role, parts: [{ type: 'text', content: text }] }]);

describe('spanIOOf', () => {
  it('reads the GenAI messages of a span', () => {
    const io = spanIOOf({
      traceId: 't1',
      name: 'invoke_agent',
      attributes: {
        gen_ai: {
          input: { messages: messages('user', 'Capital of France?') },
          output: { messages: messages('assistant', 'Paris') },
        },
      },
    });
    expect(io.traceId).toBe('t1');
    expect(io.name).toBe('invoke_agent');
    expect(io.input).toContain('Capital of France?');
    expect(io.output).toContain('Paris');
  });

  it('on an execute_tool span, the tool arguments and result come before tool_call messages', () => {
    const io = spanIOOf({
      name: 'execute_tool search_flights',
      attributes: {
        gen_ai: {
          operation: { name: 'execute_tool' },
          input: {
            messages: JSON.stringify([
              { role: 'assistant', parts: [{ type: 'tool_call', name: 'search_flights' }] },
            ]),
          },
          tool: { call: { arguments: '{"to":"CDG"}', result: '3 flights' } },
        },
      },
    });
    expect(io.input).toBe('{"to":"CDG"}');
    expect(io.output).toBe('3 flights');
    expect(io.rawInput).toBe('{"to":"CDG"}');
    expect(io.rawOutput).toBe('3 flights');
  });

  it('falls back to the tool call arguments and result', () => {
    const io = spanIOOf({
      attributes: { gen_ai: { tool: { call: { arguments: '{"q":1}', result: '42' } } } },
    });
    expect(io.rawInput).toBe('{"q":1}');
    expect(io.rawOutput).toBe('42');
  });
});

describe('span hooks', () => {
  beforeEach(() => mockPpl.reset());

  const span = (traceId: string, spanId: string, extra: Record<string, unknown> = {}) => ({
    traceId,
    spanId,
    parentSpanId: '',
    ...extra,
  });

  it('useJudgedSpans: the spans results point to, in one query, keyed by trace', () => {
    mockPpl.answer(() => [
      span('a', 'sa', {
        attributes: { gen_ai: { output: { messages: messages('assistant', 'A') } } },
      }),
      span('b', 'sb'),
    ]);
    const { result } = renderHook(
      () =>
        useJudgedSpans([
          { traceId: 'a', spanId: 'sa' },
          { traceId: 'b', spanId: 'sb' },
          { traceId: 'a', spanId: 'sa' },
        ]),
      { wrapper }
    );
    expect(mockPpl.queries).toEqual([
      buildResultSpansQuery('spans-*', [
        { traceId: 'a', spanId: 'sa' },
        { traceId: 'b', spanId: 'sb' },
      ]),
    ]);
    expect(mockPpl.ranges.get(mockPpl.queries[0])).toBeUndefined();
    expect([...result.current.byTrace.keys()]).toEqual(['a', 'b']);
    expect(result.current.byTrace.get('a')?.output).toContain('A');
    expect(result.current.loaded).toBe(true);
  });

  it('useJudgedSpans: without a span id, the AI root of the trace (not an HTTP root)', () => {
    mockPpl.answer((q) =>
      q === buildAiRootCandidatesQuery('spans-*', 't1')
        ? [
            span('t1', 'http', { name: 'POST /invocations' }),
            {
              traceId: 't1',
              spanId: 'agent',
              parentSpanId: 'http',
              name: 'invoke_agent travel_planner',
              attributes: {
                gen_ai: {
                  operation: { name: 'invoke_agent' },
                  input: { messages: messages('user', 'Plan a trip') },
                },
              },
            },
          ]
        : []
    );
    const { result } = renderHook(() => useJudgedSpans([{ traceId: 't1' }]), { wrapper });
    expect(mockPpl.queries).toEqual([buildAiRootCandidatesQuery('spans-*', 't1')]);
    expect(result.current.byTrace.get('t1')?.name).toBe('invoke_agent travel_planner');
    expect(result.current.byTrace.get('t1')?.input).toContain('Plan a trip');
  });

  it('aiRootSpanOf: a GenAI or marked root, else the earliest marked span, else the earliest GenAI span, else the root', () => {
    const genAi = { attributes: { gen_ai: { operation: { name: 'chat' } } } };
    const marked = { attributes: { 'derived.gen_ai.is_root': true } };
    const http = span('t', 'http');
    const child = (spanId: string, extra: Record<string, unknown>) => ({
      traceId: 't',
      spanId,
      parentSpanId: 'http',
      ...extra,
    });
    expect(aiRootSpanOf([span('t', 'root', genAi), child('c', genAi)])?.spanId).toBe('root');
    expect(aiRootSpanOf([http, child('c1', genAi), child('m', marked)])?.spanId).toBe('m');
    expect(aiRootSpanOf([http, child('c1', genAi), child('c2', genAi)])?.spanId).toBe('c1');
    expect(aiRootSpanOf([http])?.spanId).toBe('http');
    expect(aiRootSpanOf([])).toBeUndefined();
  });

  it('runs nothing without ids', () => {
    renderHook(() => useJudgedSpans([{ traceId: undefined, spanId: 's' }]), { wrapper });
    renderHook(() => useJudgedSpans([]), { wrapper });
    renderHook(() => useSessionTurns(undefined), { wrapper });
    expect(mockPpl.queries).toEqual([]);
  });

  it('useSessionTurns reads the turns of a session', () => {
    mockPpl.answer(() => [{ traceId: 't1' }, { traceId: 't2' }]);
    const turns = renderHook(() => useSessionTurns('conv-1'), { wrapper });
    expect(mockPpl.queries).toContain(buildSessionRootsQuery('spans-*', 'conv-1'));
    expect(turns.result.current.turns.map((t) => t.traceId)).toEqual(['t1', 't2']);
  });

  it('useSessionTurns names the marker once the span index is known to map it', () => {
    setAiRootFieldPresent(ctx.spans.id ?? '', true);
    try {
      mockPpl.answer(() => []);
      renderHook(() => useSessionTurns('conv-1'), { wrapper });
      expect(mockPpl.queries).toContain(buildSessionRootsQuery('spans-*', 'conv-1', true));
    } finally {
      resetAiRootFieldChecks();
    }
  });

  it('sessionTurnsOf keeps one span per trace by the AI-root rule, oldest first', () => {
    const OP = 'attributes.gen_ai.operation.name';
    const MARK = 'attributes.derived.gen_ai.is_root';
    const rows = [
      // Trace a: a GenAI root and a marked child: the root wins.
      {
        traceId: 'a',
        spanId: 'a1',
        parentSpanId: '',
        startTime: '2026-11-01 10:00:00',
        [OP]: 'invoke_agent',
      },
      {
        traceId: 'a',
        spanId: 'a2',
        parentSpanId: 'a1',
        startTime: '2026-11-01 10:00:01',
        [MARK]: true,
      },
      // Trace b: an agent behind an HTTP handler: two marked spans, the earliest wins.
      {
        traceId: 'b',
        spanId: 'b2',
        parentSpanId: 'h',
        startTime: '2026-11-01 09:00:02',
        [MARK]: true,
      },
      {
        traceId: 'b',
        spanId: 'b3',
        parentSpanId: 'h',
        startTime: '2026-11-01 09:00:05',
        [MARK]: 'true',
      },
    ];
    expect(sessionTurnsOf(rows).map((r) => r.spanId)).toEqual(['b2', 'a1']);
  });
});
