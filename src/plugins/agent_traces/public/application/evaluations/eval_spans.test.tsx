/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderHook } from '@testing-library/react';
import { EvalContext } from './eval_context';
import { fakePpl, testContext } from './eval_test_utils';
import { spanIOOf, useRootSpans, useSessionTurns, useSpan } from './eval_spans';
import { buildRootSpansQuery, buildSessionRootsQuery, buildSpanQuery } from './eval_ppl';

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

  it('useRootSpans: one query for the distinct ids, keyed by trace, without a time bound', () => {
    mockPpl.answer(() => [
      {
        traceId: 'a',
        attributes: { gen_ai: { output: { messages: messages('assistant', 'A') } } },
      },
      { traceId: 'b' },
    ]);
    const { result } = renderHook(() => useRootSpans(['a', undefined, 'b', 'a']), { wrapper });
    expect(mockPpl.queries).toEqual([buildRootSpansQuery('spans-*', ['a', 'b'])]);
    expect(mockPpl.ranges.get(mockPpl.queries[0])).toBeUndefined();
    expect([...result.current.byTrace.keys()]).toEqual(['a', 'b']);
    expect(result.current.byTrace.get('a')?.output).toContain('A');
  });

  it('runs nothing without ids', () => {
    renderHook(() => useRootSpans([undefined]), { wrapper });
    renderHook(() => useSpan('t', undefined), { wrapper });
    renderHook(() => useSessionTurns(undefined), { wrapper });
    expect(mockPpl.queries).toEqual([]);
  });

  it('useSpan and useSessionTurns read one span and the turns of a session', () => {
    mockPpl.answer(() => [{ traceId: 't1' }, { traceId: 't2' }]);
    const span = renderHook(() => useSpan('t1', 's1'), { wrapper });
    expect(mockPpl.queries).toContain(buildSpanQuery('spans-*', 't1', 's1'));
    expect(span.result.current.span?.traceId).toBe('t1');
    const turns = renderHook(() => useSessionTurns('conv-1'), { wrapper });
    expect(mockPpl.queries).toContain(buildSessionRootsQuery('spans-*', 'conv-1'));
    expect(turns.result.current.turns.map((t) => t.traceId)).toEqual(['t1', 't2']);
  });
});
