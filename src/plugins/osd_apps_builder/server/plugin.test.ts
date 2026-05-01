/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { coreMock } from '../../../../src/core/server/mocks';
import { OsdAppsBuilderPlugin } from './plugin';
import { SAVED_OBJECT_TYPE } from '../common/constants';

describe('OsdAppsBuilderPlugin', () => {
  let plugin: OsdAppsBuilderPlugin;

  beforeEach(() => {
    const initializerContext = coreMock.createPluginInitializerContext({
      enabled: false,
      provider: 'bedrock',
      bedrock: { region: 'us-east-1', modelId: 'test-model' },
    });
    plugin = new OsdAppsBuilderPlugin(initializerContext);
  });

  describe('#setup', () => {
    it('registers the osd-app saved object type', async () => {
      const coreSetup = coreMock.createSetup();
      await plugin.setup(coreSetup);

      expect(coreSetup.savedObjects.registerType).toHaveBeenCalledWith(
        expect.objectContaining({ name: SAVED_OBJECT_TYPE })
      );
    });

    it('registers the capabilities provider', async () => {
      const coreSetup = coreMock.createSetup();
      await plugin.setup(coreSetup);

      expect(coreSetup.capabilities.registerProvider).toHaveBeenCalledWith(expect.any(Function));
    });

    it('capabilities provider exposes osdApps capabilities', async () => {
      const coreSetup = coreMock.createSetup();
      await plugin.setup(coreSetup);

      const providerFn = coreSetup.capabilities.registerProvider.mock.calls[0][0];
      const capabilities = providerFn();
      expect(capabilities).toEqual({
        osdApps: {
          show: true,
          createNew: true,
          save: true,
        },
      });
    });

    it('does not create router when disabled', async () => {
      const coreSetup = coreMock.createSetup();
      await plugin.setup(coreSetup);

      expect(coreSetup.http.createRouter).not.toHaveBeenCalled();
    });

    it('creates router and registers routes when enabled', async () => {
      const initializerContext = coreMock.createPluginInitializerContext({
        enabled: true,
        provider: 'bedrock',
        bedrock: { region: 'us-east-1', modelId: 'test-model' },
      });
      const enabledPlugin = new OsdAppsBuilderPlugin(initializerContext);
      const coreSetup = coreMock.createSetup();
      await enabledPlugin.setup(coreSetup);

      expect(coreSetup.http.createRouter).toHaveBeenCalled();
    });
  });
});
