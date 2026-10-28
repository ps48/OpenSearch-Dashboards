/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { of } from 'rxjs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { RunDetailPage } from './run_detail';
import { twoRunEventsFixture, twoRunFixture } from './eval_test_fixtures';
import { RunEvents } from './eval_data';

jest.mock('./eval_charts', () => ({
  OutcomeHistogram: () => <div />,
  ScoreTrendChart: () => <div />,
  ScoreDistributionChart: () => <div data-test-subj="distributionStub" />,
  CaseScoresChart: () => <div data-test-subj="caseScoresStub" />,
  SuiteTrendChart: ({ currentRunId }: { currentRunId: string }) => (
    <div data-test-subj="suiteTrendStub">{currentRunId}</div>
  ),
}));

const toResponse = (rows: Array<Record<string, unknown>>) => ({
  schema: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [],
  datarows: rows.map((r) => Object.values(r)),
});

const span = (
  traceId: string,
  spanId: string,
  op: string,
  extra: Record<string, unknown> = {}
) => ({
  traceId,
  spanId,
  parentSpanId: spanId === 'root' ? '' : 'root',
  name: `${op} x`,
  startTime: `2026-10-26 10:00:0${spanId.length % 10}.000`,
  durationInNanos: 1e9,
  status: { code: 0 },
  events: [],
  attributes: { 'gen_ai.operation.name': op, ...extra },
});

const events = (): RunEvents => {
  const e = twoRunEventsFixture();
  e.runs = e.runs.map((r) =>
    r.runId === 'run-2' ? { ...r, metadata: { 'agent.version': 'v2' } } : r
  );
  return e;
};

const setup = (props: Partial<React.ComponentProps<typeof RunDetailPage>> = {}) => {
  const search = jest.fn(
    (request: { params: { body: { query: { queries: Array<{ query: string }> } } } }) => {
      const query = request.params.body.query.queries[0].query;
      if (query.includes('otel-v1-apm-span') && query.includes('run-1-trace-a')) {
        return of(
          toResponse([
            span('run-1-trace-a', 'root', 'invoke_agent', { 'gen_ai.agent.name': 'planner' }),
            span('run-1-trace-a', 'tool-1', 'execute_tool', {
              'gen_ai.tool.name': 'search_hotels',
            }),
          ])
        );
      }
      if (query.includes('otel-v1-apm-span') && query.includes('run-2-trace-a')) {
        return of(
          toResponse([
            span('run-2-trace-a', 'root', 'invoke_agent', { 'gen_ai.agent.name': 'planner' }),
            span('run-2-trace-a', 'tool-1', 'execute_tool', {
              'gen_ai.tool.name': 'search_hotels',
            }),
            span('run-2-trace-a', 'tool-22', 'execute_tool', { 'gen_ai.tool.name': 'convert' }),
          ])
        );
      }
      return of(toResponse([]));
    }
  );
  const handlers = {
    onBack: jest.fn(),
    onOpenRun: jest.fn(),
    onCompare: jest.fn(),
    onOpenTrace: jest.fn(),
  };
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider
        services={{ data: { search: { search } }, uiSettings: { get: () => undefined } }}
      >
        <RunDetailPage
          runId="run-2"
          results={twoRunFixture()}
          events={events()}
          loading={false}
          {...handlers}
          {...props}
        />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return { ...handlers, search };
};

