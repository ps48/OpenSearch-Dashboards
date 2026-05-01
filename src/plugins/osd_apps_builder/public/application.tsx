/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Router, Route, Switch } from 'react-router-dom';
import { AppMountParameters, CoreStart } from '../../../core/public';
import { DataPublicPluginStart } from '../../data/public';
import { OpenSearchDashboardsContextProvider } from '../../opensearch_dashboards_react/public';
import { AppsListingPage } from './applications/apps_listing/apps_listing_page';
import { AppViewerPage } from './applications/app_viewer/app_viewer_page';

export interface AppDeps {
  core: CoreStart;
  data: DataPublicPluginStart;
}

export const renderApp = (coreStart: CoreStart, params: AppMountParameters, deps?: AppDeps) => {
  const data = deps?.data;

  ReactDOM.render(
    <OpenSearchDashboardsContextProvider services={{ ...coreStart }}>
      <Router history={params.history}>
        <Switch>
          <Route
            path="/view/:id"
            render={({ match }) =>
              data ? (
                <AppViewerPage appId={match.params.id} core={coreStart} data={data} />
              ) : (
                <div>Data plugin not available</div>
              )
            }
          />
          <Route
            exact
            path="/"
            render={() => (
              <AppsListingPage
                savedObjectsClient={coreStart.savedObjects.client}
                notifications={coreStart.notifications}
                application={coreStart.application}
                core={coreStart}
                data={data}
              />
            )}
          />
        </Switch>
      </Router>
    </OpenSearchDashboardsContextProvider>,
    params.element
  );

  return () => ReactDOM.unmountComponentAtNode(params.element);
};
