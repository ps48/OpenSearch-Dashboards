/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Router } from 'react-router-dom';
import { I18nProvider } from '@osd/i18n/react';
import { AppMountParameters, CoreStart } from '../../../../../core/public';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { AgentTracesStartDependencies } from '../../types';
import { EvaluationsApp } from './evaluations_app';

export type EvaluationsServices = CoreStart & AgentTracesStartDependencies;

/** Mounts the read-only Agent Evaluations app (agent monitoring, after Traces and Spans). */
export const renderEvaluationsApp = (
  params: AppMountParameters,
  core: CoreStart,
  plugins: AgentTracesStartDependencies
) => {
  // The `savedObjects` plugin's start contract would shadow core's (and its client).
  const services: EvaluationsServices = { ...core, ...plugins, savedObjects: core.savedObjects };
  ReactDOM.render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        <Router history={params.history}>
          <EvaluationsApp params={params} />
        </Router>
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>,
    params.element
  );
  return () => ReactDOM.unmountComponentAtNode(params.element);
};
