/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { HttpStart } from '../../../../core/public';

export interface IndexMetadata {
  indexName: string;
  fields: Array<{ name: string; type: string }>;
  sampleDocs: Array<Record<string, any>>;
  totalFields: number;
}

export async function fetchIndexMetadata(
  http: HttpStart,
  indexName: string
): Promise<IndexMetadata> {
  return http.post('/api/osd-apps/index-metadata', {
    body: JSON.stringify({ indexName }),
  });
}
