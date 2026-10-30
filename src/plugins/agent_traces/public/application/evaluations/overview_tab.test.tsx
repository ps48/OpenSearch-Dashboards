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
  ValueDistributionChart: () => <div data-test-subj="distributionStub" />,
  JudgedLatencyChart: () => <div data-test-subj="latencyStub" />,
  formatMs: (ms: number) => `${ms} ms`,
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
    expect(delta).toHaveTextContent('-33.3 pp vs previous');
    expect(within(screen.getByTestId('agtEvlKpiSessions')).getByText('1')).toBeInTheDocument();
  });

  it('lists every evaluation in a table, most failing first, and drills down on click', () => {
    const { onSelectEvaluation } = renderOverview();
    const rows = screen.getAllByTestId('agtEvlEvaluationRow');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('tool_diversity')).toBeInTheDocument();
    expect(within(rows[0]).getByTestId('agtEvlCardPassRate')).toHaveTextContent('50%');
    expect(within(rows[1]).getByText('Helpfulness')).toBeInTheDocument();
    expect(within(rows[1]).getByText('session')).toBeInTheDocument();
    fireEvent.click(rows[1]);
    expect(onSelectEvaluation).toHaveBeenCalledWith('Helpfulness');
  });

  it('shows the mean and a "No pass rule" hint for an evaluation without a rule', () => {
    renderOverview({
      current: aggOf([
        makeResult({ name: 'span_coverage', value: 1, label: 'Full' }),
        makeResult({ name: 'span_coverage', value: 0.5, label: 'Partial' }),
      ]),
    });
    const row = screen.getByTestId('agtEvlEvaluationRow');
    expect(within(row).getByTestId('agtEvlCardMean')).toHaveTextContent('mean 0.75');
    expect(within(row).queryByTestId('agtEvlCardPassRate')).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlNoPassRule')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlKpiPassRateSub')).toHaveTextContent('2 scored without a rule');
  });

  it('offers the traces where an evaluation fails from its row, without drilling down', () => {
    const showTraces = jest.fn();
    const { onSelectEvaluation } = renderOverview({}, showTraces);
    const row = screen.getAllByTestId('agtEvlEvaluationRow')[0];
    fireEvent.click(within(row).getByTestId('agtEvlShowTracesButton'));
    fireEvent.click(screen.getByTestId('agtEvlShowTraces-fail'));
    expect(showTraces).toHaveBeenCalledWith({ name: 'tool_diversity', kind: 'fail' });
    expect(onSelectEvaluation).not.toHaveBeenCalled();
  });

  it('leaves the failures to the Results tab: no recent failures list', () => {
    renderOverview();
    expect(screen.queryByTestId('agtEvlRecentFailures')).not.toBeInTheDocument();
  });

  it('shows the score distribution of the most failing evaluation with numbers, and a picker', () => {
    renderOverview();
    const picker = screen.getByTestId('agtEvlDistributionPicker') as HTMLSelectElement;
    expect(picker.value).toBe('tool_diversity');
    // Helpfulness reports labels only: not offered.
    expect(within(picker).queryByText('Helpfulness')).not.toBeInTheDocument();
    expect(screen.getByText('Latency of judged traces')).toBeInTheDocument();
  });

  it('opens with what needs attention, linked to the drill-down, and no Top changes', () => {
    const { onSelectEvaluation } = renderOverview();
    const drop = screen.getByTestId('agtEvlFinding-drop');
    expect(drop).toHaveTextContent('tool_diversity: pass rate fell 50 points to 50% (from 100%)');
    fireEvent.click(within(drop).getByTestId('agtEvlFindingLink'));
    expect(onSelectEvaluation).toHaveBeenCalledWith('tool_diversity');
    expect(screen.queryByTestId('agtEvlTopChanges')).not.toBeInTheDocument();
    expect(screen.queryByText('Top changes')).not.toBeInTheDocument();
  });

  it('says when nothing needs attention, and names a silent evaluation', () => {
    // Steady and nothing failing.
    renderOverview({ current: aggOf(results.slice(1)), previous: aggOf(results.slice(1)) });
    expect(screen.getByTestId('agtEvlNothingNeedsAttention')).toHaveTextContent(
      'Nothing needs attention in this range.'
    );
    const onShowPrevious = jest.fn();
    renderOverview({
      current: aggOf(results.slice(2)),
      previous: aggOf(results),
      onShowPrevious,
    });
    const silent = screen.getByTestId('agtEvlFinding-silent');
    expect(silent).toHaveTextContent(
      'tool_diversity: no results in this period (2 in the previous period)'
    );
    fireEvent.click(within(silent).getByTestId('agtEvlFindingLink'));
    expect(onShowPrevious).toHaveBeenCalledWith('tool_diversity');
  });

  it('puts the charts between what needs attention and the evaluations table', () => {
    renderOverview();
    const trend = screen.getByTestId('trendStub');
    const firstCard = screen.getAllByTestId('agtEvlEvaluationRow')[0];
    const attention = screen.getByTestId('agtEvlNeedsAttention');
    const before = (a: Node, b: Node) =>
      // eslint-disable-next-line no-bitwise
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(attention, trend)).toBe(true);
    expect(before(trend, firstCard)).toBe(true);
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
