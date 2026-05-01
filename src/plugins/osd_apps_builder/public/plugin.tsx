/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactDOM from 'react-dom';
import {
  AppMountParameters,
  CoreSetup,
  CoreStart,
  DEFAULT_APP_CATEGORIES,
  DEFAULT_NAV_GROUPS,
  Plugin,
  WorkspaceAvailability,
} from '../../../core/public';
import { DataPublicPluginStart } from '../../data/public';
import { APP_ID, BUILDER_APP_ID, PLUGIN_NAME } from '../common/constants';
import { OpenSearchDashboardsContextProvider } from '../../opensearch_dashboards_react/public';
import { AppBuilderPage } from './applications/app_builder/app_builder_page';

export class OsdAppsBuilderPublicPlugin implements Plugin<{}, {}> {
  public setup(core: CoreSetup) {
    core.application.register({
      id: APP_ID,
      title: PLUGIN_NAME,
      order: 2600,
      workspaceAvailability: WorkspaceAvailability.insideWorkspace,
      euiIconType: 'lensApp',
      category: DEFAULT_APP_CATEGORIES.opensearchDashboards,
      async mount(params: AppMountParameters) {
        const { renderApp } = await import('./application');
        const [coreStart, depsStart] = await core.getStartServices();
        const data = (depsStart as { data: DataPublicPluginStart }).data;
        params.element.style.height = '100%';
        return renderApp(coreStart, params, { core: coreStart, data });
      },
    });

    core.application.register({
      id: BUILDER_APP_ID,
      title: 'App Builder',
      order: 2601,
      workspaceAvailability: WorkspaceAvailability.insideWorkspace,
      euiIconType: 'editorCodeBlock',
      category: DEFAULT_APP_CATEGORIES.opensearchDashboards,
      async mount(params: AppMountParameters) {
        const [coreStart, depsStart] = await core.getStartServices();
        const data = (depsStart as { data: DataPublicPluginStart }).data;
        params.element.style.height = '100%';
        ReactDOM.render(
          <OpenSearchDashboardsContextProvider services={{ ...coreStart }}>
            <AppBuilderPage
              core={coreStart}
              data={data}
              savedObjectsClient={coreStart.savedObjects.client}
            />
          </OpenSearchDashboardsContextProvider>,
          params.element
        );
        return () => ReactDOM.unmountComponentAtNode(params.element);
      },
    });

    const navLinkOrder = core.chrome.getIsIconSideNavEnabled?.() ? 150 : 350;

    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.observability, [
      {
        id: APP_ID,
        order: navLinkOrder,
        category: undefined,
        euiIconType: 'lensApp',
      },
    ]);

    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.all, [
      {
        id: APP_ID,
        order: navLinkOrder,
        category: undefined,
        euiIconType: 'lensApp',
      },
    ]);

    return {};
  }

  public start(core: CoreStart) {
    return {};
  }

  public stop() {}
}
