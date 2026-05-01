/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from '../../../../core/server';
import { OsdAppsBuilderConfigType } from '../config';
import { AIProvider } from './providers/types';
import { BedrockProvider } from './providers/bedrock_provider';
import { OpenAIProvider } from './providers/openai_provider';
import { SelfHostedProvider } from './providers/self_hosted_provider';

export class AIProxyService {
  private provider: AIProvider;

  constructor(config: OsdAppsBuilderConfigType, logger: Logger) {
    switch (config.provider) {
      case 'bedrock':
        this.provider = new BedrockProvider(config.bedrock.region, config.bedrock.modelId, logger);
        break;
      case 'openai':
        this.provider = new OpenAIProvider();
        break;
      case 'self-hosted':
        this.provider = new SelfHostedProvider();
        break;
      default:
        logger.warn(`Unknown AI provider: ${config.provider}, falling back to bedrock`);
        this.provider = new BedrockProvider(config.bedrock.region, config.bedrock.modelId, logger);
    }
  }

  getProvider(): AIProvider {
    return this.provider;
  }
}
