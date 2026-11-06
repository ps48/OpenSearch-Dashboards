/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { recordToResult } from '../../../evaluations/eval_model';
import {
  EvalTallyCell,
  SpanEvalMark,
  TraceEvaluationsTab,
  flowEvalDecoration,
} from './trace_evaluations';
import { groupBySpan } from './use_trace_evaluations';
import { indexRowTallies } from '../row_evaluations_context';
import { resetEvalsDatasetState } from '../../../evaluations/eval_dataset';

const mockNavigate = jest.fn();
const mockServices: { application: unknown; data?: unknown; capabilities?: unknown } = {
  application: { navigateToApp: mockNavigate },
  capabilities: { agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: true } },
};
jest.mock('../../../../../../opensearch_dashboards_react/public', () => ({
  useOpenSearchDashboards: () => ({ services: mockServices }),
}));
/** The time range of every PPL read, by query (the reads themselves run as usual). */
const mockRanges = new Map<string, unknown>();
jest.mock('../../../evaluations/use_ppl_rows', () => {
  const actual = jest.requireActual('../../../evaluations/use_ppl_rows');
  return {
    ...actual,
    usePplRows: (...args: [unknown, string | undefined, unknown, number?]) => {
      if (args[1]) mockRanges.set(args[1], args[2]);
      return actual.usePplRows(...args);
    },
  };
});

