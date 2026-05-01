/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Observable } from 'rxjs';
import { first } from 'rxjs/operators';
import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '../../../core/server';
import { osdAppSavedObjectType } from './saved_objects';
import { capabilitiesProvider } from './capabilities_provider';
import { OsdAppsBuilderConfigType } from './config';
import { AIProxyService } from './services/ai_proxy_service';
import { registerRoutes } from './routes';

export class OsdAppsBuilderPlugin implements Plugin<{}, {}> {
  private readonly logger: Logger;
  private readonly config$: Observable<OsdAppsBuilderConfigType>;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.config$ = initializerContext.config.create<OsdAppsBuilderConfigType>();
  }

  public async setup(core: CoreSetup) {
    this.logger.debug('osdAppsBuilder: Setup');
    const config = await this.config$.pipe(first()).toPromise();

    core.savedObjects.registerType(osdAppSavedObjectType);
    core.capabilities.registerProvider(capabilitiesProvider);

    if (config.enabled) {
      const aiService = new AIProxyService(config, this.logger);
      const router = core.http.createRouter();
      registerRoutes(router, aiService, this.logger);
      this.logger.info(`osdAppsBuilder: AI proxy enabled with provider=${config.provider}`);
    }

    return {};
  }

  public start(core: CoreStart) {
    this.logger.debug('osdAppsBuilder: Started');
    return {};
  }

  public stop() {}
}
