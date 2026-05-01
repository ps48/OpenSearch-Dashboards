/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createScopedApi } from './scoped_api';

describe('createScopedApi', () => {
  const mockCore = {
    uiSettings: { get: jest.fn().mockReturnValue(false) },
    application: { navigateToApp: jest.fn() },
    http: {
      post: jest.fn().mockResolvedValue({ jsonData: [{ count: 1 }], size: 1 }),
    },
  } as any;

  const mockData = {
    query: {
      timefilter: {
        timefilter: {
          getTime: jest.fn().mockReturnValue({ from: 'now-15m', to: 'now' }),
        },
      },
    },
  } as any;

  it('returns theme.isDarkMode from uiSettings', () => {
    const api = createScopedApi({ core: mockCore, data: mockData });
    expect(api.theme.isDarkMode).toBe(false);
    expect(mockCore.uiSettings.get).toHaveBeenCalledWith('theme:darkMode', false);
  });

  it('returns timeRange from timefilter', () => {
    const api = createScopedApi({ core: mockCore, data: mockData });
    expect(api.timeRange).toEqual({ from: 'now-15m', to: 'now' });
  });

  it('delegates navigateToApp to core.application', () => {
    const api = createScopedApi({ core: mockCore, data: mockData });
    api.navigateToApp('discover', { path: '/test' });
    expect(mockCore.application.navigateToApp).toHaveBeenCalledWith('discover', { path: '/test' });
  });

  it('calls PPL enhancements API for PPL queries', async () => {
    const api = createScopedApi({ core: mockCore, data: mockData });
    await api.search({ query: 'source=test | head 10', language: 'PPL' });
    expect(mockCore.http.post).toHaveBeenCalledWith(
      '/api/enhancements/search/ppl',
      expect.objectContaining({
        body: expect.stringContaining('source=test'),
      })
    );
  });

  it('calls PromQL enhancements API for PromQL queries', async () => {
    const api = createScopedApi({ core: mockCore, data: mockData });
    await api.search({ query: 'up{job="test"}', language: 'PromQL' });
    expect(mockCore.http.post).toHaveBeenCalledWith(
      '/api/enhancements/search/promql',
      expect.objectContaining({
        body: expect.stringContaining('up{job='),
      })
    );
  });
});
