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
import { EvalData, RunData } from './use_eval_data';
import { EMPTY_RUN_EVENTS } from './eval_data';

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
const mockUseEvalData = jest.fn(() => evalData);
const mockUseRunResults = jest.fn(() => runData);
jest.mock('./use_eval_data', () => ({
  ...jest.requireActual('./use_eval_data'),
  useEvalData: (...args: unknown[]) => mockUseEvalData(...(args as [])),
  useRunResults: (...args: unknown[]) => mockUseRunResults(...(args as [])),
}));

const makeServices = () => {
  const timefilter = {
    getTime: () => ({ from: 'now-24h', to: 'now' }),
    getRefreshInterval: () => ({ pause: true, value: 0 }),
    getTimeUpdate$: () => new Subject(),
    getRefreshIntervalUpdate$: () => new Subject(),
    getAutoRefreshFetch$: () => new Subject(),
    calculateBounds: () => ({
      min: { valueOf: () => Date.UTC(2026, 9, 26, 0) },
      max: { valueOf: () => Date.UTC(2026, 9, 27, 0) },
    }),
    setTime: jest.fn(),
    setRefreshInterval: jest.fn(),
  };
  return {
    data: { query: { timefilter: { timefilter } } },
    uiSettings: {
      get: (key: string, fallback?: unknown) =>
        key === 'timepicker:quickRanges' ? [] : (fallback ?? 'MMM D, YYYY'),
    },
    chrome: { docTitle: { change: jest.fn() }, setBreadcrumbs: jest.fn() },
    application: { navigateToApp: jest.fn() },
  };
};

const renderApp = (hash = '') => {
  window.history.replaceState({}, '', `/app/agentTraces/evaluations${hash}`);
  const history = createBrowserHistory();
  const params = { history } as unknown as AppMountParameters;
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={makeServices()}>
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
    previous: [],
    total: 2,
    facets: [{ name: 'tool_diversity', level: 'span', source: 'opensearch-sdk', count: 1 }],
    truncated: false,
  };
  runData = {
    loading: false,
    indexMissing: false,
    results: twoRunFixture(),
    events: EMPTY_RUN_EVENTS,
    truncated: false,
  };
  mockUseEvalData.mockClear();
  mockUseRunResults.mockClear();
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

  it('says when aggregates use only the latest results', () => {
    evalData = { ...evalData, truncated: true, total: 5000 };
    renderApp();
    expect(
      within(screen.getByTestId('agtEvlTruncated')).getByText(/of 5,000 results/)
    ).toBeTruthy();
  });
});
