/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DataSourceRef {
  id: string;
  type: 'DATA_SOURCE' | 'PROMETHEUS';
  title: string;
}

export interface PromptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface OsdAppAttributes {
  title: string;
  description: string;
  author: string;
  version: number;
  sourceCode: string;
  dataSourceRefs: string; // JSON-serialized DataSourceRef[]
  promptHistory: string; // JSON-serialized PromptEntry[]
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
