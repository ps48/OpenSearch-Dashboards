/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { of } from 'rxjs';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import {
  GraphComparison,
  decorationOf,
  graphFocusOf,
  useCompareView,
  useTraceCompare,
} from './trace_compare_flyout';
import { resetEvalsDatasetState } from './eval_dataset';
import { TraceStep, alignSteps } from './trace_compare';
import { TraceRow } from '../pages/traces/hooks/tree_utils';

/** The map stands in as one button per span, with the caller's decoration. */
jest.mock('../pages/traces/flow/trace_flow_view', () => ({
  TraceFlowView: ({
    spanTree,
    onSelectSpan,
    decorateNode,
  }: {
    spanTree: Array<{ spanId: string }>;
    onSelectSpan: (s: unknown) => void;
    decorateNode?: (s: unknown) => { className?: string; badge?: React.ReactNode } | undefined;
  }) => (
    <div>
      <button data-test-subj="node-none" onClick={() => onSelectSpan(null)} />
      {spanTree.map((s) => {
        const d = decorateNode?.(s);
        return (
          <button
            key={s.spanId}
            data-test-subj={`node-${s.spanId}`}
            className={d?.className}
            onClick={() => onSelectSpan(s)}
          >
            {d?.badge}
          </button>
        );
      })}
    </div>
  ),
}));

const step = (spanId: string, name: string): TraceStep => ({
  spanId,
  kind: 'tool',
  name,
  startMs: 0,
});
const row = (spanId: string) => ({ spanId, id: spanId, traceId: 't' }) as unknown as TraceRow;

describe('GraphComparison', () => {
  const aligned = alignSteps(
    [step('a1', 'search_flights')],
    [step('b1', 'search_flights'), step('b2', 'get_weather')]
  );
  const renderGraph = () =>
    render(
      <I18nProvider>
        <GraphComparison
          baseline={[row('a1')]}
          candidate={[row('b1'), row('b2')]}
          aligned={aligned}
          baselineTitle="Baseline"
          candidateTitle="Candidate"
        />
      </I18nProvider>
    );

  it('marks the step only one trace has, with a legend', () => {
    renderGraph();
    expect(screen.getByTestId('agtEvlGraphLegend')).toHaveTextContent('Only here');
    const extra = screen.getByTestId('node-b2');
    expect(extra).toHaveClass('agtEvlGraphNode--only');
    expect(within(extra).getByTestId('agtEvlGraphMark-candidate_only')).toHaveTextContent(
      'Only here'
    );
    expect(screen.getByTestId('node-b1')).not.toHaveClass('agtEvlGraphNode');
    expect(screen.getByTestId('agtEvlGraphHint')).toBeInTheDocument();
  });

  it('selects a step and its match on the other side, and shows the pair', () => {
    renderGraph();
    fireEvent.click(screen.getByTestId('node-a1'));
    expect(screen.getByTestId('node-a1')).toHaveClass('agtEvlGraphNode--selected');
    expect(screen.getByTestId('node-b1')).toHaveClass('agtEvlGraphNode--selected');
    expect(screen.getByTestId('agtEvlStepsComparison')).toHaveTextContent('search_flights');
    fireEvent.click(screen.getByTestId('node-b2'));
    expect(screen.getByTestId('node-a1')).not.toHaveClass('agtEvlGraphNode--selected');
    // A click on the background (null) keeps the selection.
    fireEvent.click(screen.getAllByTestId('node-none')[0]);
    expect(screen.getByTestId('node-b2')).toHaveClass('agtEvlGraphNode--selected');
    expect(screen.getByTestId('agtEvlStepRow-candidate_only')).toHaveTextContent('2');
  });
});

describe('decorationOf', () => {
  it('leaves unchanged, unselected steps and non-steps alone', () => {
    expect(decorationOf(undefined, 0)).toBeUndefined();
    expect(decorationOf({ diff: 'same', index: 1 }, 0)).toBeUndefined();
    expect(decorationOf({ diff: 'args', index: 1 }, 0)?.className).toContain(
      'agtEvlGraphNode--changed'
    );
  });
});

describe('graphFocusOf', () => {
  const tree = [row('root')];
  it("opens each side on the first differing step, else that side's step before it", () => {
    const aligned = alignSteps(
      [step('a1', 'search_flights'), step('a2', 'book')],
      [step('b1', 'search_flights'), step('b2', 'get_weather'), step('b3', 'book')]
    );
    const first = aligned.findIndex((a) => a.diff !== 'same');
    expect(graphFocusOf(aligned, 'candidate', tree)).toBe(aligned[first].candidate?.spanId);
    // Only the candidate has that step: the baseline opens on its step before it.
    expect(graphFocusOf(aligned, 'baseline', tree)).toBe(aligned[first].baseline?.spanId ?? 'a1');
  });
  it('opens on the root when nothing differs', () => {
    const aligned = alignSteps([step('a1', 'x')], [step('b1', 'x')]);
    expect(graphFocusOf(aligned, 'baseline', tree)).toBe('root');
    expect(graphFocusOf(aligned, 'candidate', tree)).toBe('root');
  });
});

describe('useCompareView', () => {
  it('defaults to steps and keeps the choice for the session', () => {
    window.sessionStorage.clear();
    const first = renderHook(() => useCompareView());
    expect(first.result.current[0]).toBe('steps');
    act(() => first.result.current[1]('graph'));
    expect(first.result.current[0]).toBe('graph');
    expect(renderHook(() => useCompareView()).result.current[0]).toBe('graph');
    window.sessionStorage.clear();
  });
});

describe('useTraceCompare', () => {
  it("reads both traces' spans from the config's traces dataset", async () => {
    resetEvalsDatasetState({
      status: 'ready',
      config: {
        configId: 'c',
        tracesDataset: { id: 'tr', title: 'agent-spans*' },
        evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*' },
        index: 'otel-v1-genai-evaluation*',
      },
    });
    const search = jest.fn(() => of({ schema: [], datarows: [] }));
    const wrapper: React.FC = ({ children }) => (
      <OpenSearchDashboardsContextProvider services={{ data: { search: { search } } }}>
        {children}
      </OpenSearchDashboardsContextProvider>
    );
    const { result } = renderHook(() => useTraceCompare('a', 'b'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const queries = (
      search.mock.calls as unknown as Array<
        [{ params: { body: { query: { queries: Array<{ query: string }> } } } }]
      >
    ).map(([r]) => r.params.body.query.queries[0].query);
    const spanQueries = queries.filter((q) => q.includes('sort startTime'));
    expect(spanQueries).toHaveLength(2);
    spanQueries.forEach((q) => expect(q.startsWith('source = agent-spans* |')).toBe(true));
    resetEvalsDatasetState();
  });
});
