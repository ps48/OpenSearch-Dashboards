/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import {
  CallExpression,
  MemberExpression,
  ImportDeclaration,
  AssignmentExpression,
  JSXAttribute,
} from '@babel/types';

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  rule: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ALLOWED_IMPORTS = new Set([
  'react',
  '@elastic/eui',
  'echarts',
  'echarts-for-react',
  '@osd-apps/api',
]);

const BLOCKED_GLOBALS = new Set(['eval', 'Function']);

const BLOCKED_MEMBER_ROOTS: Record<string, Set<string>> = {
  document: new Set(['cookie', 'domain']),
  window: new Set(['location']),
};

const BLOCKED_IDENTIFIERS = new Set(['localStorage', 'sessionStorage']);

const BLOCKED_CALL_NAMES = new Set(['fetch', 'XMLHttpRequest', 'WebSocket']);

const BLOCKED_ASSIGNMENTS = new Set(['innerHTML', 'outerHTML']);

function addError(errors: ValidationError[], path: NodePath, message: string, rule: string) {
  errors.push({
    line: path.node.loc?.start.line ?? 0,
    column: path.node.loc?.start.column ?? 0,
    message,
    rule,
  });
}

export function validateCode(code: string): ValidationResult {
  const errors: ValidationError[] = [];

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err) {
    return {
      valid: false,
      errors: [{ line: 0, column: 0, message: `Parse error: ${err}`, rule: 'parse-error' }],
    };
  }

  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const { callee } = path.node;

      // Block eval() and Function()
      if (callee.type === 'Identifier' && BLOCKED_GLOBALS.has(callee.name)) {
        addError(errors, path, `'${callee.name}()' is not allowed`, 'no-eval');
      }

      // Block fetch(), XMLHttpRequest(), WebSocket()
      if (callee.type === 'Identifier' && BLOCKED_CALL_NAMES.has(callee.name)) {
        addError(errors, path, `'${callee.name}()' is not allowed`, 'no-network-access');
      }

      // Block dynamic import()
      if (callee.type === 'Import') {
        addError(errors, path, 'Dynamic import() is not allowed', 'no-dynamic-import');
      }

      // Check require() calls against allowlist
      if (
        callee.type === 'Identifier' &&
        callee.name === 'require' &&
        path.node.arguments.length === 1 &&
        path.node.arguments[0].type === 'StringLiteral'
      ) {
        const source = path.node.arguments[0].value;
        if (!ALLOWED_IMPORTS.has(source)) {
          addError(
            errors,
            path,
            `require('${source}') is not allowed. Allowed: ${[...ALLOWED_IMPORTS].join(', ')}`,
            'no-unauthorized-import'
          );
        }
      }
    },

    MemberExpression(path: NodePath<MemberExpression>) {
      const { object, property } = path.node;

      // Block document.cookie, document.domain
      if (
        object.type === 'Identifier' &&
        property.type === 'Identifier' &&
        BLOCKED_MEMBER_ROOTS[object.name]?.has(property.name)
      ) {
        addError(
          errors,
          path,
          `'${object.name}.${property.name}' is not allowed`,
          'no-document-access'
        );
      }

      // Block localStorage, sessionStorage access
      if (object.type === 'Identifier' && BLOCKED_IDENTIFIERS.has(object.name)) {
        addError(errors, path, `'${object.name}' access is not allowed`, 'no-storage-access');
      }
    },

    AssignmentExpression(path: NodePath<AssignmentExpression>) {
      const { left } = path.node;

      // Block innerHTML/outerHTML assignment
      if (
        left.type === 'MemberExpression' &&
        left.property.type === 'Identifier' &&
        BLOCKED_ASSIGNMENTS.has(left.property.name)
      ) {
        addError(
          errors,
          path,
          `Assignment to '${left.property.name}' is not allowed`,
          'no-inner-html'
        );
      }

      // Block window.location assignment
      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        left.object.name === 'window' &&
        left.property.type === 'Identifier' &&
        left.property.name === 'location'
      ) {
        addError(errors, path, "'window.location' assignment is not allowed", 'no-navigation');
      }
    },

    ImportDeclaration(path: NodePath<ImportDeclaration>) {
      const source = path.node.source.value;
      if (!ALLOWED_IMPORTS.has(source)) {
        addError(
          errors,
          path,
          `Import from '${source}' is not allowed. Allowed: ${[...ALLOWED_IMPORTS].join(', ')}`,
          'no-unauthorized-import'
        );
      }
    },

    NewExpression(path) {
      const { callee } = path.node;
      if (callee.type === 'Identifier' && BLOCKED_CALL_NAMES.has(callee.name)) {
        addError(errors, path, `'new ${callee.name}()' is not allowed`, 'no-network-access');
      }
    },

    JSXAttribute(path: NodePath<JSXAttribute>) {
      if (
        path.node.name.type === 'JSXIdentifier' &&
        path.node.name.name === 'dangerouslySetInnerHTML'
      ) {
        addError(errors, path, "'dangerouslySetInnerHTML' is not allowed", 'no-dangerous-html');
      }
    },
  });

  return { valid: errors.length === 0, errors };
}
