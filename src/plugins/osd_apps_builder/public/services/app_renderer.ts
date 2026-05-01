/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { validateCode } from '../../common/code_validator';
import { transpileCode } from './code_transpiler';
import { OsdAppApi } from './scoped_api';

export interface RenderResult {
  component: React.ComponentType<{ api: OsdAppApi }> | null;
  error: string | null;
}

/**
 * Module registry provided to generated app code.
 */
export function createModuleRegistry(api: OsdAppApi) {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const react = require('react');
  const eui = require('@elastic/eui');
  let echarts: any = {};
  try {
    echarts = require('echarts');
  } catch (e) {
    /* echarts not available */
  }
  /* eslint-enable @typescript-eslint/no-var-requires */

  return {
    react,
    '@elastic/eui': eui,
    '@osd-apps/api': api,
    echarts,
    'echarts-for-react': { default: null }, // Not installed — use echarts directly
  };
}

function stripMarkdownFences(code: string): string {
  let cleaned = code
    .replace(/^```(?:javascript|js|typescript|ts)?\s*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .trim();

  // Replace template literals with string concatenation
  cleaned = cleaned.replace(/`([^`]*)`/g, function (match: string, content: string) {
    if (content.indexOf('${') === -1) {
      return "'" + content.replace(/'/g, "\\'") + "'";
    }
    const parts = content.split(/\$\{([^}]+)\}/);
    let result = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) result += (result ? ' + ' : '') + "'" + parts[i].replace(/'/g, "\\'") + "'";
      } else {
        result += (result ? ' + ' : '') + '(' + parts[i] + ')';
      }
    }
    return result || "''";
  });

  return cleaned;
}

/**
 * Renders AI-generated code into a React component.
 * Pipeline: clean → validate → transpile → execute → extract default export
 *
 * Validation errors and execution errors are returned (not thrown)
 * so the caller can feed them back to the LLM for auto-repair.
 */
export async function renderAppCode(code: string, api: OsdAppApi): Promise<RenderResult> {
  if (!code.trim()) {
    return { component: null, error: null };
  }

  // 1. Clean up
  const cleaned = stripMarkdownFences(code);

  // 2. Client-side validation (defense-in-depth)
  const validation = validateCode(cleaned);
  if (!validation.valid) {
    const messages = validation.errors
      .map((e) => `Line ${e.line}: [${e.rule}] ${e.message}`)
      .join('\n');
    return { component: null, error: `Validation failed:\n${messages}` };
  }

  // 3. Transpile (import/export rewriting)
  const transpiled = await transpileCode(cleaned);
  if (transpiled.error || !transpiled.code) {
    return { component: null, error: transpiled.error ?? 'Transpilation produced no output' };
  }

  // 4. Execute in scoped module context
  try {
    const moduleRegistry = createModuleRegistry(api);
    const exports: Record<string, any> = {};
    const module = { exports };

    const scopedRequire = (name: string) => {
      if (moduleRegistry[name as keyof typeof moduleRegistry]) {
        return moduleRegistry[name as keyof typeof moduleRegistry];
      }
      throw new Error(`Module '${name}' is not available in OSD Apps`);
    };

    const fn = new Function('require', 'exports', 'module', 'React', transpiled.code);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fn(scopedRequire, exports, module, require('react'));

    // 5. Extract the default export
    const Component = module.exports.default || module.exports;
    if (typeof Component !== 'function') {
      return { component: null, error: 'Generated code must export a default React component' };
    }

    return { component: Component, error: null };
  } catch (err) {
    return { component: null, error: `Execution error: ${err}` };
  }
}
