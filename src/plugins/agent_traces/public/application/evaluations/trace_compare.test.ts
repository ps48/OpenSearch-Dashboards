/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TraceStep,
  alignSteps,
  compactText,
  spansToSteps,
  stepMarks,
  summarizeDiff,
  traceTotals,
} from './trace_compare';

let seq = 0;
const span = (
  partial: {
    op?: string;
    name?: string;
    parent?: string;
    agent?: string;
    model?: string;
    tool?: string;
    args?: string;
    result?: string;
    input?: number;
    output?: number;
    status?: number;
    durationMs?: number;
    events?: unknown[];
    id?: string;
  } = {}
) => {
  seq += 1;
  return {
    traceId: 't',
    spanId: partial.id ?? `s${seq}`,
    parentSpanId: partial.parent ?? '',
    name: partial.name ?? `${partial.op ?? 'span'} ${partial.tool ?? partial.agent ?? ''}`.trim(),
    startTime: `2026-10-27 22:32:${String(10 + seq).padStart(2, '0')}.000`,
    durationInNanos: (partial.durationMs ?? 100) * 1e6,
    status: { code: partial.status ?? 0 },
    events: partial.events ?? [],
    attributes: {
      'gen_ai.operation.name': partial.op,
      'gen_ai.agent.name': partial.agent,
      'gen_ai.request.model': partial.model,
      'gen_ai.tool.name': partial.tool,
      'gen_ai.tool.call.arguments': partial.args,
      'gen_ai.tool.call.result': partial.result,
      'gen_ai.usage.input_tokens': partial.input,
      'gen_ai.usage.output_tokens': partial.output,
    },
  };
};

const step = (partial: Partial<TraceStep>): TraceStep => ({
  spanId: `x${(seq += 1)}`,
  kind: 'tool',
  name: 'search_flights',
  startMs: seq,
  ...partial,
});

describe('spansToSteps', () => {
  it('lists agent, model and tool steps in start order and skips framework spans', () => {
    const rows = [
      span({ id: 'root', op: 'invoke_agent', agent: 'planner', input: 300, output: 30 }),
      span({ op: 'execute_event_loop_cycle', parent: 'root' }),
      span({ op: 'chat', model: 'haiku', parent: 'root', input: 100, output: 10 }),
      span({ op: 'execute_tool', tool: 'search_flights', args: '{"to": "Paris"}', parent: 'root' }),
    ];
    const steps = spansToSteps(rows);
    expect(steps.map((s) => [s.kind, s.name])).toEqual([
      ['agent', 'planner'],
      ['llm', 'haiku'],
      ['tool', 'search_flights'],
    ]);
    expect(steps[2].args).toBe('{"to":"Paris"}');
  });

  it('folds an agent span nested in an agent span of the same name', () => {
    const rows = [
      span({ id: 'outer', op: 'invoke_agent', agent: 'planner' }),
      span({ id: 'inner', op: 'invoke_agent', agent: 'planner', parent: 'outer', input: 50 }),
      span({ op: 'execute_tool', tool: 'get_weather', parent: 'inner' }),
    ];
    const steps = spansToSteps(rows);
    expect(steps.map((s) => s.kind)).toEqual(['agent', 'tool']);
    expect(steps[0].inputTokens).toBe(50);
  });

  it('reads tool arguments and results from span events when attributes are absent', () => {
    const rows = [
      span({
        op: 'execute_tool',
        tool: 'search_hotels',
        events: [
          { name: 'gen_ai.tool.message', attributes: { content: '{"city": "Sydney"}' } },
          { name: 'gen_ai.choice', attributes: { message: '[{"text": "1,491 AUD"}]' } },
        ],
      }),
    ];
    const [tool] = spansToSteps(rows);
    expect(tool.args).toBe('{"city":"Sydney"}');
    expect(tool.result).toBe('[{"text":"1,491 AUD"}]');
  });

  it('keeps failed spans of other operations and marks the error', () => {
    const rows = [
      span({ op: 'invoke_agent', agent: 'planner' }),
      span({ op: 'execute_event_loop_cycle', status: 2 }),
    ];
    const steps = spansToSteps(rows);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ kind: 'other', error: 'error' });
  });

  it('lists all spans of a trace without GenAI spans', () => {
    const steps = spansToSteps([span({ name: 'GET /api' }), span({ name: 'SELECT' })]);
    expect(steps.map((s) => s.name)).toEqual(['GET /api', 'SELECT']);
  });
});

