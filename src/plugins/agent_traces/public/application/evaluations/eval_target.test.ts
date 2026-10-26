/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildSessionSpansQuery,
  buildSpanQuery,
  fetchJudgedTarget,
  pickAgentSpan,
  pickSessionTraces,
  recordToTargetSpan,
  unwrapJsonString,
} from './eval_target';
import { makeResult } from './eval_test_fixtures';

const span = (overrides: Record<string, unknown>) => ({
  traceId: 't1',
  spanId: 's',
  parentSpanId: '',
  name: 'span',
  startTime: '2026-10-26 09:00:00.000',
  durationInNanos: 2_000_000,
  serviceName: 'svc',
  status: { code: 0 },
  attributes: {},
  ...overrides,
});

const root = span({ spanId: 'root', name: 'POST /chat' });
const agent = span({
  spanId: 'agent',
  parentSpanId: 'root',
  name: 'invoke_agent Travel',
  startTime: '2026-10-26 09:00:00.010',
  attributes: {
    gen_ai: {
      operation: { name: 'invoke_agent' },
      agent: { name: 'Travel' },
      input: { messages: '[{"role":"user","parts":[{"type":"text","content":"hi"}]}]' },
    },
  },
});
const chat = span({
  spanId: 'chat',
  parentSpanId: 'agent',
  name: 'chat',
  startTime: '2026-10-26 09:00:00.020',
  attributes: { gen_ai: { operation: { name: 'chat' } } },
});

describe('pickAgentSpan', () => {
  it('prefers the outermost agent invocation and reports the root', () => {
    const { span: picked, root: r } = pickAgentSpan([root, chat, agent]);
    expect(picked?.spanId).toBe('agent');
    expect(picked?.agentName).toBe('Travel');
    expect(picked?.operation).toBe('invoke_agent');
    expect(picked?.durationMs).toBe(2);
    expect(r?.spanId).toBe('root');
  });
  it('falls back to the root span', () => {
    const { span: picked, root: r } = pickAgentSpan([root]);
    expect(picked?.spanId).toBe('root');
    expect(r).toBeUndefined();
  });
});

describe('recordToTargetSpan', () => {
  it('names the status code and unwraps JSON-encoded string messages', () => {
    const s = recordToTargetSpan(
      span({
        status: { code: 0 },
        attributes: { 'gen_ai.output.messages': '"line one\\nline two"' },
      })
    );
    expect(s.status).toBe('unset');
    expect(s.output).toBe('line one\nline two');
    expect(unwrapJsonString('{"message":"hi"}')).toBe('{"message":"hi"}');
    expect(unwrapJsonString('"broken')).toBe('"broken');
  });
});

describe('pickSessionTraces', () => {
  it('returns one span per trace, earliest first', () => {
    const later = span({ traceId: 't2', spanId: 'x', startTime: '2026-10-26 10:00:00.000' });
    const traces = pickSessionTraces([later, root, agent]);
    expect(traces.map((t) => t.traceId)).toEqual(['t1', 't2']);
    expect(traces[0].spanId).toBe('agent');
  });
});

describe('fetchJudgedTarget', () => {
  const runner = (rows: unknown[]) => {
    const executeQuery = jest.fn().mockResolvedValue({
      schema: rows.length ? Object.keys(rows[0] as object).map((name) => ({ name })) : [],
      datarows: rows.map((r) => Object.values(r as object)),
    });
    return { executeQuery };
  };

  it('reads the judged span for span results', async () => {
    const ppl = runner([agent]);
    const target = await fetchJudgedTarget(
      ppl,
      makeResult({ level: 'span', traceId: 't1', spanId: 'agent' })
    );
    expect(ppl.executeQuery.mock.calls[0][1]).toBe(buildSpanQuery('t1', 'agent'));
    expect(target.span?.input).toContain('"role":"user"');
  });

  it('reads the trace for trace results and picks its agent span', async () => {
    const ppl = runner([root, agent, chat]);
    const target = await fetchJudgedTarget(
      ppl,
      makeResult({ level: 'trace', traceId: 't1', spanId: undefined })
    );
    expect(ppl.executeQuery.mock.calls[0][1]).toContain("where traceId = 't1' | sort startTime");
    expect(target.span?.spanId).toBe('agent');
    expect(target.root?.spanId).toBe('root');
  });

  it('reads the session traces for session results', async () => {
    const ppl = runner([agent]);
    const target = await fetchJudgedTarget(
      ppl,
      makeResult({ level: 'session', sessionId: 'sess', traceId: undefined })
    );
    expect(ppl.executeQuery.mock.calls[0][1]).toBe(buildSessionSpansQuery('sess'));
    expect(target.traces).toHaveLength(1);
  });

  it('returns an empty target without ids', async () => {
    const ppl = runner([]);
    const target = await fetchJudgedTarget(
      ppl,
      makeResult({ level: 'trace', traceId: undefined, spanId: undefined })
    );
    expect(target).toEqual({ level: 'trace' });
    expect(ppl.executeQuery).not.toHaveBeenCalled();
  });
});
