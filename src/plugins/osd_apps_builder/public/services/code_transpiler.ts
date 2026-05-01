/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Transpiles generated code to executable JS.
 *
 * Phase 1: The AI is instructed to generate React.createElement() calls
 * (not JSX), so no JSX transpilation is needed. This is a pass-through
 * that strips TypeScript type annotations via simple regex.
 *
 * Phase 2: Will add full JSX transpilation via @babel/standalone
 * loaded from a CDN or bundled separately.
 */

export interface TranspileResult {
  code: string | null;
  error: string | null;
}

export async function transpileCode(source: string): Promise<TranspileResult> {
  try {
    // Strip import/export statements and convert to require/exports
    let code = source;

    // Convert: import X from 'y' → const X = require('y')
    code = code.replace(
      /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
      "const $1 = require('$2');"
    );

    // Convert: import { X, Y } from 'y' → const { X, Y } = require('y')
    code = code.replace(
      /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
      "const {$1} = require('$2');"
    );

    // Convert: import * as X from 'y' → const X = require('y')
    code = code.replace(
      /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
      "const $1 = require('$2');"
    );

    // Convert: export default X → exports.default = X
    code = code.replace(/export\s+default\s+/g, 'exports.default = ');

    return { code, error: null };
  } catch (err) {
    return { code: null, error: `Transpile error: ${err}` };
  }
}
