/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { DeltaText, OverviewTab } from './overview_tab';
import { makeResult } from './eval_test_fixtures';
import { EvalResult, summarizeByEvaluator } from './eval_data';
import { bucketOutcomes, computeKpis } from './eval_aggregations';
import { EvalAggregates } from './use_eval_data';
import { ShowTracesContext } from './eval_trace_filter';

/** What the server-side aggregations return for these results. */
const aggOf = (list: EvalResult[]): EvalAggregates => ({
  summaries: summarizeByEvaluator(list),
  kpis: computeKpis(list),
  buckets: bucketOutcomes(list, 3600 * 1000),
  bucketsByName: new Map(),
  trend: [],
  truncated: false,
});

jest.mock('./eval_charts', () => ({
  OutcomeHistogram: () => <div data-test-subj="histogramStub" />,
  ScoreTrendChart: () => <div data-test-subj="trendStub" />,
}));

const bounds = { from: Date.UTC(2026, 9, 26, 0), to: Date.UTC(2026, 9, 27, 0) };

const results = [
  makeResult({
    name: 'tool_diversity',
    value: 0.33,
    label: 'Looping on one tool',
    time: '2026-10-26 09:00:00',
    explanation: 'one tool',
  }),
  makeResult({ name: 'tool_diversity', value: 1, label: 'Diverse', time: '2026-10-26 09:05:00' }),
  makeResult({
    name: 'Helpfulness',
    label: 'Very Helpful',
    level: 'session',
    source: 'agentcore',
    sessionId: 's1',
    time: '2026-10-26 10:00:00',
  }),
];
const previous = [makeResult({ name: 'tool_diversity', value: 1, time: '2026-10-25 09:00:00' })];

const renderOverview = (
  props: Partial<React.ComponentProps<typeof OverviewTab>> = {},
  showTraces?: jest.Mock
) => {
  const onSelectEvaluation = jest.fn();
  const onOpenResult = jest.fn();
  render(
    <I18nProvider>
      <ShowTracesContext.Provider value={showTraces}>
        <OverviewTab
          current={aggOf(results)}
          previous={aggOf(previous)}
          failures={results.filter((r) => r.outcome === 'fail')}
          bounds={bounds}
          interval={3600 * 1000}
          onSelectEvaluation={onSelectEvaluation}
          onOpenResult={onOpenResult}
          {...props}
        />
      </ShowTracesContext.Provider>
    </I18nProvider>
  );
  return { onSelectEvaluation, onOpenResult };
};

describe('OverviewTab', () => {
  it('shows KPIs with deltas vs the previous period', () => {
    renderOverview();
    const resultsKpi = screen.getByTestId('agtEvlKpiResults');
    expect(within(resultsKpi).getByText('3')).toBeInTheDocument();
    expect(within(resultsKpi).getByText('+2 (+200%) vs previous')).toBeInTheDocument();
    const passRate = screen.getByTestId('agtEvlKpiPassRate');
    expect(within(passRate).getByText('67%')).toBeInTheDocument();
    // 100% before, 67% now: a drop shown as bad
    const delta = within(passRate).getByTestId('agtEvlDelta');
    expect(delta).toHaveTextContent('-33.3 pts vs previous');
    expect(within(screen.getByTestId('agtEvlKpiSessions')).getByText('1')).toBeInTheDocument();
  });

  it('renders one card per evaluation, most failing first, and filters on click', () => {
    const { onSelectEvaluation } = renderOverview();
    const cards = screen.getAllByTestId('agtEvlEvaluatorCard');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('tool_diversity')).toBeInTheDocument();
    expect(within(cards[0]).getByTestId('agtEvlCardPassRate')).toHaveTextContent('50%');
    expect(within(cards[1]).getByText('Bedrock AgentCore')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Session')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Very Helpful 100%')).toBeInTheDocument();
    fireEvent.click(cards[1]);
    expect(onSelectEvaluation).toHaveBeenCalledWith('Helpfulness');
  });

  it('shows the mean and a "No pass rule" hint for an evaluation without a rule', () => {
    renderOverview({
      current: aggOf([
        makeResult({ name: 'span_coverage', value: 1, label: 'Full' }),
        makeResult({ name: 'span_coverage', value: 0.5, label: 'Partial' }),
      ]),
    });
    const card = screen.getByTestId('agtEvlEvaluatorCard');
    expect(within(card).getByTestId('agtEvlCardMean')).toHaveTextContent('0.75');
    expect(within(card).getByTestId('agtEvlNoPassRule')).toBeInTheDocument();
    expect(within(card).queryByTestId('agtEvlCardPassRate')).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlKpiPassRateSub')).toHaveTextContent('2 scored without a rule');
  });

  it('offers the traces where an evaluation fails from its card', () => {
    const showTraces = jest.fn();
    renderOverview({}, showTraces);
    const card = screen.getAllByTestId('agtEvlEvaluatorCard')[0];
    fireEvent.click(within(card).getByTestId('agtEvlShowTracesButton'));
    fireEvent.click(screen.getByTestId('agtEvlShowTraces-fail'));
    expect(showTraces).toHaveBeenCalledWith({ name: 'tool_diversity', kind: 'fail' });
  });

  it('lists recent failures that open the result', () => {
    const { onOpenResult } = renderOverview();
    const list = screen.getByTestId('agtEvlRecentFailures');
    expect(within(list).getByTestId('agtEvlOutcomeBadge')).toHaveTextContent(
      'Looping on one tool (0.33)'
    );
    fireEvent.click(within(list).getByTestId('agtEvlFailureLink'));
    expect(onOpenResult).toHaveBeenCalledWith(results[0]);
  });

  it('explains an empty result set', () => {
    renderOverview({ current: aggOf([]) });
    expect(screen.getByTestId('agtEvlOverviewEmpty')).toBeInTheDocument();
  });
});

describe('DeltaText', () => {
  const renderDelta = (props: React.ComponentProps<typeof DeltaText>) =>
    render(
      <I18nProvider>
        <DeltaText {...props} />
      </I18nProvider>
    );
  it('says when there is no previous data', () => {
    renderDelta({ current: 1, previous: undefined, kind: 'count', good: 'up' });
    expect(screen.getByText('No earlier data')).toBeInTheDocument();
  });
  it('says when nothing changed', () => {
    renderDelta({ current: 4, previous: 4, kind: 'count', good: 'down' });
    expect(screen.getByText('No change')).toBeInTheDocument();
  });
});
