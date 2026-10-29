/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Subject } from 'rxjs';
import { createBrowserHistory } from 'history';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { AppMountParameters } from '../../../../../core/public';
import { EvaluationsApp } from './evaluations_app';
import { makeResult, twoRunFixture } from './eval_test_fixtures';
import { EvalAggregates, EvalData, RunData, RunDetailState } from './use_eval_data';
import { EMPTY_RUN_EVENTS, summarizeByEvaluator } from './eval_data';
import { computeKpis, summarizeRuns } from './eval_aggregations';

jest.mock('../../../../data/public', () => ({
  syncQueryStateWithUrl: () => ({ stop: jest.fn() }),
}));
jest.mock('./eval_charts', () => ({
  OutcomeHistogram: () => <div />,
  ScoreTrendChart: () => <div />,
}));
jest.mock('./result_flyout', () => ({
  ResultFlyout: ({ result }: { result: { name: string } }) => (
    <div data-test-subj="flyoutStub">{result.name}</div>
  ),
}));

const results = [
  makeResult({ id: 'r-fail', name: 'tool_diversity', value: 0.2, time: '2026-10-26 09:00:00' }),
  makeResult({ id: 'r-pass', name: 'error_free', value: 1, time: '2026-10-26 09:01:00' }),
];
let evalData: EvalData;
let runData: RunData;
let runDetail: RunDetailState;
const mockUseEvalData = jest.fn(() => evalData);
const mockUseRunResults = jest.fn(() => runData);
const mockUseRunDetail = jest.fn(() => runDetail);
const mockUseEvaluationResults = jest.fn(() => ({ loading: false, results }));
let mockAgentCorePresent = false;
const mockUseResultsPage = jest.fn(() => ({ loading: false, rows: results, beyondLimit: false }));
jest.mock('./use_eval_data', () => ({
  ...jest.requireActual('./use_eval_data'),
  useEvalData: (...args: unknown[]) => mockUseEvalData(...(args as [])),
  useRunResults: (...args: unknown[]) => mockUseRunResults(...(args as [])),
  useRunDetail: (...args: unknown[]) => mockUseRunDetail(...(args as [])),
  useEvaluationResults: (...args: unknown[]) => mockUseEvaluationResults(...(args as [])),
  useAgentCorePresent: () => mockAgentCorePresent,
  useResultsPage: (...args: unknown[]) => mockUseResultsPage(...(args as [])),
  useRunsDetail: () => ({
    loading: false,
    results: [],
    events: { cases: [], runs: [] },
    missing: [],
  }),
}));

const aggOf = (list: typeof results): EvalAggregates => ({
  summaries: summarizeByEvaluator(list),
  kpis: computeKpis(list),
  buckets: [],
  bucketsByName: new Map(),
  trend: [],
  truncated: false,
});
jest.mock('./run_detail', () => ({
  RunDetailPage: ({ runId, results: shown }: { runId: string; results: unknown[] }) => (
    <div data-test-subj="runDetailStub">
      {runId}:{shown.length}
    </div>
  ),
}));

let settings: Record<string, unknown> = {};

/** Bounds per relative range, so tests can tell which range a hook received. */
const BOUNDS: Record<string, [number, number]> = {
  'now-7d': [Date.UTC(2026, 9, 20, 0), Date.UTC(2026, 9, 27, 0)],
  'now-24h': [Date.UTC(2026, 9, 26, 0), Date.UTC(2026, 9, 27, 0)],
};

const makeServices = () => {
  const timefilter = {
    getTime: () => ({ from: 'now-24h', to: 'now' }),
    getRefreshInterval: () => ({ pause: true, value: 0 }),
    getTimeUpdate$: () => new Subject(),
    getRefreshIntervalUpdate$: () => new Subject(),
    getAutoRefreshFetch$: () => new Subject(),
    calculateBounds: ({ from }: { from: string }) => {
      const [min, max] = BOUNDS[from] ?? BOUNDS['now-24h'];
      return { min: { valueOf: () => min }, max: { valueOf: () => max } };
    },
    setTime: jest.fn(),
    setRefreshInterval: jest.fn(),
  };
  return {
    data: { query: { timefilter: { timefilter } } },
    uiSettings: {
      get: (key: string, fallback?: unknown) =>
        key in settings
          ? settings[key]
          : key === 'timepicker:quickRanges'
            ? []
            : (fallback ?? 'MMM D, YYYY'),
    },
    chrome: { docTitle: { change: jest.fn() }, setBreadcrumbs: jest.fn() },
    notifications: { toasts: { addDanger: jest.fn() } },
    application: { navigateToApp: jest.fn() },
  };
};

let services: ReturnType<typeof makeServices>;

const renderApp = (hash = '') => {
  window.history.replaceState({}, '', `/app/agentTraces/evaluations${hash}`);
  const history = createBrowserHistory();
  const params = { history } as unknown as AppMountParameters;
  services = makeServices();
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        <EvaluationsApp params={params} />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return history;
};

