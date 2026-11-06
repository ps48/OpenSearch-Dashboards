/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { useInitPage } from './use_page_initialization';
import { AGENT_TRACES_VISUALIZATION_TAB_ID } from '../../../../common';

const mockDispatch = jest.fn(() => Promise.resolve());
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));

let mockSaved: Record<string, unknown> | undefined;
jest.mock('./use_current_agent_traces_id', () => ({ useCurrentAgentTracesId: () => 'saved-1' }));
jest.mock('./use_saved_agent_traces', () => ({
  useSavedAgentTraces: () => ({ savedAgentTraces: mockSaved, error: undefined }),
}));
jest.mock('../../hooks', () => ({ useSetEditorText: () => jest.fn() }));
const mockSetVisConfig = jest.fn();
jest.mock('../../../components/visualizations/visualization_builder_singleton', () => ({
  getVisualizationBuilder: () => ({ setVisConfig: mockSetVisConfig }),
}));
jest.mock('../state_management/actions/query_actions', () => ({
  executeQueries: () => ({ type: 'executeQueries' }),
}));

const mockServices = {
  chrome: {
    docTitle: { change: jest.fn() },
    setBreadcrumbs: jest.fn(),
    recentlyAccessed: { add: jest.fn() },
  },
  data: { query: { queryString: {} } },
  osdUrlStateStorage: { get: (key: string) => (key === '_q' ? mockUrlQuery : undefined) },
};
let mockUrlQuery: Record<string, unknown> | undefined;
jest.mock('../../../../../opensearch_dashboards_react/public', () => ({
  ...jest.requireActual('../../../../../opensearch_dashboards_react/public'),
  useOpenSearchDashboards: () => ({ services: mockServices }),
}));

const savedSearch = (query: string, activeTab: string) => ({
  id: 'saved-1',
  title: 'Saved',
  uiState: JSON.stringify({ activeTab }),
  kibanaSavedObjectMeta: {
    searchSourceJSON: JSON.stringify({ query: { query, language: 'PPL' } }),
  },
});

const queryStates = () =>
  mockDispatch.mock.calls
    .map(([action]: any) => action)
    .filter((action) => action?.type?.endsWith('setQueryState'))
    .map((action) => action.payload.query);

const activeTabs = () =>
  mockDispatch.mock.calls
    .map(([action]: any) => action)
    .filter((action) => action?.type?.endsWith('setActiveTab'))
    .map((action) => action.payload);

describe('useInitPage', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockSetVisConfig.mockClear();
    mockUrlQuery = undefined;
  });

  it('loads the saved query over the empty one the app wrote to the URL, and its tab', () => {
    // Opening #/view/<id>: the app has written its default (empty) query to the URL already.
    mockUrlQuery = { query: '', language: 'PPL' };
    mockSaved = savedSearch('source = spans | stats count() by serviceName', 'traces');
    renderHook(() => useInitPage());
    expect(queryStates()).toEqual(['source = spans | stats count() by serviceName']);
    expect(activeTabs()).toEqual([AGENT_TRACES_VISUALIZATION_TAB_ID]);
  });

  it('keeps a query the URL carries (a shared or reloaded edit)', () => {
    mockUrlQuery = { query: 'source = spans | head 5', language: 'PPL' };
    mockSaved = savedSearch('source = spans | stats count() by serviceName', 'traces');
    renderHook(() => useInitPage());
    expect(queryStates()).toEqual(['source = spans | head 5']);
  });

  it('opens a saved search on the tab it was saved on', () => {
    mockSaved = savedSearch('source = spans | where status = 2', 'sessions');
    renderHook(() => useInitPage());
    expect(activeTabs()).toEqual(['sessions']);
  });

  it('opens a saved stats query on Visualization, whatever tab it was saved on', () => {
    mockSaved = savedSearch('source = spans | stats count() by serviceName', 'traces');
    renderHook(() => useInitPage());
    expect(activeTabs()).toEqual([AGENT_TRACES_VISUALIZATION_TAB_ID]);
  });

  it('restores the saved chart: type, axes and styles', () => {
    mockSaved = {
      ...savedSearch('source = spans | stats count() by serviceName', 'visualization'),
      visualization: JSON.stringify({
        title: 'Spans',
        description: 'Per service',
        chartType: 'line',
        params: { addLegend: true },
        axesMapping: { x: 'day', y: 'count()' },
        splitField: 'serviceName',
        splitLayout: 'grid',
        showSplitLabel: true,
      }),
    };
    renderHook(() => useInitPage());
    expect(mockSetVisConfig).toHaveBeenCalledWith({
      type: 'line',
      title: 'Spans',
      description: 'Per service',
      styles: { addLegend: true },
      axesMapping: { x: 'day', y: 'count()' },
      splitField: 'serviceName',
      splitLayout: 'grid',
      showSplitLabel: true,
    });
  });

  it('leaves the chart alone for a saved search without one', () => {
    mockSaved = savedSearch('source = spans', 'traces');
    renderHook(() => useInitPage());
    expect(mockSetVisConfig).not.toHaveBeenCalled();
  });
});
