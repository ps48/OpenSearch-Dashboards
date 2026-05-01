/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { IRouter, Logger } from '../../../../core/server';
import { AIProxyService } from '../services/ai_proxy_service';
import { registerGenerateRoute } from './generate';
import { registerRefineRoute } from './refine';
import { registerValidateRoute } from './validate';
import { registerIndexMetadataRoute } from './index_metadata';

export function registerRoutes(router: IRouter, aiService: AIProxyService, logger: Logger) {
  registerGenerateRoute(router, aiService, logger);
  registerRefineRoute(router, aiService, logger);
  registerValidateRoute(router);
  registerIndexMetadataRoute(router, logger);
}
