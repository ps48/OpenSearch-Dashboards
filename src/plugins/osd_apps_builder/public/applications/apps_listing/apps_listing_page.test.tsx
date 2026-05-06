/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppsListingPage } from './apps_listing_page';
import { SAVED_OBJECT_TYPE } from '../../../common/constants';

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
      id: 'metrics',
      title: 'Metrics Dashboard',
      description: 'View metrics',
      icon: 'visLine',
      getCode: () => 'code',
    },
    {
      id: 'search',
      title: 'Search Form',
      description: 'Search docs',
      icon: 'search',
      getCode: () => 'code',
    },
  ],
}));

const mockNavigateToApp = jest.fn();
const createMockClient = (savedObjects: any[] = []) => ({
  find: jest.fn().mockResolvedValue({ savedObjects }),
  delete: jest.fn().mockResolvedValue({}),
});
const createMockNotifications = () => ({
  toasts: {
    addSuccess: jest.fn(),
    addDanger: jest.fn(),
    addWarning: jest.fn(),
    addInfo: jest.fn(),
  },
});
const defaultProps = {
  savedObjectsClient: createMockClient() as any,
  notifications: createMockNotifications() as any,
  application: { navigateToApp: mockNavigateToApp } as any,
};

describe('AppsListingPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders templates section', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Preview Examples')).toBeInTheDocument();
      expect(screen.getByText('Log Viewer')).toBeInTheDocument();
    });
  });

  it('renders empty state when no canvases exist', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Create your first canvas')).toBeInTheDocument();
    });
  });

  it('renders table with canvases', async () => {
    const client = createMockClient([
      {
        id: 'app-1',
        attributes: {
          title: 'My Canvas',
          description: 'Test',
          tags: ['demo'],
          updatedAt: '2026-05-01T00:00:00Z',
        },
      },
    ]);
    render(<AppsListingPage {...defaultProps} savedObjectsClient={client as any} />);
    await waitFor(() => {
      expect(screen.getByText('My Canvas')).toBeInTheDocument();
    });
  });

  it('renders the page', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Preview Examples')).toBeInTheDocument();
    });
  });

  it('renders template cards', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Log Viewer')).toBeInTheDocument();
      expect(screen.getByText('Metrics Dashboard')).toBeInTheDocument();
    });
  });

  it('calls savedObjectsClient.find', async () => {
    render(<AppsListingPage {...defaultProps} />);
    await waitFor(() => {
      expect(defaultProps.savedObjectsClient.find).toHaveBeenCalledWith(
        expect.objectContaining({ type: SAVED_OBJECT_TYPE })
      );
    });
  });
});
