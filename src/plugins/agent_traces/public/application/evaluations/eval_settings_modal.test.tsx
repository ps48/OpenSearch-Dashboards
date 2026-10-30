/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { EvalSettingsModal, looksLikeEvalsDataset } from './eval_settings_modal';

const patterns = (withEvals: boolean) => [
  { id: 'tr', attributes: { title: 'otel-v1-apm-span*', signalType: 'traces' } },
  { id: 'tr2', attributes: { title: 'agent-spans*', signalType: 'traces' } },
  { id: 'lg', attributes: { title: 'logs-otel-v1*', signalType: 'logs' } },
  ...(withEvals
    ? [{ id: 'ev', attributes: { title: 'otel-v1-genai-evaluation*', signalType: 'logs' } }]
    : []),
];

const setup = (
  withEvals: boolean,
  config?: React.ComponentProps<typeof EvalSettingsModal>['config'],
  { queryDataset, createError }: { queryDataset?: unknown; createError?: string } = {}
) => {
  const client = {
    find: jest.fn(async () => ({ savedObjects: patterns(withEvals) })),
    get: jest.fn(),
    create: jest.fn(async () => ({ id: 'corr-new' })),
    update: jest.fn(async () => ({})),
  };
  const createAndSave = jest.fn(async () => {
    if (createError) throw new Error(createError);
    return { id: 'ev-new' };
  });
  const services = {
    savedObjects: { client },
    data: {
      indexPatterns: { createAndSave },
      query: { queryString: { getQuery: () => ({ query: '', dataset: queryDataset }) } },
    },
    notifications: { toasts: { addSuccess: jest.fn(), addDanger: jest.fn() } },
    application: {
      getUrlForApp: (app: string, { path }: { path: string }) => `/app/${app}/${path}`,
    },
  };
  const onClose = jest.fn();
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        <EvalSettingsModal config={config} workspaceId="ws1" onClose={onClose} />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return { client, createAndSave, onClose };
};

describe('EvalSettingsModal', () => {
  it('defaults to the traces dataset and the existing evaluations dataset, and saves the config', async () => {
    const { client, onClose } = setup(true);
    await waitFor(() =>
      expect(screen.getByTestId('agtEvlSettingsEvals')).toHaveTextContent(
        'otel-v1-genai-evaluation*'
      )
    );
    expect(screen.getByTestId('agtEvlSettingsTraces')).toHaveTextContent('otel-v1-apm-span*');
    expect(screen.queryByTestId('agtEvlSettingsCreateDataset')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlSettingsSave'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(client.create).toHaveBeenCalledWith(
      'correlations',
      expect.objectContaining({
        correlationType: 'AgentEvals-Config-ws1',
        title: 'AgentEvals-Config',
      }),
      expect.objectContaining({
        references: [expect.objectContaining({ id: 'tr' }), expect.objectContaining({ id: 'ev' })],
      })
    );
  });

  it('creates the evaluations dataset when there is none', async () => {
    const { createAndSave } = setup(false);
    fireEvent.click(await screen.findByTestId('agtEvlSettingsCreateDataset'));
    await waitFor(() =>
      expect(createAndSave).toHaveBeenCalledWith(
        {
          title: 'otel-v1-genai-evaluation*',
          timeFieldName: 'time',
          signalType: 'logs',
          displayName: 'Evaluation Dataset',
          schemaMappings: {
            otelLogs: {
              timestamp: 'time',
              traceId: 'traceId',
              spanId: 'spanId',
              serviceName: 'resource.attributes.service.name',
            },
          },
        },
        false,
        false
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('agtEvlSettingsEvals')).toHaveTextContent('Evaluation Dataset')
    );
    expect(screen.getByTestId('agtEvlSettingsCreated')).toHaveTextContent(
      'Created the evaluations dataset otel-v1-genai-evaluation* and selected it'
    );
    expect(screen.queryByTestId('agtEvlSettingsNoDataset')).not.toBeInTheDocument();
  });

  it('says why the evaluations dataset could not be created', async () => {
    setup(false, undefined, { createError: 'Duplicate index pattern' });
    fireEvent.click(await screen.findByTestId('agtEvlSettingsCreateDataset'));
    expect(await screen.findByTestId('agtEvlSettingsCreateError')).toHaveTextContent(
      'Duplicate index pattern'
    );
    expect(screen.getByTestId('agtEvlSettingsEvals')).not.toHaveTextContent('Evaluation Dataset');
  });

  it('proposes the traces dataset Agent Traces has open', async () => {
    setup(true, undefined, { queryDataset: { id: 'tr2', signalType: 'traces' } });
    await waitFor(() =>
      expect(screen.getByTestId('agtEvlSettingsTraces')).toHaveTextContent('agent-spans*')
    );
  });

  it('proposes the first traces dataset when Agent Traces has a logs dataset open', async () => {
    setup(true, undefined, { queryDataset: { id: 'lg', signalType: 'logs' } });
    await waitFor(() =>
      expect(screen.getByTestId('agtEvlSettingsTraces')).toHaveTextContent('otel-v1-apm-span*')
    );
  });

  it('updates the existing config in place', async () => {
    const { client, onClose } = setup(true, {
      configId: 'corr-1',
      tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*' },
      evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*' },
      index: 'otel-v1-genai-evaluation*',
    });
    expect(screen.getByTestId('agtEvlSettingsActive')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlSettingsRules')).not.toBeInTheDocument();
    await waitFor(() => expect(client.find).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSettingsSave'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(client.update).toHaveBeenCalledWith(
      'correlations',
      'corr-1',
      expect.anything(),
      expect.anything()
    );
    expect(client.create).not.toHaveBeenCalled();
  });

  it('recognizes evaluation datasets', () => {
    expect(looksLikeEvalsDataset({ id: 'a', title: 'otel-v1-genai-evaluation-*' })).toBe(true);
    expect(looksLikeEvalsDataset({ id: 'b', title: 'logs-otel-v1*' })).toBe(false);
    expect(looksLikeEvalsDataset({ id: 'c', title: 'my-genai-evaluation*' })).toBe(false);
  });
});