const result = (name: string, label: string | undefined, spanId?: string, extra = {}) =>
  recordToResult({
    '@timestamp': '2026-10-28 07:00:01',
    traceId: 't1',
    spanId,
    attributes: {
      gen_ai: { evaluation: { name, score: { value: 0.5, label }, explanation: `${name} why` } },
      ...extra,
    },
  });

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe('Agent Traces evaluation marks', () => {
  // An Agent Evaluations config: the result flyout reads its index.
  beforeEach(() =>
    resetEvalsDatasetState({
      status: 'ready',
      config: {
        configId: 'c1',
        evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation-*' },
        index: 'otel-v1-genai-evaluation-*',
      },
    })
  );
  afterEach(() => resetEvalsDatasetState());

  it('a span shows the judge mark and a tally', () => {
    wrap(<SpanEvalMark results={[result('a', 'fail', 's1'), result('b', 'pass', 's1')]} />);
    expect(screen.getByTestId('agtEvlJudgeMark')).toHaveAttribute('data-state', 'mixed');
    // Each count carries its verdict for screen readers.
    expect(screen.getByTestId('agtEvlTally')).toHaveTextContent('Fail: 1Pass: 1');
    expect(screen.getByTestId('agtEvlJudgeMark')).toHaveAttribute(
      'aria-label',
      'Evaluation results: a: Fail, b: Pass'
    );
    expect(screen.getByTestId('agtEvlJudgeMark')).toHaveAttribute('tabindex', '0');
  });

  it('puts span results on their span and trace-level results on the root', () => {
    const span = result('a', 'pass', 's1');
    const trace = result('b', 'fail');
    const declaredTrace = recordToResult({
      traceId: 't1',
      spanId: 's2',
      attributes: {
        opensearch: { gen_ai: { evaluation: { level: 'trace' } } },
        gen_ai: { evaluation: { name: 'c' } },
      },
    });
    const grouped = groupBySpan([span, trace, declaredTrace], 'root');
    expect(grouped.s1.map((r) => r.name)).toEqual(['a']);
    expect(grouped.root.map((r) => r.name)).toEqual(['b', 'c']);
  });

  it('the traces table cell is a tally per trace (or per span) from one aggregation', () => {
    const value = indexRowTallies(
      [
        { n: 2, traceId: 't1', verdict: 'pass' },
        { n: 1, traceId: 't1', verdict: 'fail' },
        { n: 4, traceId: 't2', spanId: 's9', verdict: 'scored' },
      ],
      'trace'
    );
    expect(value.byTraceId.get('t1')).toMatchObject({ pass: 2, fail: 1, n: 3 });
    expect(value.bySpanId.get('s9')).toMatchObject({ scored: 4 });
    const onOpen = jest.fn();
    wrap(<EvalTallyCell tally={value.byTraceId.get('t1')} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('agentTracesEvalTally'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('an agent-run row says how many of the trace results sit on no run', () => {
    const onOpen = jest.fn();
    wrap(<EvalTallyCell tally={undefined} outsideRuns={2} onOpen={onOpen} />);
    expect(screen.getByTestId('agentTracesEvalOutsideRuns').textContent).toBe('+2 on trace');
    fireEvent.click(screen.getByTestId('agentTracesEvalTally'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('the Trace Map outlines a span with a failed result', () => {
    expect(flowEvalDecoration([result('a', 'fail', 's1')])?.className).toContain('--fail');
    expect(flowEvalDecoration([result('a', 'pass', 's1')])?.className).toBe('agtEvlFlowNode');
    expect(flowEvalDecoration([])).toBeUndefined();
  });

  it('the Evaluations tab lists the results; a result opens the result flyout', () => {
    const r = result('accuracy', 'fail', 's1', {
      test: { suite: { name: 'golden', run: { id: 'run_20261028_abcd1234' } } },
    });
    wrap(
      <TraceEvaluationsTab
        evals={{ results: [r], bySpanId: { s1: [r] }, isLoading: false }}
        spanLabelOf={() => 'search_flights'}
      />
    );
    expect(screen.getByText('search_flights')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agentTracesEvalRow-accuracy'));
    expect(screen.getByTestId('agtEvlResultFlyout')).toBeInTheDocument();
    // The trace is already open: no View trace; suite and run open Agent Evaluations.
    expect(screen.queryByTestId('agtEvlFlyoutViewTrace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('abcd1234'));
    expect(mockNavigate).toHaveBeenCalledWith('agentTraces/evaluations', {
      path: '#/runs/run_20261028_abcd1234',
    });
  });

  it('says when a trace has no evaluations', () => {
    wrap(<TraceEvaluationsTab evals={{ results: [], bySpanId: {}, isLoading: false }} />);
    expect(screen.getByText('No evaluations for this trace.')).toBeInTheDocument();
  });

  it('the result flyout reads the case and the run before over the Agent Traces range', () => {
    const FROM = '2026-11-02T00:00:00.000Z';
    mockServices.data = {
      query: {
        timefilter: {
          timefilter: {
            getTime: () => ({ from: 'now-2d', to: 'now' }),
            calculateBounds: () => ({ min: { toISOString: () => FROM } }),
          },
        },
      },
    };
    mockRanges.clear();
    const r = result('accuracy', 'fail', 's1', {
      test: { suite: { name: 'golden', run: { id: 'run_1' } }, case: { id: 'c1' } },
    });
    wrap(
      <TraceEvaluationsTab
        evals={{ results: [r], bySpanId: { s1: [r] }, isLoading: false }}
        spanLabelOf={() => 'search_flights'}
      />
    );
    fireEvent.click(screen.getByTestId('agentTracesEvalRow-accuracy'));
    const lookup = [...mockRanges.entries()].find(([q]) =>
      q.includes('stats min(`@timestamp`) as started')
    );
    expect(lookup).toBeDefined();
    // The flyout context sets browseRange to the same range as timeRange.
    expect(lookup?.[1]).toEqual({ from: FROM, to: expect.any(String) });
    delete mockServices.data;
  });

  it('the result flyout links the judged span in a new tab when the app gives URLs', () => {
    const getUrlForApp = jest.fn(
      (appId: string, { path }: { path?: string } = {}) => `/app/${appId}${path}`
    );
    mockServices.application = { navigateToApp: mockNavigate, getUrlForApp };
    try {
      const r = result('accuracy', 'fail', 's1', {
        opensearch: { gen_ai: { evaluation: { level: 'span' } } },
      });
      wrap(
        <TraceEvaluationsTab
          evals={{ results: [r], bySpanId: { s1: [r] }, isLoading: false }}
          spanLabelOf={() => 'search_flights'}
        />
      );
      fireEvent.click(screen.getByTestId('agentTracesEvalRow-accuracy'));
      const link = screen.getByTestId('agtEvlFlyoutNewTab');
      expect(link.getAttribute('href')).toContain('openTraceId=t1&openSpanId=s1');
      expect(getUrlForApp).toHaveBeenCalledWith('agentTraces/traces', expect.anything());
    } finally {
      mockServices.application = { navigateToApp: mockNavigate };
    }
  });

  it('the result flyout has no New tab link when the app gives no URLs', () => {
    const r = result('accuracy', 'fail', 's1');
    wrap(
      <TraceEvaluationsTab
        evals={{ results: [r], bySpanId: { s1: [r] }, isLoading: false }}
        spanLabelOf={() => 'search_flights'}
      />
    );
    fireEvent.click(screen.getByTestId('agentTracesEvalRow-accuracy'));
    expect(screen.getByTestId('agtEvlResultFlyout')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlFlyoutNewTab')).not.toBeInTheDocument();
  });
});
