/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LivePreview } from './live_preview';
import { OsdAppApi } from '../services/scoped_api';

// Mock app_renderer
jest.mock('../services/app_renderer', () => ({
  renderAppCode: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderAppCode } = require('../services/app_renderer');

const mockApi: OsdAppApi = {
  search: jest.fn(),
  theme: { isDarkMode: false },
  timeRange: { from: 'now-15m', to: 'now' },
  navigateToApp: jest.fn(),
};

describe('LivePreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows empty state when code is empty', () => {
    render(<LivePreview code="" scopedApi={mockApi} />);
    expect(screen.getByTestId('osdAppsPreviewEmpty')).toBeInTheDocument();
  });

  it('shows error when rendering fails', async () => {
    renderAppCode.mockResolvedValue({
      component: null,
      error: 'Validation failed: no-eval',
    });

    render(<LivePreview code="eval('x')" scopedApi={mockApi} />);

    // Advance past debounce
    jest.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByTestId('osdAppsPreviewError')).toBeInTheDocument();
    });
  });

  it('renders component when code is valid', async () => {
    const MockComponent: React.FC<{ api: OsdAppApi }> = () => <div>Hello from app</div>;
    renderAppCode.mockResolvedValue({
      component: MockComponent,
      error: null,
    });

    render(<LivePreview code="export default () => <div>Hello</div>" scopedApi={mockApi} />);

    jest.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Hello from app')).toBeInTheDocument();
    });
  });
});
