/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderAppCode } from './app_renderer';
import { OsdAppApi } from './scoped_api';

// Mock the transpiler
jest.mock('./code_transpiler', () => ({
  transpileCode: jest.fn(async (source: string) => {
    return { code: source, error: null };
  }),
}));

const mockApi: OsdAppApi = {
  search: jest.fn(),
  theme: { isDarkMode: false },
  timeRange: { from: 'now-15m', to: 'now' },
  navigateToApp: jest.fn(),
};

describe('renderAppCode', () => {
  it('returns null component for empty code', async () => {
    const result = await renderAppCode('', mockApi);
    expect(result.component).toBeNull();
    expect(result.error).toBeNull();
  });

  it('renders a simple component from valid transpiled code', async () => {
    const code = `
      var React = require('react');
      exports.default = function App() { return React.createElement('div', null, 'Hello'); };
    `;
    const result = await renderAppCode(code, mockApi);
    expect(result.error).toBeNull();
    expect(result.component).not.toBeNull();
    expect(typeof result.component).toBe('function');
  });

  it('returns error when code does not export a component', async () => {
    const code = `exports.default = 'not a function';`;
    const result = await renderAppCode(code, mockApi);
    expect(result.component).toBeNull();
    expect(result.error).toContain('must export a default React component');
  });

  it('returns error when code throws during execution', async () => {
    const code = `throw new Error('boom');`;
    const result = await renderAppCode(code, mockApi);
    expect(result.component).toBeNull();
    expect(result.error).toContain('Execution error');
  });

  it('strips markdown fences before executing', async () => {
    const code =
      '```javascript\nvar React = require("react");\nexports.default = function() { return React.createElement("div", null, "Hi"); };\n```';
    const result = await renderAppCode(code, mockApi);
    expect(result.error).toBeNull();
    expect(result.component).not.toBeNull();
  });
});
