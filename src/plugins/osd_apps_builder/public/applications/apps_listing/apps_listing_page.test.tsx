/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppsListingPage } from './apps_listing_page';
import { SAVED_OBJECT_TYPE } from '../../../common/constants';

// Mock LivePreview
jest.mock('../../components/live_preview', () => ({
  LivePreview: () => 'preview-mock',
}));

jest.mock('../../services/scoped_api', () => ({
  createScopedApi: () => ({
    search: jest.fn(),
    theme: { isDarkMode: false },
    timeRange: { from: 'now-15m', to: 'now' },
    navigateToApp: jest.fn(),
  }),
}));

jest.mock('../../sample_apps', () => ({
  SAMPLE_APPS: [
    {
      id: 'log-viewer',
      title: 'Log Viewer',
      description: 'View logs',
      icon: 'logsApp',
      getCode: () => 'code',
    },
    {
      id: 'metrics-dashboard',
      title: 'Metrics Dashboard',
      description: 'View metrics',
      icon: 'visLine',
      getCode: () => 'code',
    },
    {
      id: 'search-form',
      title: 'Search Form',
      description: 'Search docs',
      icon: 'search',
      getCode: () => 'code',
    },
  ],
}));

const mockNavigateToApp = jest.fn();

const createMockSavedObjectsClient = (savedObjects: any[] = []) => ({
  find: jest.fn().mockResolvedValue({ savedObjects }),
});

const createMockNotifications = () => ({
  toasts: { addSuccess: jest.fn(), addDanger: jest.fn(), addWarning: jest.fn() },
});

const defaultProps = {
  savedObjectsClient: createMockSavedObjectsClient() as any,
  notifications: createMockNotifications() as any,
  application: { navigateToApp: mockNavigateToApp } as any,
};

describe('AppsListingPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders sample apps section', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Sample Apps')).toBeInTheDocument();
      expect(screen.getByText('Log Viewer')).toBeInTheDocument();
      expect(screen.getByText('Metrics Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Search Form')).toBeInTheDocument();
    });
  });

  it('renders empty state when no user apps exist', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('No apps yet')).toBeInTheDocument();
    });
  });

  it('calls savedObjectsClient.find with correct type', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(defaultProps.savedObjectsClient.find).toHaveBeenCalledWith(
        expect.objectContaining({ type: SAVED_OBJECT_TYPE })
      );
    });
  });

  it('renders table with apps when apps are loaded', async () => {
    const client = createMockSavedObjectsClient([
      {
        id: 'app-1',
        attributes: {
          title: 'My Test App',
          description: 'A test',
          tags: ['test'],
          updatedAt: '2026-04-30T00:00:00Z',
        },
      },
    ]);
    render(<AppsListingPage {...defaultProps} savedObjectsClient={client as any} />);
    await waitFor(() => {
      expect(screen.getByText('My Test App')).toBeInTheDocument();
    });
  });

  it('has a create app button', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('osdAppsCreateButton')).toBeInTheDocument();
    });
  });

  it('has preview buttons for sample apps', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('osdAppsSamplePreview-log-viewer')).toBeInTheDocument();
    });
  });
});
