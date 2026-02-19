/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss)$': '<rootDir>/../../src/dev/jest/mocks/style_mock.js',
    '\\.(svg|jpg|jpeg|png|gif)$': '<rootDir>/../../src/dev/jest/mocks/file_mock.js',
  },
  setupFilesAfterSetup: ['./src/test_utils/jest_setup.ts'],
};
