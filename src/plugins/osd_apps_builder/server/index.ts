/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { PluginConfigDescriptor, PluginInitializerContext } from '../../../core/server';
import { OsdAppsBuilderPlugin } from './plugin';
import { configSchema, OsdAppsBuilderConfigType } from './config';

export const config: PluginConfigDescriptor<OsdAppsBuilderConfigType> = {
  schema: configSchema,
  exposeToBrowser: {
    enabled: true,
  },
};

export function plugin(initializerContext: PluginInitializerContext) {
  return new OsdAppsBuilderPlugin(initializerContext);
}
