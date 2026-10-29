/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  EvalTraceFilterPill,
  ShowTracesContext,
  ShowTracesMenu,
  conditionFilters,
  conditionText,
  conditionsFor,
} from './eval_trace_filter';
import {
  getEvalTraceFilter,
  setEvalTraceFilter,
  withEvalTraceFilter,
} from './eval_trace_filter_store';
import { groupBySession } from '../pages/sessions/use_session_evaluations';
import { makeResult } from './eval_test_fixtures';

describe('trace conditions', () => {
  it('names the condition and maps it to result filters', () => {
    expect(conditionText({ name: 'answer_quality', kind: 'fail' })).toBe('answer_quality: fail');
    expect(conditionText({ name: 'q', kind: 'label', label: 'correct' })).toBe('q = correct');
    expect(conditionText({ name: 'q', kind: 'below', value: 2.5 })).toBe('q < 2.50');
    expect(conditionFilters({ name: 'q', kind: 'fail' })).toEqual({
      names: ['q'],
      outcomes: ['fail'],
    });
    expect(conditionFilters({ name: 'q', kind: 'above', value: 3 })).toEqual({
      names: ['q'],
      valueAbove: 3,
    });
  });

  it('maps the results behind a chart point: evaluation, verdict and run', () => {
    expect(
      conditionFilters({ kind: 'results', name: 'q', outcome: 'pass', runId: 'run-1' })
    ).toEqual({ names: ['q'], outcomes: ['pass'], runIds: ['run-1'] });
    expect(conditionFilters({ kind: 'results' })).toEqual({});
    expect(
      conditionText({
        kind: 'results',
        outcome: 'fail',
        timeRange: { from: Date.UTC(2026, 9, 28, 14), to: Date.UTC(2026, 9, 28, 15) },
      })
    ).toMatch(/^All evaluations · fail · Oct 28, \d\d:00 to Oct 28, \d\d:00$/);
  });

  it('offers label and value conditions when the result has them', () => {
    expect(conditionsFor({ name: 'q' }).map((c) => c.kind)).toEqual(['fail']);
    expect(conditionsFor({ name: 'q', label: 'x', value: 1 }).map((c) => c.kind)).toEqual([
      'fail',
      'label',
      'below',
      'above',
    ]);
  });

  it('shows the menu only where a view can list traces', () => {
    const { container } = render(<ShowTracesMenu name="q" />);
    expect(container).toBeEmptyDOMElement();
    const showTraces = jest.fn();
    render(
      <ShowTracesContext.Provider value={showTraces}>
        <ShowTracesMenu name="q" label="incorrect" />
      </ShowTracesContext.Provider>
    );
    fireEvent.click(screen.getByTestId('agtEvlShowTracesButton'));
    fireEvent.click(screen.getByTestId('agtEvlShowTraces-label'));
    expect(showTraces).toHaveBeenCalledWith({ name: 'q', kind: 'label', label: 'incorrect' });
  });
});

describe('evaluation trace filter', () => {
  afterEach(() => setEvalTraceFilter(undefined));

  it('narrows the query to the trace ids and keeps an empty set empty', () => {
    expect(withEvalTraceFilter('| where a = 1')).toBe('| where a = 1');
    setEvalTraceFilter({ label: 'q: fail', traceIds: ['abc', 'def'], capped: false });
    expect(withEvalTraceFilter('| where a = 1')).toBe(
      "| where a = 1 | where `traceId` in ('abc', 'def')"
    );
    expect(withEvalTraceFilter('')).toBe("| where `traceId` in ('abc', 'def')");
    setEvalTraceFilter({ label: 'q: fail', traceIds: [], capped: false });
    expect(withEvalTraceFilter('')).toBe("| where `traceId` in ('-')");
  });

  it('rejects ids that could break the query', () => {
    setEvalTraceFilter({ label: 'x', traceIds: ["a') or ('1"], capped: false });
    expect(getEvalTraceFilter()).toBeUndefined();
  });

  it('shows a removable pill naming the condition, "first N" when capped', () => {
    setEvalTraceFilter({ label: 'q: fail', traceIds: ['a', 'b'], capped: true });
    const onRemove = jest.fn();
    render(<EvalTraceFilterPill onRemove={onRemove} />);
    expect(screen.getByTestId('agtEvlTraceFilterPill')).toHaveTextContent(
      'Evaluation: q: fail · first 2 traces'
    );
    fireEvent.click(screen.getByLabelText('Remove the evaluation filter'));
    expect(onRemove).toHaveBeenCalled();
    expect(getEvalTraceFilter()).toBeUndefined();
  });
});

describe('groupBySession', () => {
  it('keeps session-level results by session id', () => {
    const grouped = groupBySession([
      makeResult({ level: 'session', sessionId: 's1' }),
      makeResult({ level: 'trace', sessionId: 's1' }),
      makeResult({ level: 'session', sessionId: 's2' }),
    ]);
    expect(grouped.get('s1')).toHaveLength(1);
    expect(grouped.get('s2')).toHaveLength(1);
  });
});
