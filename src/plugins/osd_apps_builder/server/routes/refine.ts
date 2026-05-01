/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'stream';
import { schema } from '@osd/config-schema';
import { IRouter, Logger } from '../../../../core/server';
import { ROUTES } from '../../common/constants';
import { AIProxyService } from '../services/ai_proxy_service';

export function registerRefineRoute(router: IRouter, aiService: AIProxyService, logger: Logger) {
  router.post(
    {
      path: ROUTES.REFINE,
      validate: {
        body: schema.object({
          prompt: schema.string(),
          existingCode: schema.string(),
          context: schema.maybe(
            schema.object({
              indexMetadata: schema.maybe(schema.arrayOf(schema.any())),
              dataSourceRefs: schema.maybe(schema.arrayOf(schema.any())),
              exampleCode: schema.maybe(schema.string()),
            })
          ),
        }),
      },
    },
    async (context, request, response) => {
      const { prompt, existingCode, context: genContext } = request.body;
      const provider = aiService.getProvider();

      const stream = new Readable({ read() {} });

      (async () => {
        try {
          for await (const event of provider.refineApp(prompt, existingCode, {
            ...genContext,
            componentLibrary: 'oui+echarts' as const,
            opensearchClient: context.core.opensearch.client.asCurrentUser,
          } as any)) {
            stream.push('data: ' + event + '\n\n');
          }
        } catch (err) {
          logger.error('Refine error: ' + err);
          stream.push('data: ' + JSON.stringify({ error: String(err) }) + '\n\n');
        }
        stream.push(null);
      })();

      return response.ok({
        headers: {
          'Content-Type': 'text/event-stream',
          'Content-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Transfer-Encoding': 'chunked',
          'X-Accel-Buffering': 'no',
        },
        body: stream,
      });
    }
  );
}
