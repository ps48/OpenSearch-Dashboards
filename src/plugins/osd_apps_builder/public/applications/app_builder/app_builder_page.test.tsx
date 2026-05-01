/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppBuilderPage } from './app_builder_page';

// Mock LivePreview to avoid transpiler/renderer complexity in tests
jest.mock('../../components/live_preview', () => ({
  LivePreview: ({ code }: { code: string }) => (
    <div data-test-subj="osdAppsPreviewMock">{code ? 'Preview active' : 'No preview'}</div>
  ),
}));

// Mock scoped_api
jest.mock('../../services/scoped_api', () => ({
  createScopedApi: () => ({
    search: jest.fn(),
    theme: { isDarkMode: false },
    timeRange: { from: 'now-15m', to: 'now' },
    navigateToApp: jest.fn(),
  }),
}));

const mockSavedObjectsClient = {
  find: jest.fn().mockResolvedValue({ savedObjects: [] }),
} as any;

const mockCore = {
  http: {},
  notifications: { toasts: { addDanger: jest.fn(), addSuccess: jest.fn() } },
  savedObjects: { client: mockSavedObjectsClient },
  uiSettings: { get: jest.fn().mockReturnValue(false) },
  application: { navigateToApp: jest.fn() },
} as any;

const mockData = {
  search: { search: jest.fn() },
  query: {
    timefilter: { timefilter: { getTime: () => ({ from: 'now-15m', to: 'now' }) } },
  },
} as any;

describe('AppBuilderPage', () => {
  it('renders prompt suggestions when history is empty', async () => {
    render(
      <AppBuilderPage core={mockCore} data={mockData} savedObjectsClient={mockSavedObjectsClient} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsPromptSuggestions')).toBeInTheDocument();
    });
  });

  it('renders the prompt input', async () => {
    render(
      <AppBuilderPage core={mockCore} data={mockData} savedObjectsClient={mockSavedObjectsClient} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsPromptInput')).toBeInTheDocument();
    });
  });

  it('renders the resizable container', async () => {
    render(
      <AppBuilderPage core={mockCore} data={mockData} savedObjectsClient={mockSavedObjectsClient} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsBuilderContainer')).toBeInTheDocument();
    });
  });

  it('renders the preview pane', async () => {
    render(
      <AppBuilderPage core={mockCore} data={mockData} savedObjectsClient={mockSavedObjectsClient} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsPreviewMock')).toBeInTheDocument();
    });
  });
});
