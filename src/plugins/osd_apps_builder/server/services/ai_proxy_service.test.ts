/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIProxyService } from './ai_proxy_service';
import { BedrockProvider } from './providers/bedrock_provider';
import { OpenAIProvider } from './providers/openai_provider';
import { SelfHostedProvider } from './providers/self_hosted_provider';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  get: jest.fn(),
  fatal: jest.fn(),
  trace: jest.fn(),
} as any;

describe('AIProxyService', () => {
  it('creates BedrockProvider when config.provider is bedrock', () => {
    const service = new AIProxyService(
      { enabled: true, provider: 'bedrock', bedrock: { region: 'us-east-1', modelId: 'test' } },
      mockLogger
    );
    expect(service.getProvider()).toBeInstanceOf(BedrockProvider);
    expect(service.getProvider().id).toBe('bedrock');
  });

  it('creates OpenAIProvider when config.provider is openai', () => {
    const service = new AIProxyService(
      { enabled: true, provider: 'openai', bedrock: { region: 'us-east-1', modelId: 'test' } },
      mockLogger
    );
    expect(service.getProvider()).toBeInstanceOf(OpenAIProvider);
    expect(service.getProvider().id).toBe('openai');
  });

  it('creates SelfHostedProvider when config.provider is self-hosted', () => {
    const service = new AIProxyService(
      {
        enabled: true,
        provider: 'self-hosted',
        bedrock: { region: 'us-east-1', modelId: 'test' },
      },
      mockLogger
    );
    expect(service.getProvider()).toBeInstanceOf(SelfHostedProvider);
    expect(service.getProvider().id).toBe('self-hosted');
  });

  it('falls back to bedrock for unknown provider', () => {
    const service = new AIProxyService(
      { enabled: true, provider: 'unknown', bedrock: { region: 'us-east-1', modelId: 'test' } },
      mockLogger
    );
    expect(service.getProvider()).toBeInstanceOf(BedrockProvider);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('openai provider throws on generateApp', async () => {
    const service = new AIProxyService(
      { enabled: true, provider: 'openai', bedrock: { region: 'us-east-1', modelId: 'test' } },
      mockLogger
    );
    const gen = service.getProvider().generateApp('test', { componentLibrary: 'oui+echarts' });
    await expect(gen.next()).rejects.toThrow('not configured');
  });

  it('self-hosted provider throws on generateApp', async () => {
    const service = new AIProxyService(
      {
        enabled: true,
        provider: 'self-hosted',
        bedrock: { region: 'us-east-1', modelId: 'test' },
      },
      mockLogger
    );
    const gen = service.getProvider().generateApp('test', { componentLibrary: 'oui+echarts' });
    await expect(gen.next()).rejects.toThrow('not configured');
  });
});
