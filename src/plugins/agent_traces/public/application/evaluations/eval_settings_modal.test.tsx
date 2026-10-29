/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { EvalSettingsModal, looksLikeEvalsDataset, rulesText } from './eval_settings_modal';

const patterns = (withEvals: boolean) => [
  { id: 'tr', attributes: { title: 'otel-v1-apm-span*', signalType: 'traces' } },
  { id: 'lg', attributes: { title: 'logs-otel-v1*', signalType: 'logs' } },
  ...(withEvals
    ? [{ id: 'ev', attributes: { title: 'otel-v1-genai-evaluation*', signalType: 'logs' } }]
    : []),
];

const setup = (
  withEvals: boolean,
  config?: React.ComponentProps<typeof EvalSettingsModal>['config']
) => {
  const client = {
    find: jest.fn(async () => ({ savedObjects: patterns(withEvals) })),
    get: jest.fn(),
    create: jest.fn(async () => ({ id: 'corr-new' })),
    update: jest.fn(async () => ({})),
  };
  const createAndSave = jest.fn(async () => ({ id: 'ev-new' }));
  const services = {
    savedObjects: { client },
    data: { indexPatterns: { createAndSave } },
    notifications: { toasts: { addSuccess: jest.fn(), addDanger: jest.fn() } },
    uiSettings: { get: () => '{"accuracy":{"threshold":0.5}}' },
    application: {
      getUrlForApp: (app: string, { path }: { path: string }) => `/app/${app}/${path}`,
    },
  };
  const onClose = jest.fn();
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        <EvalSettingsModal config={config} onClose={onClose} />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return { client, createAndSave, onClose };
};

describe('EvalSettingsModal', () => {
  it('defaults to the traces dataset and the existing evaluations dataset, and saves the correlation', async () => {
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
      expect.objectContaining({ correlationType: 'trace-to-evaluations-otel-v1-apm-span*' }),
      expect.objectContaining({
        references: [expect.objectContaining({ id: 'tr' }), expect.objectContaining({ id: 'ev' })],
      })
    );
  });

  it('creates the evaluations dataset when there is none', async () => {
    const { createAndSave } = setup(false);
    fireEvent.click(await screen.findByTestId('agtEvlSettingsCreateDataset'));
    await waitFor(() =>
      expect(createAndSave).toHaveBeenCalledWith({
        title: 'otel-v1-genai-evaluation*',
        timeFieldName: 'time',
        signalType: 'logs',
        displayName: 'Evaluation Dataset',
        schemaMappings: {
          otelLogs: {
            timestamp: 'time',
            traceId: 'traceId',
            spanId: 'spanId',
            serviceName: 'serviceName',
          },
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('agtEvlSettingsEvals')).toHaveTextContent('Evaluation Dataset')
    );
  });

  it('updates the existing correlation in place and shows the pass rules read-only', async () => {
    const { client, onClose } = setup(true, {
      correlationId: 'corr-1',
      tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*' },
      evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*' },
      index: 'otel-v1-genai-evaluation*',
    });
    expect(screen.getByTestId('agtEvlSettingsActive')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlSettingsRules')).toHaveTextContent('"threshold": 0.5');
    expect(screen.getByTestId('agtEvlSettingsRulesLink')).toHaveAttribute(
      'href',
      '/app/management/opensearch-dashboards/settings?query=agentTraces%3AevaluationRules'
    );
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

  it('recognizes evaluation datasets and formats the rules', () => {
    expect(looksLikeEvalsDataset({ id: 'a', title: 'otel-v1-genai-evaluation-*' })).toBe(true);
    expect(looksLikeEvalsDataset({ id: 'b', title: 'logs-otel-v1*' })).toBe(false);
    expect(rulesText('')).toBe('{}');
    expect(rulesText('not json')).toBe('not json');
  });
});
