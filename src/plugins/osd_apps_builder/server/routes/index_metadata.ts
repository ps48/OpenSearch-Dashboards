/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { schema } from '@osd/config-schema';
import { IRouter, Logger } from '../../../../core/server';

export function registerIndexMetadataRoute(router: IRouter, logger: Logger) {
  router.post(
    {
      path: '/api/osd-apps/index-metadata',
      validate: {
        body: schema.object({
          indexName: schema.string(),
        }),
      },
    },
    async (context, request, response) => {
      const { indexName } = request.body;
      const client = context.core.opensearch.client.asCurrentUser;

      try {
        // Fetch mapping
        const mappingResponse = await client.indices.getMapping({ index: indexName });
        const indices = Object.keys(mappingResponse.body);
        const mapping =
          indices.length > 0 ? mappingResponse.body[indices[0]]?.mappings?.properties || {} : {};

        // Flatten mapping to field name + type
        const fields: Array<{ name: string; type: string }> = [];
        const flattenMapping = (props: any, prefix: string) => {
          Object.keys(props).forEach((key) => {
            const fullName = prefix ? prefix + '.' + key : key;
            if (props[key].properties) {
              flattenMapping(props[key].properties, fullName);
            } else {
              fields.push({ name: fullName, type: props[key].type || 'object' });
            }
          });
        };
        flattenMapping(mapping, '');

        // Fetch 10 sample docs
        const searchResponse = await client.search({
          index: indexName,
          body: { size: 10, sort: [{ _doc: 'desc' }] },
        });
        const sampleDocs = (searchResponse.body.hits?.hits || []).map((hit: any) => hit._source);

        return response.ok({
          body: {
            indexName,
            fields: fields.slice(0, 100), // Cap at 100 fields
            sampleDocs,
            totalFields: fields.length,
          },
        });
      } catch (err) {
        logger.warn('Failed to fetch index metadata for ' + indexName + ': ' + err);
        return response.ok({
          body: { indexName, fields: [], sampleDocs: [], totalFields: 0 },
        });
      }
    }
  );
}
