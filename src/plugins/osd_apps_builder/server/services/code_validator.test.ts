/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { validateCode } from './code_validator';

describe('validateCode', () => {
  describe('valid code', () => {
    it('accepts a simple React/OUI component', () => {
      const code = `
        import React from 'react';
        import { EuiButton } from '@elastic/eui';
        export default () => <EuiButton>Click</EuiButton>;
      `;
      const result = validateCode(code);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts echarts-for-react usage', () => {
      const code = `
        import React from 'react';
        import ReactECharts from 'echarts-for-react';
        export default () => <ReactECharts option={{}} />;
      `;
      expect(validateCode(code).valid).toBe(true);
    });

    it('accepts @osd-apps/api usage', () => {
      const code = `
        import { search } from '@osd-apps/api';
        import React from 'react';
        export default () => <div>App</div>;
      `;
      expect(validateCode(code).valid).toBe(true);
    });

    it('accepts echarts import', () => {
      const code = `import * as echarts from 'echarts';`;
      expect(validateCode(code).valid).toBe(true);
    });
  });

  describe('blocked patterns', () => {
    it('rejects eval()', () => {
      const code = `eval('alert(1)');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-eval');
    });

    it('rejects new Function()', () => {
      const code = `const fn = Function('return 1');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-eval');
    });

    it('rejects document.cookie', () => {
      const code = `const c = document.cookie;`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-document-access');
    });

    it('rejects document.domain', () => {
      const code = `const d = document.domain;`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-document-access');
    });

    it('rejects localStorage access', () => {
      const code = `localStorage.getItem('x');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-storage-access');
    });

    it('rejects sessionStorage access', () => {
      const code = `sessionStorage.setItem('x', 'y');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-storage-access');
    });

    it('rejects fetch()', () => {
      const code = `fetch('https://evil.com');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-network-access');
    });

    it('rejects XMLHttpRequest()', () => {
      const code = `new XMLHttpRequest();`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-network-access');
    });

    it('rejects WebSocket()', () => {
      const code = `new WebSocket('ws://evil.com');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-network-access');
    });

    it('rejects innerHTML assignment', () => {
      const code = `el.innerHTML = '<script>alert(1)</script>';`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-inner-html');
    });

    it('rejects outerHTML assignment', () => {
      const code = `el.outerHTML = '<div>hack</div>';`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-inner-html');
    });

    it('rejects dangerouslySetInnerHTML', () => {
      const code = `
        import React from 'react';
        export default () => <div dangerouslySetInnerHTML={{__html: '<script>'}} />;
      `;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-dangerous-html');
    });

    it('rejects window.location assignment', () => {
      const code = `window.location = 'https://evil.com';`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-navigation');
    });

    it('rejects unauthorized imports', () => {
      const code = `import axios from 'axios';`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-unauthorized-import');
    });

    it('rejects dynamic import()', () => {
      const code = `const mod = import('lodash');`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('no-dynamic-import');
    });
  });

  describe('edge cases', () => {
    it('returns parse error for invalid syntax', () => {
      const code = `const x = {{{`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors[0].rule).toBe('parse-error');
    });

    it('catches multiple violations in one file', () => {
      const code = `
        eval('x');
        fetch('https://evil.com');
        import axios from 'axios';
      `;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('reports line numbers for errors', () => {
      const code = `const x = 1;\neval('alert(1)');`;
      const result = validateCode(code);
      expect(result.errors[0].line).toBe(2);
    });
  });
});
