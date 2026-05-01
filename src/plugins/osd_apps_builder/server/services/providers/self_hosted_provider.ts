/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIProvider, AppGenerationContext } from './types';

export class SelfHostedProvider implements AIProvider {
  public readonly id = 'self-hosted';

  async *generateApp(_prompt: string, _context: AppGenerationContext): AsyncIterable<string> {
    throw new Error(
      'Self-hosted provider is not configured. Set osdAppsBuilder.provider in opensearch_dashboards.yml'
    );
  }

  async *refineApp(
    _prompt: string,
    _existingCode: string,
    _context: AppGenerationContext
  ): AsyncIterable<string> {
    throw new Error(
      'Self-hosted provider is not configured. Set osdAppsBuilder.provider in opensearch_dashboards.yml'
    );
  }
}
