/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

module.exports = {
  presets: [
    ['@babel/preset-typescript', { allowNamespaces: true, onlyRemoveTypeImports: true }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
  plugins: [
    '@babel/plugin-transform-class-properties',
    '@babel/plugin-transform-private-methods',
    'babel-plugin-add-module-exports',
    '@babel/plugin-transform-optional-chaining',
    '@babel/plugin-transform-nullish-coalescing-operator',
    '@babel/plugin-transform-export-namespace-from',
    '@babel/plugin-transform-logical-assignment-operators',
  ],
  env: {
    web: {
      presets: ['@osd/babel-preset/webpack_preset'],
    },
    node: {
      presets: ['@osd/babel-preset/node_preset'],
    },
  },
  ignore: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.stories.tsx'],
};
