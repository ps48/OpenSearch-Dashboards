/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoreStart } from '../../../../core/public';
import { DataPublicPluginStart } from '../../../data/public';

export interface OsdAppApi {
  search(params: {
    query: string;
    language: 'PPL' | 'PromQL';
    dataset?: { dataSource?: { id: string; type: string }; title: string; type: string };
  }): Promise<any>;
  theme: { isDarkMode: boolean };
  timeRange: { from: string; to: string };
  navigateToApp(appId: string, options?: { path?: string }): void;
}

/**
 * Transform the query enhancements API response to a normalized format.
 *
 * New format: { fields: [{name, values: [...]}, ...], size: N }
 * Old format: { datarows: [[...], ...], schema: [{name, type}, ...] }
 * Both → { jsonData: [{field1: val, ...}, ...], size: N }
 */
function transformResponse(response: any): any {
  // Unwrap data_frame envelope: { type: "data_frame", body: { fields: [...], size: N } }
  let body = response;
  if (response?.type === 'data_frame' && response?.body) {
    body = response.body;
  }
  if (response?.body?.type === 'data_frame' && response?.body?.body) {
    body = response.body.body;
  }

  // New format: fields array with values
  if (body.fields && Array.isArray(body.fields)) {
    const size = body.size || 0;
    const jsonData: Array<Record<string, any>> = [];
    for (let i = 0; i < size; i++) {
      const row: Record<string, any> = {};
      body.fields.forEach((field: any) => {
        row[field.name] = field.values?.[i];
      });
      // Flatten nested objects so dot-notation access works
      // e.g., row.resource = { attributes: { service: { name: "x" } } }
      // → row['resource.attributes.service.name'] = "x"
      const flat: Record<string, any> = {};
      const flatten = (obj: any, prefix: string) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          flat[prefix] = obj;
          return;
        }
        // Keep the original key too for direct access
        flat[prefix] = obj;
        for (const k of Object.keys(obj)) {
          flatten(obj[k], prefix ? prefix + '.' + k : k);
        }
      };
      for (const k of Object.keys(row)) {
        flatten(row[k], k);
      }
      jsonData.push(flat);
    }
    return { schema: body.schema, jsonData, size };
  }

  // Old format: datarows
  if (body.datarows && Array.isArray(body.datarows)) {
    const jsonData = body.datarows.map((row: any[]) => {
      const rowObject: Record<string, any> = {};
      body.schema?.forEach((field: any, index: number) => {
        rowObject[field.name] = row[index];
      });
      return rowObject;
    });
    return { ...body, jsonData };
  }

  return body;
}

export function createScopedApi(deps: { data: DataPublicPluginStart; core: CoreStart }): OsdAppApi {
  return {
    search: async (params) => {
      const { query, language, dataset } = params;

      if (language === 'PPL') {
        // Extract index name from PPL source= clause for the dataset
        const sourceMatch = query.match(/source\s*=\s*([^\s|]+)/i);
        const indexName = dataset?.title || (sourceMatch ? sourceMatch[1] : undefined);

        // For local cluster, dataSource id should be empty string
        // For remote data sources, it should be the data source connection saved object ID
        const dataSourceId = dataset?.dataSource?.id ?? '';

        const requestBody = {
          query: {
            query,
            language: 'PPL',
            dataset: indexName
              ? {
                  id: indexName,
                  title: indexName,
                  type: 'INDEXES',
                  dataSource: {
                    id: dataSourceId,
                    type: 'DATA_SOURCE',
                  },
                }
              : undefined,
            format: 'jdbc',
          },
        };

        const response = await deps.core.http.post('/api/enhancements/search/ppl', {
          body: JSON.stringify(requestBody),
        });
        return transformResponse(response);
      }

      if (language === 'PromQL') {
        // Use query enhancements PromQL API
        const requestBody = {
          query: {
            query,
            language: 'PromQL',
            dataset: dataset
              ? {
                  id: dataset.title,
                  title: dataset.title,
                  type: 'PROMETHEUS',
                  ...(dataset.dataSource && { dataSource: dataset.dataSource }),
                }
              : undefined,
          },
        };

        const response = await deps.core.http.post('/api/enhancements/search/promql', {
          body: JSON.stringify(requestBody),
        });
        return transformResponse(response);
      }

      throw new Error('Unsupported query language: ' + language);
    },

    get theme() {
      return {
        isDarkMode: deps.core.uiSettings.get('theme:darkMode', false),
      };
    },

    get timeRange() {
      const time = deps.data.query.timefilter.timefilter.getTime();
      return { from: time.from, to: time.to };
    },

    navigateToApp: (appId, options) => {
      deps.core.application.navigateToApp(appId, options);
    },
  };
}
