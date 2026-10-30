/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EvalResult, outcomeOf } from '../../../evaluations/eval_data';
import {
  EvalHeaderSummary,
  EvalResultItem,
  EvalSummaryCell,
  SpanEvalMark,
  TraceEvaluationsTab,
  evaluationsLogsUrl,
  failingSpanIds,
  flowEvalDecoration,
  proseOf,
  resultInEvaluationsPath,
  scoreOnScale,
} from './trace_evaluations';
import { judgeSummaryText } from '../../../evaluations/eval_judge_icon';
import { resetEvalsDatasetState } from '../../../evaluations/eval_dataset';
import { groupTraceEvaluations } from './use_trace_evaluations';
import { indexRowEvaluations, rowResults } from '../row_evaluations_context';

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
    // A span result of another trace in the session is not this trace's.
    const withOther = groupTraceEvaluations(
      [...results, result({ name: 'elsewhere', traceId: 't2', spanId: 's7' })],
      't1',
      'sess'
    );
    expect(withOther.results.map((r) => r.name)).not.toContain('elsewhere');
    expect(withOther.results).toHaveLength(4);
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

describe('rowResults', () => {
  const results = [
    result({ name: 'case_a', spanId: 'caseA' }),
    result({ name: 'case_b', spanId: 'caseB' }),
    result({ name: 'whole_run', level: 'trace', spanId: undefined }),
  ];
  it('shows all of a trace with one agent run', () => {
    const value = { ...indexRowEvaluations(results), rowsByTraceId: new Map([['t1', 1]]) };
    expect(
      rowResults(value, { traceId: 't1', spanId: 'agentA', parentSpanId: 'caseA' })
    ).toHaveLength(3);
  });
  it('shows only its own run when a trace holds several', () => {
    const value = { ...indexRowEvaluations(results), rowsByTraceId: new Map([['t1', 2]]) };
    expect(
      rowResults(value, { traceId: 't1', spanId: 'agentA', parentSpanId: 'caseA' }).map(
        (r) => r.name
      )
    ).toEqual(['case_a', 'whole_run']);
  });
});

