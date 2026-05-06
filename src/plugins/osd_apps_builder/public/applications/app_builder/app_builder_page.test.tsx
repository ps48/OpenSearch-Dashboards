/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppBuilderPage } from './app_builder_page';

jest.mock('../../components/live_preview', () => ({
  LivePreview: ({ code }: { code: string }) => (
    <div data-test-subj="osdAppsPreviewMock">{code ? 'Preview active' : 'No preview'}</div>
  ),
}));
jest.mock('../../components/canvas_empty_animation', () => ({
  CanvasEmptyAnimation: () => <div data-test-subj="osdAppsAnimation">animation</div>,
}));
jest.mock('../../services/scoped_api', () => ({
  createScopedApi: () => ({
    search: jest.fn(),
    theme: { isDarkMode: false },
    timeRange: { from: 'now-15m', to: 'now' },
    navigateToApp: jest.fn(),
  }),
}));

const mockCore = {
  http: {},
  notifications: { toasts: { addDanger: jest.fn(), addSuccess: jest.fn(), addWarning: jest.fn() } },
  savedObjects: { client: { find: jest.fn().mockResolvedValue({ savedObjects: [] }) } },
  uiSettings: { get: jest.fn().mockReturnValue(false) },
  application: { navigateToApp: jest.fn() },
} as any;
const mockData = {
  search: { search: jest.fn() },
  query: { timefilter: { timefilter: { getTime: () => ({ from: 'now-15m', to: 'now' }) } } },
} as any;

describe('AppBuilderPage', () => {
  it('renders landing view with prompt input', async () => {
    render(
      <AppBuilderPage
        core={mockCore}
        data={mockData}
        savedObjectsClient={mockCore.savedObjects.client}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('What do you want to build?')).toBeInTheDocument();
      expect(screen.getByTestId('osdAppsPromptInput')).toBeInTheDocument();
    });
  });

  it('renders the animation on landing', async () => {
    render(
      <AppBuilderPage
        core={mockCore}
        data={mockData}
        savedObjectsClient={mockCore.savedObjects.client}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('osdAppsAnimation')).toBeInTheDocument();
    });
  });

  it('renders suggestion chips', async () => {
    render(
      <AppBuilderPage
        core={mockCore}
        data={mockData}
        savedObjectsClient={mockCore.savedObjects.client}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/log explorer/i)).toBeInTheDocument();
    });
  });

  it('renders generate button', async () => {
    render(
      <AppBuilderPage
        core={mockCore}
        data={mockData}
        savedObjectsClient={mockCore.savedObjects.client}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('Generate')).toBeInTheDocument();
    });
  });
});