describe('RunDetailPage', () => {
  it('shows the run header with status, facts and metadata', () => {
    setup();
    const header = screen.getByTestId('agtEvlRunHeader');
    expect(within(header).getByText('travel-suite')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlRunId')).toHaveTextContent('run-2');
    expect(screen.getByTestId('agtEvlRunStatus')).toHaveTextContent('Failure');
    expect(header).toHaveTextContent('8.00 s');
    expect(screen.getByTestId('agtEvlRunMetadata')).toHaveTextContent('agent.version: v2');
  });

  it('shows the pass, fail and errored split and a score card per evaluation', () => {
    setup();
    expect(screen.getByTestId('agtEvlCaseSplit-pass')).toHaveTextContent('2');
    expect(screen.getByTestId('agtEvlCaseSplit-fail')).toHaveTextContent('1');
    expect(screen.getByTestId('agtEvlCaseSplit-error')).toHaveTextContent('1');
    expect(screen.getByTestId('agtEvlRunCasePassRate')).toHaveTextContent('50%');
    const card = screen.getByTestId('agtEvlRunScoreCard');
    expect(within(card).getByTestId('agtEvlRunScoreMean')).toHaveTextContent('0.57');
    expect(within(card).getByTestId('agtEvlRunScorePassRate')).toHaveTextContent('67%');
    expect(within(card).getByTestId('agtEvlRunScoreWorst')).toHaveTextContent('0.20');
    expect(card).toHaveTextContent('-8 pts vs previous run');
    expect(screen.getByTestId('suiteTrendStub')).toHaveTextContent('run-2');
  });

  it('lists test cases errored first with status, grade, content and trace links', () => {
    const { onOpenTrace } = setup();
    const rows = within(screen.getByTestId('agtEvlRunCases')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Case d');
    expect(within(rows[0]).getByTestId('agtEvlCaseErrorBadge')).toHaveTextContent('TimeoutError');
    const caseB = rows.find((r) => within(r).queryByText('Case b')) as HTMLElement;
    const badge = within(caseB).getByTestId('agtEvlOutcomeBadge');
    expect(badge).toHaveTextContent('0.20');
    expect(badge).toHaveAttribute('data-outcome', 'fail');
    expect(within(caseB).getByTestId('agtEvlRunCaseInput')).toHaveTextContent('Plan a trip b');
    expect(within(caseB).getByTestId('agtEvlRunCaseOutput')).toHaveTextContent('new b');
    fireEvent.click(within(caseB).getByTestId('agtEvlRunCaseTrace'));
    expect(onOpenTrace).toHaveBeenCalledWith('run-2-trace-b', Date.parse('2026-10-26T10:00:01Z'));
  });

  it('compares with the previous run, or with a run picked from the suite', () => {
    const { onCompare } = setup();
    fireEvent.click(screen.getByTestId('agtEvlComparePrevious'));
    expect(onCompare).toHaveBeenCalledWith(['run-1', 'run-2']);
    fireEvent.click(screen.getByTestId('agtEvlCompareWith'));
    expect(screen.getAllByTestId('agtEvlCompareWithItem')).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('agtEvlCompareWithList')).getByText('run-1'));
    expect(onCompare).toHaveBeenLastCalledWith(['run-1', 'run-2']);
  });

  it('opens a case trace next to the previous run trace, with the step differences', async () => {
    setup();
    const rows = within(screen.getByTestId('agtEvlRunCases')).getAllByRole('row');
    const caseA = rows.find((r) => within(r).queryByText('Case a')) as HTMLElement;
    fireEvent.click(within(caseA).getByTestId('agtEvlRunCaseDiffPrevious'));
    const flyout = await screen.findByTestId('agtEvlTraceCompare');
    await waitFor(() => expect(within(flyout).getByTestId('agtEvlStepsComparison')).toBeTruthy());
    expect(within(flyout).getByTestId('agtEvlToolOnlyCandidate')).toHaveTextContent(
      'convert only in candidate'
    );
    expect(within(flyout).getAllByTestId('agtEvlStepRow-candidate_only')).toHaveLength(1);
    expect(within(flyout).getByTestId('agtEvlTraceTotals')).toHaveTextContent(
      /Tool calls.*1.*2.*\+1/
    );
  });

  it('opens the evaluation drill-down scoped to the run', async () => {
    setup();
    fireEvent.click(screen.getByTestId('agtEvlRunScoreCard'));
    const flyout = await screen.findByTestId('agtEvlDrilldown');
    expect(flyout).toHaveTextContent('Run run-2');
    expect(within(flyout).getByTestId('agtEvlDrilldownFailing')).toHaveTextContent('1');
  });

  it('says when the run does not exist, and goes back to the runs', () => {
    const { onBack } = setup({ runId: 'nope' });
    expect(screen.getByTestId('agtEvlRunNotFound')).toHaveTextContent('nope');
    fireEvent.click(screen.getByTestId('agtEvlRunBack'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows a loading state until the run arrives', () => {
    setup({ runId: 'nope', loading: true });
    expect(screen.queryByTestId('agtEvlRunNotFound')).not.toBeInTheDocument();
  });
});
