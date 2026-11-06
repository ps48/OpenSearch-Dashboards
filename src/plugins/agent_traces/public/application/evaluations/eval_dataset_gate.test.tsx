/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from '@testing-library/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import {
  resetEvalsDatasetState,
  useAgentTracesEvalsShown,
  useEvalsDataSource,
  useEvalsIndexPattern,
} from './eval_dataset';

const config = {
  configId: 'c1',
  evaluationsDataset: {
    id: 'ev',
    title: 'my-evals*',
    dataSource: { id: 'ds-1', title: 'ds-1', type: 'OpenSearch' },
  },
  index: 'my-evals*',
};

let seen: { shown: boolean; index?: string; dataSourceId?: string } | undefined;
const Probe = () => {
  const ds = useEvalsDataSource();
  seen = { shown: useAgentTracesEvalsShown(), index: useEvalsIndexPattern(), dataSourceId: ds?.id };
  return null;
};

const renderWith = (evalsEnabled: boolean) =>
  render(
    <OpenSearchDashboardsContextProvider
      services={{
        capabilities: {
          agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: evalsEnabled },
        },
        // The open dataset reads another data source: it must not be used for evaluations.
        data: {
          query: { queryString: { getQuery: () => ({ dataset: { dataSource: { id: 'ds-2' } } }) } },
        },
      }}
    >
      <Probe />
    </OpenSearchDashboardsContextProvider>
  );

describe('Agent Traces evaluations gate', () => {
  afterEach(() => resetEvalsDatasetState());

  it('shows evaluations with the flag on and a config, reading the config index and data source', () => {
    resetEvalsDatasetState({ status: 'ready', config });
    renderWith(true);
    expect(seen).toEqual({ shown: true, index: 'my-evals*', dataSourceId: 'ds-1' });
  });

  it('shows nothing and assumes no index or data source without a config', () => {
    resetEvalsDatasetState({ status: 'ready' });
    renderWith(true);
    expect(seen).toEqual({ shown: false, index: undefined, dataSourceId: undefined });
  });

  it('shows nothing while the config loads or when it cannot be read', () => {
    resetEvalsDatasetState({ status: 'loading' });
    renderWith(true);
    expect(seen?.shown).toBe(false);
    resetEvalsDatasetState({ status: 'error', error: 'forbidden' });
    renderWith(true);
    expect(seen).toMatchObject({ shown: false, index: undefined });
  });

  it('shows nothing with the flag off, even with a config', () => {
    resetEvalsDatasetState({ status: 'ready', config });
    renderWith(false);
    expect(seen).toMatchObject({ shown: false, index: undefined });
  });
});
