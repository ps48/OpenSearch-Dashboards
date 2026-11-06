/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { CaseLog, caseLogOf } from './case_log';
import { fakePpl, renderWithContext } from './eval_test_utils';
import { buildTraceSpansQuery } from './eval_ppl';

const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined]) => mockPpl.hook(...args),
}));

const msg = (role: string, ...parts: Array<Record<string, unknown>>) => ({ role, parts });
const text = (content: string) => ({ type: 'text', content });
const user = msg('user', text('Book a flight to Paris'));
const call = msg('assistant', {
  type: 'tool_call',
  id: 'call_1',
  name: 'search_flights',
  arguments: { to: 'CDG' },
});
const response = msg('tool', { type: 'tool_call_response', id: 'call_1', response: 'AF123' });
const answer = msg('assistant', text('Booked AF123.'));

/** An agent root, two model calls (the second repeats the history) and the tool span. */
const ROWS = [
  {
    traceId: 't1',
    name: 'invoke_agent travel',
    startTime: '2026-10-28 07:00:00',
    durationInNanos: 4000 * 1e6,
    attributes: {
      gen_ai: {
        input: { messages: JSON.stringify([user]) },
        output: { messages: JSON.stringify([answer]) },
      },
    },
  },
  {
    traceId: 't1',
    name: 'chat',
    startTime: '2026-10-28 07:00:00.1',
    durationInNanos: 900 * 1e6,
    attributes: {
      gen_ai: {
        system_instructions: JSON.stringify([{ type: 'text', content: 'You are a travel agent.' }]),
        input: { messages: JSON.stringify([user]) },
        output: { messages: JSON.stringify([call]) },
      },
    },
  },
  {
    traceId: 't1',
    name: 'execute_tool search_flights',
    startTime: '2026-10-28 07:00:01',
    durationInNanos: 500 * 1e6,
    attributes: {
      gen_ai: {
        tool: {
          name: 'search_flights',
          call: { id: 'call_1', arguments: '{"to":"CDG"}', result: 'AF123' },
        },
      },
    },
  },
  {
    traceId: 't1',
    name: 'chat',
    startTime: '2026-10-28 07:00:02',
    durationInNanos: 1000 * 1e6,
    attributes: {
      gen_ai: {
        input: { messages: JSON.stringify([user, call, response]) },
        output: { messages: JSON.stringify([answer]) },
      },
    },
  },
];

describe('caseLogOf', () => {
  it('orders system, user, tool call, tool result and the answer, each once', () => {
    expect(caseLogOf(ROWS).map((e) => [e.role, e.type, e.text ?? e.name])).toEqual([
      ['system', 'text', 'You are a travel agent.'],
      ['user', 'text', 'Book a flight to Paris'],
      ['assistant', 'tool_call', 'search_flights'],
      ['tool', 'tool_result', 'search_flights'],
      ['assistant', 'text', 'Booked AF123.'],
    ]);
    expect(caseLogOf(ROWS)[2].value).toEqual({ to: 'CDG' });
  });

  it('reads tool spans when no model call recorded messages', () => {
    const log = caseLogOf([ROWS[2]]);
    expect(log.map((e) => [e.type, e.value])).toEqual([
      ['tool_call', '{"to":"CDG"}'],
      ['tool_result', 'AF123'],
    ]);
  });

  it('is empty without messages or tool calls', () => {
    expect(caseLogOf([{ name: 'x', startTime: '2026-10-28 07:00:00' }])).toEqual([]);
  });
});

describe('CaseLog', () => {
  beforeEach(() => mockPpl.reset());

  it('reads the trace spans once and shows the messages, Formatted or JSON', () => {
    mockPpl.answer(() => ROWS);
    renderWithContext(<CaseLog traceId="t1" caseId="c1" />);
    expect(mockPpl.queries).toEqual([buildTraceSpansQuery('spans-*', ['t1'])]);
    const log = screen.getByTestId('agtEvlCaseLog-c1');
    expect(log).toHaveTextContent('5 steps from 4 spans');
    expect(log).toHaveTextContent('System');
    expect(log).toHaveTextContent('Tool call: search_flights');
    expect(log).toHaveTextContent('"to": "CDG"');
    expect(log).toHaveTextContent('Tool result: search_flights');
    expect(log).toHaveTextContent('Booked AF123.');
    fireEvent.click(
      screen.getByTestId('agentTracesMessageViewJson').querySelector('input') as HTMLElement
    );
    expect(screen.getByTestId('agtEvlCaseLogJson')).toHaveTextContent('"type": "tool_call"');
  });

  it('says so when the trace has no messages', () => {
    mockPpl.answer(() => [{ name: 'x' }]);
    renderWithContext(<CaseLog traceId="t1" caseId="c1" />);
    expect(screen.getByTestId('agtEvlCaseLogEmpty')).toBeInTheDocument();
  });
});