beforeEach(() => {
  evalData = {
    loading: false,
    indexMissing: false,
    results,
    current: aggOf(results),
    total: 2,
    interval: 3600 * 1000,
    facets: [{ name: 'tool_diversity', level: 'span', source: 'opensearch-sdk', count: 1 }],
    truncated: false,
  };
  mockAgentCorePresent = false;
  runData = {
    loading: false,
    indexMissing: false,
    runs: summarizeRuns(twoRunFixture()),
    truncated: false,
  };
  runDetail = { loading: false, results: [], events: EMPTY_RUN_EVENTS };
  settings = {};
  mockUseEvalData.mockClear();
  mockUseRunResults.mockClear();
  mockUseRunDetail.mockClear();
  mockUseEvaluationResults.mockClear();
  mockUseResultsPage.mockClear();
});

describe('EvaluationsApp', () => {
  it('renders the page frame with the overview by default', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Agent Evaluations' })).toBeInTheDocument();
    expect(screen.getByText(/Scores and judgments on your agents/)).toBeInTheDocument();
    expect(document.querySelector('.euiSuperDatePicker')).not.toBeNull();
    expect(screen.getByTestId('agtEvlOverview')).toBeInTheDocument();
    expect(screen.getAllByTestId('agtEvlEvaluatorCard')).toHaveLength(2);
  });

  it('switches tabs and keeps the tab in the URL', async () => {
    const history = renderApp();
    fireEvent.click(screen.getByTestId('agtEvlTab-results'));
    expect(screen.getByTestId('agtEvlResultsTable')).toBeInTheDocument();
    // the URL is written asynchronously
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(decodeURIComponent(history.location.hash)).toContain('_a=(tab:results)');
  });

  it('restores tab and filters from the URL and passes filters to the data hook', () => {
    renderApp('#/?_a=(failing:!t,names:!(tool_diversity),tab:results)');
    expect(screen.getByTestId('agtEvlResultsTable')).toBeInTheDocument();
    const filters = (mockUseEvalData.mock.calls[0] as unknown[])[2];
    expect(filters).toMatchObject({ names: ['tool_diversity'], failingOnly: true });
    expect(screen.getByTestId('agtEvlFailingOnly')).toBeChecked();
  });

  it('opens the result flyout from a table row', () => {
    renderApp('#/?_a=(tab:results)');
    fireEvent.click(screen.getByTestId('agtEvlResultRow-fail'));
    expect(screen.getByTestId('flyoutStub')).toHaveTextContent('tool_diversity');
  });

  it('opens the result named in the URL', () => {
    renderApp('#/?_a=(result:r-pass,tab:results)');
    expect(screen.getByTestId('flyoutStub')).toHaveTextContent('error_free');
  });

  it('shows the runs tab with runs fetched only while it is open', () => {
    renderApp('#/?_a=(tab:runs)');
    expect(screen.getByTestId('agtEvlRunsTable')).toBeInTheDocument();
    const lastCall = mockUseRunResults.mock.calls[mockUseRunResults.mock.calls.length - 1];
    expect((lastCall as unknown[])[4]).toBe(true);
  });

  it('explains how to send results when the index is missing', () => {
    evalData = { ...evalData, indexMissing: true, error: 'no such index', results: [] };
    renderApp();
    expect(screen.getByTestId('agtEvlNoIndex')).toBeInTheDocument();
  });

  it('shows PPL errors inline', () => {
    evalData = { ...evalData, error: 'Field [x] not found.', results: [] };
    renderApp();
    expect(screen.getByTestId('agtEvlQueryError')).toHaveTextContent('Field [x] not found.');
  });

  it('says when an aggregation hit the row limit', () => {
    evalData = { ...evalData, current: { ...aggOf(results), truncated: true } };
    renderApp();
    expect(screen.getByTestId('agtEvlAggLimit')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlTruncated')).not.toBeInTheDocument();
  });

  it('gives the Results tab the exact total and pages it in the query', () => {
    evalData = { ...evalData, total: 12345 };
    renderApp('#/?_a=(tab:results)');
    expect(screen.getByTestId('agtEvlResultsTotal')).toHaveTextContent('12,345 results');
    expect(screen.getByTestId('agtEvlTab-results')).toHaveTextContent('12345');
    expect(screen.queryByTestId('agtEvlTruncated')).not.toBeInTheDocument();
    const call = mockUseResultsPage.mock.calls[mockUseResultsPage.mock.calls.length - 1];
    // sort, page index, page size, enabled
    expect((call as unknown[]).slice(5)).toEqual([
      { field: 'time', direction: 'desc' },
      0,
      25,
      true,
    ]);
    // 12,345 results at 25 a page: 494 pages, the last one reachable
    expect(screen.getByTestId('pagination-button-493')).toBeInTheDocument();
  });

  it('notes the AgentCore lag when the range ends now and AgentCore results exist', () => {
    mockAgentCorePresent = true;
    const now = Date.now();
    BOUNDS['now-24h'] = [now - 24 * 3600 * 1000, now];
    renderApp();
    expect(screen.getByTestId('agtEvlLagNote')).toHaveTextContent(
      'AgentCore results arrive about 15 minutes after a session ends.'
    );
    BOUNDS['now-24h'] = [Date.UTC(2026, 9, 26, 0), Date.UTC(2026, 9, 27, 0)];
  });

  it('has no lag note for a range that ended long ago', () => {
    mockAgentCorePresent = true;
    renderApp();
    expect(screen.queryByTestId('agtEvlLagNote')).not.toBeInTheDocument();
  });

  it('keeps the global time range: no range is forced when the link has none', () => {
    renderApp();
    expect(services.data.query.timefilter.timefilter.setTime).not.toHaveBeenCalled();
  });

  it('keeps the time range of the link', () => {
    renderApp('#/?_g=(time:(from:now-1h,to:now))');
    expect(services.data.query.timefilter.timefilter.setTime).not.toHaveBeenCalled();
  });

  it('gives the runs tab its own time range, the last 7 days by default', () => {
    renderApp('#/?_a=(tab:runs)');
    expect(screen.getByTestId('agtEvlRunsTimePicker')).toHaveTextContent('Last 7 days');
    expect(document.querySelectorAll('.euiSuperDatePicker')).toHaveLength(1);
    const lastCall = mockUseRunResults.mock.calls[mockUseRunResults.mock.calls.length - 1];
    expect((lastCall as unknown[])[1]).toEqual({
      from: BOUNDS['now-7d'][0],
      to: BOUNDS['now-7d'][1],
    });
    // Overview and Results keep the global range.
    const evalCall = mockUseEvalData.mock.calls[mockUseEvalData.mock.calls.length - 1];
    expect((evalCall as unknown[])[1]).toEqual({
      from: BOUNDS['now-24h'][0],
      to: BOUNDS['now-24h'][1],
    });
  });

  it('reads the runs time range from the URL', () => {
    renderApp('#/?_a=(runsTime:(from:now-24h,to:now),tab:runs)');
    const lastCall = mockUseRunResults.mock.calls[mockUseRunResults.mock.calls.length - 1];
    expect((lastCall as unknown[])[1]).toEqual({
      from: BOUNDS['now-24h'][0],
      to: BOUNDS['now-24h'][1],
    });
  });

  it("opens a run's page from the link a CI job builds, with the run loaded on its own", () => {
    runDetail = { loading: false, results: twoRunFixture().slice(0, 2), events: EMPTY_RUN_EVENTS };
    renderApp("#/?_a=(tab:runs,run:'run-1')");
    expect(screen.getByTestId('runDetailStub')).toHaveTextContent('run-1:2');
    const call = mockUseRunDetail.mock.calls[mockUseRunDetail.mock.calls.length - 1];
    expect((call as unknown[])[1]).toBe('run-1');
    // No filters bar on the run page.
    expect(screen.queryByTestId('agtEvlFailingOnly')).not.toBeInTheDocument();
  });

  it('opens a run from the runs list and keeps it in the URL', async () => {
    const history = renderApp('#/?_a=(tab:runs)');
    fireEvent.click(screen.getAllByTestId('agtEvlRunLink')[0]);
    expect(screen.getByTestId('runDetailStub')).toHaveTextContent('run-2');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(decodeURIComponent(history.location.hash)).toContain('run:run-2');
  });

  it('opens the drill-down of an evaluation from its card', () => {
    renderApp();
    fireEvent.click(screen.getAllByTestId('agtEvlEvaluatorCard')[0]);
    expect(screen.getByTestId('agtEvlDrilldown')).toBeInTheDocument();
    const call =
      mockUseEvaluationResults.mock.calls[mockUseEvaluationResults.mock.calls.length - 1];
    expect((call as unknown[])[1]).toBe('tool_diversity');
    fireEvent.click(screen.getByTestId('agtEvlDrilldownViewAll'));
    expect(screen.getByTestId('agtEvlResultsTable')).toBeInTheDocument();
  });

  it('reads every query from the configured evaluation index', () => {
    settings = { 'agentTraces:evaluationsIndexPattern': 'my-evals-*' };
    renderApp('#/?_a=(tab:runs)');
    const evalCall = mockUseEvalData.mock.calls[mockUseEvalData.mock.calls.length - 1];
    expect((evalCall as unknown[])[4]).toBe('my-evals-*');
    const runsCall = mockUseRunResults.mock.calls[mockUseRunResults.mock.calls.length - 1];
    expect((runsCall as unknown[])[5]).toBe('my-evals-*');
    const detailCall = mockUseRunDetail.mock.calls[mockUseRunDetail.mock.calls.length - 1];
    expect((detailCall as unknown[])[3]).toBe('my-evals-*');
  });
});
