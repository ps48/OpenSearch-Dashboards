/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppViewerPage } from './app_viewer_page';

// Mock LivePreview
jest.mock('../../components/live_preview', () => ({
  LivePreview: ({ code }: { code: string }) => (
    <div data-test-subj="osdAppsPreviewMock">{code}</div>
  ),
}));

jest.mock('../../services/scoped_api', () => ({
  createScopedApi: () => ({
    search: jest.fn(),
    theme: { isDarkMode: false },
    timeRange: { from: 'now-15m', to: 'now' },
    navigateToApp: jest.fn(),
  }),
}));

jest.mock('../../services/app_saved_object_client', () => ({
  AppSavedObjectClient: jest.fn().mockImplementation(() => ({
    load: jest.fn(),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppSavedObjectClient } = require('../../services/app_saved_object_client');

const mockCore = {
  savedObjects: { client: {} },
  chrome: { setBreadcrumbs: jest.fn() },
  application: { navigateToApp: jest.fn() },
  notifications: { toasts: { addSuccess: jest.fn(), addDanger: jest.fn() } },
  uiSettings: { get: jest.fn().mockReturnValue(false) },
  http: {},
} as any;

const mockData = {
  search: { search: jest.fn() },
  query: { timefilter: { timefilter: { getTime: () => ({ from: 'now-15m', to: 'now' }) } } },
} as any;

describe('AppViewerPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state initially', () => {
    AppSavedObjectClient.mockImplementation(() => ({
      load: jest.fn().mockReturnValue(new Promise(() => {})), // never resolves
    }));

    render(<AppViewerPage appId="test-id" core={mockCore} data={mockData} />);
    expect(screen.getByTestId('osdAppsViewerLoading')).toBeInTheDocument();
  });

  it('shows not found when load fails', async () => {
    AppSavedObjectClient.mockImplementation(() => ({
      load: jest.fn().mockRejectedValue(new Error('Not found')),
    }));

    render(<AppViewerPage appId="bad-id" core={mockCore} data={mockData} />);

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsViewerNotFound')).toBeInTheDocument();
    });
  });

  it('renders app and sets breadcrumbs on success', async () => {
    AppSavedObjectClient.mockImplementation(() => ({
      load: jest.fn().mockResolvedValue({
        title: 'My App',
        sourceCode: 'export default () => <div>Hello</div>',
      }),
    }));

    render(<AppViewerPage appId="app-1" core={mockCore} data={mockData} />);

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsPreviewMock')).toBeInTheDocument();
      expect(mockCore.chrome.setBreadcrumbs).toHaveBeenCalledWith([
        { text: 'Apps', href: '/app/osd-apps' },
        { text: 'My App' },
      ]);
    });
  });

  it('renders Edit button', async () => {
    AppSavedObjectClient.mockImplementation(() => ({
      load: jest.fn().mockResolvedValue({ title: 'App', sourceCode: 'code' }),
    }));

    render(<AppViewerPage appId="app-1" core={mockCore} data={mockData} />);

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsViewerEditButton')).toBeInTheDocument();
    });
  });
});