describe('EvalSummaryCell', () => {
  const cellResults = [
    result({ name: 'good', assessment: 'pass' }),
    result({ name: 'bad', assessment: 'fail', explanation: 'Wrong tool.\nMore detail' }),
    result({ name: 'meh', value: 0.6 }),
    result({ name: 'good2', assessment: 'pass' }),
  ];

  it('shows one judge pill, red with the failing count when something failed', () => {
    render(<EvalSummaryCell results={cellResults} />);
    const chip = screen.getByTestId('agentTracesEvalSummary');
    expect(chip).toHaveTextContent('1 failing of 4');
    expect(chip).toHaveClass('agtEvlJudgePill--fail');
    expect(screen.getByTestId('agtEvlJudgeIcon')).toBeInTheDocument();
  });

  it('is green and says passing when every result passed', () => {
    render(
      <EvalSummaryCell
        results={[
          result({ name: 'a', assessment: 'pass' }),
          result({ name: 'b', assessment: 'pass' }),
        ]}
      />
    );
    const chip = screen.getByTestId('agentTracesEvalSummary');
    expect(chip).toHaveTextContent('2 passing');
    expect(chip).toHaveClass('agtEvlJudgePill--pass');
  });

  it('lists every result failures first, with the first explanation line, and opens the trace', () => {
    const onOpen = jest.fn();
    render(<EvalSummaryCell results={cellResults} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('agentTracesEvalSummary'));
    const items = screen.getAllByTestId('agentTracesEvalListItem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('bad');
    expect(items[0]).toHaveTextContent('Wrong tool.');
    expect(items[0]).not.toHaveTextContent('More detail');
    fireEvent.click(screen.getAllByTestId('agentTracesEvalListOpen')[0]);
    expect(onOpen).toHaveBeenCalled();
  });

  it('renders nothing without results', () => {
    const { container } = render(<EvalSummaryCell results={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EvalHeaderSummary and SpanEvalMark', () => {
  it('counts failed, passed and scored results and opens the tab', () => {
    const onClick = jest.fn();
    render(
      <EvalHeaderSummary
        results={[
          result({ name: 'a', assessment: 'fail' }),
          result({ name: 'b', assessment: 'pass' }),
          result({ name: 'c', value: 3 }),
        ]}
        onClick={onClick}
      />
    );
    const tally = screen.getByTestId('agentTracesFlyoutEvalSummary');
    expect(tally).toHaveTextContent('1 FAILED1 PASSED1 SCORED');
    expect(screen.queryByTestId('agentTracesFlyoutEvalTally-error')).toBeNull();
    fireEvent.click(screen.getByTestId('agentTracesFlyoutEvalTally-pass'));
    expect(onClick).toHaveBeenCalled();
  });

  it('toggles the failing-span filter from the FAILED chip', () => {
    const onClick = jest.fn();
    const onToggle = jest.fn();
    const results = [
      result({ name: 'a', assessment: 'fail' }),
      result({ name: 'b', errorType: 'Boom' }),
    ];
    const { rerender } = render(
      <EvalHeaderSummary results={results} onClick={onClick} onToggleFailFilter={onToggle} />
    );
    const failed = screen.getByTestId('agentTracesFlyoutEvalTally-fail');
    expect(failed).toHaveTextContent('1 FAILED');
    expect(failed).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('agentTracesFlyoutEvalTally-error')).toHaveTextContent('1 ERRORED');
    fireEvent.click(failed);
    expect(onToggle).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    rerender(
      <EvalHeaderSummary
        results={results}
        onClick={onClick}
        onToggleFailFilter={onToggle}
        activeFilter="fail"
      />
    );
    expect(screen.getByTestId('agentTracesFlyoutEvalTally-fail')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('agentTracesFlyoutEvalTally-fail')).toHaveClass(
      'agtEvlTally--active'
    );
  });

  it('marks a span with its count and a red dot when one failed', () => {
    render(<SpanEvalMark results={[result({ assessment: 'fail' }), result({ value: 1 })]} />);
    const mark = screen.getByTestId('agentTracesSpanEvalMark');
    expect(mark).toHaveTextContent('1/2');
    expect(mark).toHaveAttribute('data-failed', 'true');
    expect(mark).toHaveClass('agtEvlSpanMark--fail');
    expect(screen.getByTestId('agtEvlJudgeIcon')).toBeInTheDocument();
  });
});

describe('EvalResultItem', () => {
  it('shows the outcome word, score and an expandable explanation', () => {
    const long = 'x'.repeat(400);
    render(
      <EvalResultItem
        result={result({ label: 'correct', value: 5, assessment: 'pass', explanation: long })}
      />
    );
    expect(screen.getByTestId('agentTracesEvalVerdict')).toHaveTextContent('correct (5) · Pass');
    expect(screen.getByTestId('agentTracesEvalItem')).not.toHaveClass('euiPanel');
    fireEvent.click(screen.getByTestId('agentTracesEvalMore'));
    expect(screen.getByText(long, { exact: false })).toBeInTheDocument();
  });

  it('shows the score on its scale and the explanation as prose', () => {
    render(
      <EvalResultItem
        result={result({
          value: 1,
          scoreMax: 5,
          threshold: 4,
          explanation: 'Did not call search_flights.\\nRefused instead.',
        })}
        targetLabel="invoke_agent travel_planner"
      />
    );
    expect(screen.getByTestId('agentTracesEvalVerdict')).toHaveTextContent('1 / 5 · Fail');
    expect(screen.getByTestId('agentTracesEvalExplanation').textContent).toContain(
      'Did not call search_flights.\nRefused instead.'
    );
    expect(screen.getByTestId('agentTracesEvalExplanation').textContent).not.toContain('\\n');
    expect(screen.getByText('invoke_agent travel_planner')).toBeInTheDocument();
  });
});

describe('score and link helpers', () => {
  it('formats scores on their scale', () => {
    expect(scoreOnScale(result({ value: 1, scoreMax: 5 }))).toBe('1 / 5');
    expect(scoreOnScale(result({ value: 0.5, scoreMax: 1 }))).toBe('0.50');
    expect(scoreOnScale(result({ label: 'correct' }))).toBe('correct');
  });

  it('turns literal newlines into line breaks', () => {
    expect(proseOf('a\\nb\\r\\nc')).toBe('a\nb\nc');
  });

  it('links a result to the Evaluations Results tab around its time', () => {
    const path = resultInEvaluationsPath({ id: "t|s|it's", time: '2026-10-28 14:56:00' });
    expect(path).toContain('tab:results');
    expect(path).toContain("result:'");
    expect(path).toContain('2026-10-28T13:56:00.000Z');
    expect(path).toContain(encodeURIComponent("t|s|it!'s"));
  });

  it('words the judge pill', () => {
    expect(judgeSummaryText({ pass: 2, fail: 1, error: 0, neutral: 1 })).toBe('1 failing of 4');
    expect(judgeSummaryText({ pass: 3, fail: 0, error: 0, neutral: 0 })).toBe('3 passing');
    expect(judgeSummaryText({ pass: 0, fail: 0, error: 0, neutral: 2 })).toBe('2 scored');
  });
});

describe('Trace Map decoration', () => {
  it('banners failing nodes with the failing names', () => {
    const decoration = flowEvalDecoration([
      result({ name: 'answer_quality', assessment: 'fail' }),
      result({ name: 'tool_selection', assessment: 'fail' }),
      result({ name: 'latency', assessment: 'pass' }),
    ]);
    expect(decoration?.className).toContain('agtEvlFlowNode--fail');
    render(<>{decoration?.badge}</>);
    expect(screen.getByTestId('agentTracesFlowEvalBanner')).toHaveTextContent(
      '2 failing evaluations · answer_quality, tool_selection'
    );
  });

  it('marks passing nodes with a green pill and leaves unjudged ones alone', () => {
    const decoration = flowEvalDecoration([result({ assessment: 'pass' })]);
    expect(decoration?.className).not.toContain('--fail');
    render(<>{decoration?.badge}</>);
    expect(screen.getByTestId('agentTracesFlowEvalMark')).toHaveClass('agtEvlJudgePill--pass');
    expect(flowEvalDecoration(undefined)).toBeUndefined();
    expect(flowEvalDecoration([])).toBeUndefined();
  });

  it('lists the spans with a failing result', () => {
    expect(
      Array.from(
        failingSpanIds({
          s1: [result({ assessment: 'fail' })],
          s2: [result({ assessment: 'pass', spanId: 's2' })],
        })
      )
    ).toEqual(['s1']);
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

describe('View in Logs', () => {
  const config = {
    configId: 'cfg',
    tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*' },
    evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*', timeFieldName: 'time' },
    index: 'otel-v1-genai-evaluation*',
  };
  afterEach(() => resetEvalsDatasetState());

  it('opens Explore Logs on the evaluations dataset, filtered to the trace', () => {
    const url = evaluationsLogsUrl(config.evaluationsDataset, 'abc123', [
      { time: '2026-10-26 09:00:00' },
      { time: '2026-10-26 10:00:00' },
    ]);
    expect(url).toContain('/app/explore/logs/#/');
    expect(url).toContain("id:'ev'");
    expect(url).toContain("title:'otel-v1-genai-evaluation*'");
    expect(url).toContain("timeFieldName:'time'");
    expect(url).toContain("language:PPL,query:'%7C%20where%20traceId%20%3D%20!'abc123!''");
    expect(url).toContain("time:(from:'2026-10-26T08:00:00.000Z',to:'2026-10-26T11:00:00.000Z')");
  });

  it('shows the link in the Evaluations tab only with an evaluations dataset', () => {
    const tab = (
      <TraceEvaluationsTab
        evals={{ ...groupTraceEvaluations([], 't1'), isLoading: false }}
        traceId="t1"
        spanLabelOf={() => undefined}
        onSelectSpan={jest.fn()}
      />
    );
    const { rerender } = render(tab);
    expect(screen.queryByTestId('agtEvlViewInLogs')).not.toBeInTheDocument();
    act(() => resetEvalsDatasetState({ status: 'ready', config }));
    rerender(tab);
    expect(screen.getByTestId('agtEvlViewInLogs')).toHaveTextContent('View in Logs');
    expect(screen.getByTestId('agtEvlViewInLogs').getAttribute('href')).toContain("!'t1!'");
  });
});