describe('traceTotals', () => {
  it('sums model call tokens, counts calls and errors, and uses the root duration', () => {
    const rows = [
      span({
        id: 'root',
        op: 'invoke_agent',
        agent: 'a',
        input: 999,
        output: 999,
        durationMs: 5000,
      }),
      span({ op: 'chat', parent: 'root', input: 100, output: 10 }),
      span({ op: 'chat', parent: 'root', input: 200, output: 20 }),
      span({ op: 'execute_tool', tool: 't', parent: 'root', status: 2 }),
    ];
    const totals = traceTotals(spansToSteps(rows), rows);
    expect(totals).toMatchObject({
      steps: 4,
      llmCalls: 2,
      toolCalls: 1,
      inputTokens: 300,
      outputTokens: 30,
      tokens: 330,
      latencyMs: 5000,
      errors: 1,
    });
  });

  it('falls back to the agent tokens without model calls', () => {
    const rows = [span({ op: 'invoke_agent', agent: 'a', input: 40, output: 2 })];
    expect(traceTotals(spansToSteps(rows), rows).tokens).toBe(42);
  });
});

describe('alignSteps', () => {
  const agent = step({ kind: 'agent', name: 'planner' });
  const llm = (model = 'haiku') => step({ kind: 'llm', name: model, model });

  it('matches identical steps', () => {
    const a = [agent, llm(), step({ args: '{"a":1,"b":2}' })];
    const b = [agent, llm(), step({ args: '{"b": 2, "a": 1}' })];
    expect(alignSteps(a, b).map((r) => r.diff)).toEqual(['same', 'same', 'same']);
  });

  it('flags other arguments for the same tool', () => {
    const rows = alignSteps([step({ args: '{"to":"Paris"}' })], [step({ args: '{"to":"Rome"}' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].diff).toBe('args');
  });

  it('reports a tool called in one trace only as an extra step', () => {
    const a = [agent, llm(), step({ name: 'search_flights' }), llm()];
    const b = [agent, llm(), step({ name: 'search_flights' }), step({ name: 'convert' }), llm()];
    const rows = alignSteps(a, b);
    expect(rows.map((r) => r.diff)).toEqual(['same', 'same', 'same', 'candidate_only', 'same']);
    expect(rows[3].candidate?.name).toBe('convert');
    const missing = alignSteps(b, a);
    expect(missing[3]).toMatchObject({ diff: 'baseline_only' });
  });

  it('pairs a different tool at the same position', () => {
    const rows = alignSteps(
      [agent, step({ name: 'search_hotels' }), llm()],
      [agent, step({ name: 'get_weather' }), llm()]
    );
    expect(rows.map((r) => r.diff)).toEqual(['same', 'changed', 'same']);
  });

  it('flags another model and errors', () => {
    expect(alignSteps([llm('haiku')], [llm('sonnet')])[0].diff).toBe('changed');
    expect(alignSteps([step({})], [step({ error: 'Timeout' })])[0].diff).toBe('error');
  });

  it('keeps the order with extra steps at the end', () => {
    const rows = alignSteps([agent], [agent, llm(), step({})]);
    expect(rows.map((r) => r.diff)).toEqual(['same', 'candidate_only', 'candidate_only']);
  });
});

describe('summarizeDiff', () => {
  it('lists tools used by one trace only and counts differences', () => {
    const a = [step({ name: 'search_flights' }), step({ name: 'search_hotels' })];
    const b = [step({ name: 'search_flights', args: '{"x":1}' }), step({ name: 'convert' })];
    const summary = summarizeDiff(alignSteps(a, b), a, b);
    expect(summary.toolsOnlyInBaseline).toEqual(['search_hotels']);
    expect(summary.toolsOnlyInCandidate).toEqual(['convert']);
    expect(summary.counts.args).toBe(1);
    expect(summary.counts.changed).toBe(1);
  });
});

describe('compactText', () => {
  it('re-serializes JSON compactly and truncates long text', () => {
    expect(compactText('{ "a": 1 }')).toBe('{"a":1}');
    expect(compactText({ b: [1, 2] })).toBe('{"b":[1,2]}');
    expect(compactText('x'.repeat(50), 10)).toBe('xxxxxxx...');
    expect(compactText('')).toBeUndefined();
  });
});

describe('stepMarks', () => {
  it("marks each side's step spans with their row and difference", () => {
    const a = step({ spanId: 'a1', name: 'get_weather' });
    const b = step({ spanId: 'b1', name: 'get_weather' });
    const extra = step({ spanId: 'b2', name: 'search_hotels' });
    const marks = stepMarks(alignSteps([a], [b, extra]));
    expect(marks.baseline.get('a1')).toEqual({ diff: 'same', index: 0 });
    expect(marks.candidate.get('b1')).toEqual({ diff: 'same', index: 0 });
    expect(marks.candidate.get('b2')).toEqual({ diff: 'candidate_only', index: 1 });
    expect(marks.baseline.has('b2')).toBe(false);
  });
});
