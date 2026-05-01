/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { schema, TypeOf } from '@osd/config-schema';

export const configSchema = schema.object({
  enabled: schema.boolean({ defaultValue: false }),
  provider: schema.string({ defaultValue: 'bedrock' }),
  bedrock: schema.object({
    region: schema.string({ defaultValue: 'us-east-1' }),
    modelId: schema.string({ defaultValue: 'anthropic.claude-3-sonnet-20240229-v1:0' }),
  }),
});

export type OsdAppsBuilderConfigType = TypeOf<typeof configSchema>;
