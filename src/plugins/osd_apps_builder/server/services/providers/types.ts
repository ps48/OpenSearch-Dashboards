/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AppGenerationContext {
  indexMetadata?: Array<{ title: string; fields: Array<{ name: string; type: string }> }>;
  dataSourceRefs?: Array<{ id: string; type: string; title: string }>;
  existingCode?: string;
  componentLibrary: 'oui+echarts';
}

export interface AIProvider {
  id: string;
  generateApp(prompt: string, context: AppGenerationContext): AsyncIterable<string>;
  refineApp(
    prompt: string,
    existingCode: string,
    context: AppGenerationContext
  ): AsyncIterable<string>;
}
