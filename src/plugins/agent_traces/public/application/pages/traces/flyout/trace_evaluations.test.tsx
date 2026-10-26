/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvalResult, outcomeOf } from '../../../evaluations/eval_data';
import { EvalBadgeGroup, EvalResultItem, TraceEvaluationsTab } from './trace_evaluations';
import { groupTraceEvaluations } from './use_trace_evaluations';
import { indexRowEvaluations } from '../row_evaluations_context';

const result = (overrides: Partial<EvalResult>): EvalResult => {
  const base = {
    time: '2026-10-26 09:00:00',
    name: 'helpfulness',
    level: 'span',
    source: 'opensearch-sdk',
    evaluator: 'judge',
    traceId: 't1',
    spanId: 's1',
    ...overrides,
  };
  return {
    id: `${base.name}|${base.level}|${base.spanId}|${base.value}|${base.label}`,
    outcome: outcomeOf(base),
    ...base,
  } as EvalResult;
};

describe('groupTraceEvaluations', () => {
  it('splits session, trace and span results, failures first', () => {
    const results = [
      result({ name: 'ok_span', value: 0.9 }),
      result({ name: 'bad_span', value: 0.1 }),
      result({ name: 'trace_eval', level: 'trace', spanId: undefined, value: 4, scoreMax: 5 }),
      result({
        name: 'goal',
        level: 'session',
        traceId: undefined,
        spanId: undefined,
        sessionId: 'sess',
        label: 'Yes',
      }),
      result({
        name: 'other_session',
        level: 'session',
        traceId: undefined,
        spanId: undefined,
        sessionId: 'x',
      }),
    ];
    const grouped = groupTraceEvaluations(results, 't1', 'sess');
    expect(grouped.bySpanId.s1.map((r) => r.name)).toEqual(['bad_span', 'ok_span']);
    expect(grouped.traceResults.map((r) => r.name)).toEqual(['trace_eval']);
    expect(grouped.sessionResults.map((r) => r.name)).toEqual(['goal']);
  });

  it('treats a trace-level result that names a span as trace level', () => {
    const grouped = groupTraceEvaluations(
      [result({ name: 'agentcore_trace', level: 'trace', spanId: 's9', label: 'Pass' })],
      't1'
    );
    expect(grouped.traceResults).toHaveLength(1);
    expect(grouped.bySpanId).toEqual({});
  });
});

describe('indexRowEvaluations', () => {
  it('indexes by trace and by span for span-level results only', () => {
    const index = indexRowEvaluations(
      [
        result({ name: 'a' }),
        result({ name: 'b', level: 'tool_call', spanId: 's2' }),
        result({ name: 'c', level: 'trace', spanId: undefined }),
      ],
      'span'
    );
    expect(index.mode).toBe('span');
    expect(index.byTraceId.get('t1')?.map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(index.bySpanId.get('s1')?.map((r) => r.name)).toEqual(['a']);
    expect(index.bySpanId.get('s2')?.map((r) => r.name)).toEqual(['b']);
  });
});

describe('EvalBadgeGroup', () => {
  it('shows failures first, with the outcome in text, and collapses the rest', () => {
    render(
      <EvalBadgeGroup
        max={2}
        results={[
          result({ name: 'good', value: 1 }),
          result({ name: 'bad', label: 'fail' }),
          result({ name: 'meh', value: 0.6 }),
        ]}
      />
    );
    const badges = screen.getAllByTestId('agentTracesEvalBadge');
    expect(badges[0]).toHaveTextContent('bad: fail');
    expect(badges).toHaveLength(2);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('renders nothing without results', () => {
    const { container } = render(<EvalBadgeGroup results={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EvalResultItem', () => {
  it('shows the outcome word, score and an expandable explanation', () => {
    const long = 'x'.repeat(400);
    render(<EvalResultItem result={result({ label: 'correct', value: 5, explanation: long })} />);
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('correct (5)')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agentTracesEvalMore'));
    expect(screen.getByText(long, { exact: false })).toBeInTheDocument();
  });
});

describe('TraceEvaluationsTab', () => {
  const evals = (results: EvalResult[]) => ({
    ...groupTraceEvaluations(results, 't1', 'sess'),
    isLoading: false,
  });

  it('shows an empty state without results', () => {
    render(
      <TraceEvaluationsTab
        evals={evals([])}
        spanLabelOf={() => undefined}
        onSelectSpan={jest.fn()}
      />
    );
    expect(screen.getByText('No evaluations for this trace')).toBeInTheDocument();
  });

  it('selects the judged span from a span result', () => {
    const onSelectSpan = jest.fn();
    render(
      <TraceEvaluationsTab
        evals={evals([result({ name: 'faithfulness', value: 0.2 })])}
        spanLabelOf={(id) => (id === 's1' ? 'chat claude' : undefined)}
        onSelectSpan={onSelectSpan}
      />
    );
    fireEvent.click(screen.getByTestId('agentTracesEvalTarget'));
    expect(onSelectSpan).toHaveBeenCalledWith('s1');
  });

  it('shows a load error', () => {
    render(
      <TraceEvaluationsTab
        evals={{ ...evals([]), error: 'boom' }}
        spanLabelOf={() => undefined}
        onSelectSpan={jest.fn()}
      />
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
