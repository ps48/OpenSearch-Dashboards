/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { EvalSetupWizard, countEvaluationResults, detectEvals } from './eval_setup_wizard';
import type { EvaluationsServices } from '.';

const mockRunPpl = jest.fn();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  runPpl: (...args: unknown[]) => mockRunPpl(...args),
}));

const patterns = ({ withEvals = true, withTraces = true, extra = [] as unknown[] } = {}) => [
  ...extra,
  ...(withTraces
    ? [
        { id: 'tr', attributes: { title: 'otel-v1-apm-span*', signalType: 'traces' } },
        { id: 'tr2', attributes: { title: 'agent-spans*', signalType: 'traces' } },
      ]
    : []),
  { id: 'lg', attributes: { title: 'logs-otel-v1*', signalType: 'logs' } },
  ...(withEvals
    ? [{ id: 'ev', attributes: { title: 'otel-v1-genai-evaluation*', signalType: 'logs' } }]
    : []),
];

const makeServices = ({
  withEvals = true,
  withTraces = true,
  queryDataset,
  createError,
  saveError,
  extra,
}: {
  withEvals?: boolean;
  withTraces?: boolean;
  queryDataset?: unknown;
  createError?: string;
  saveError?: string;
  extra?: unknown[];
} = {}) => {
  const client = {
    find: jest.fn(async () => ({ savedObjects: patterns({ withEvals, withTraces, extra }) })),
    get: jest.fn(),
    create: jest.fn(async () => {
      if (saveError) throw new Error(saveError);
      return { id: 'corr-new' };
    }),
    update: jest.fn(async () => ({})),
  };
  const create = jest.fn(async (spec: Record<string, unknown>) => ({ ...spec }));
  const createSavedObject = jest.fn(async (pattern: Record<string, unknown>) => {
    if (createError) throw new Error(createError);
    return { ...pattern, id: 'ev-new' };
  });
  const addSuccess = jest.fn();
  const services = {
    savedObjects: { client },
    data: {
      indexPatterns: { create, createSavedObject },
      query: { queryString: { getQuery: () => ({ query: '', dataset: queryDataset }) } },
    },
    notifications: { toasts: { addSuccess, addDanger: jest.fn() } },
  };
  return { services, client, createAndSave: createSavedObject, create, addSuccess };
};

const renderWizard = (
  services: ReturnType<typeof makeServices>['services'],
  props: Partial<React.ComponentProps<typeof EvalSetupWizard>> = {}
) => {
  const onClose = jest.fn();
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        <EvalSetupWizard workspaceId="ws1" onClose={onClose} {...props} />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return { onClose };
};

const asServices = (s: unknown) => s as EvaluationsServices;
const next = () => fireEvent.click(screen.getByTestId('agtEvlSetupNext'));

describe('countEvaluationResults and detectEvals', () => {
  beforeEach(() => mockRunPpl.mockReset());

  it('counts the results with one PPL query over the index, without a time bound', async () => {
    mockRunPpl.mockResolvedValue([{ n: 42 }]);
    const { services } = makeServices();
    expect(await countEvaluationResults(asServices(services), 'evals-*')).toBe(42);
    const [, dataset, query, range] = mockRunPpl.mock.calls[0];
    expect(query).toBe(
      "source = evals-* | where `eventName` = 'gen_ai.evaluation.result' | stats count() as n"
    );
    expect(dataset).toMatchObject({ title: 'evals-*' });
    expect((dataset as { timeFieldName?: string }).timeFieldName).toBeUndefined();
    expect(range).toBeUndefined();
  });

  it('counts none when the query returns no row, undefined for a missing index', async () => {
    const { services } = makeServices();
    mockRunPpl.mockResolvedValueOnce([]);
    expect(await countEvaluationResults(asServices(services))).toBe(0);
    mockRunPpl.mockRejectedValueOnce(new Error('index_not_found_exception: no such index'));
    expect(await countEvaluationResults(asServices(services))).toBeUndefined();
    mockRunPpl.mockRejectedValueOnce(new Error('Boom'));
    await expect(countEvaluationResults(asServices(services))).rejects.toThrow('Boom');
  });

  it('detects the datasets, proposes the defaults and counts over the evaluations dataset', async () => {
    mockRunPpl.mockResolvedValue([{ n: 7 }]);
    const { services } = makeServices({ queryDataset: { id: 'tr2', signalType: 'traces' } });
    const found = await detectEvals(asServices(services));
    expect(found.traces.map((d) => d.id).sort()).toEqual(['tr', 'tr2']);
    expect(found.logs.map((d) => d.id).sort()).toEqual(['ev', 'lg']);
    expect(found.evaluationsDataset?.id).toBe('ev');
    // The traces dataset Agent Traces has open.
    expect(found.tracesDataset?.id).toBe('tr2');
    expect(found.results).toBe(7);
    expect(mockRunPpl.mock.calls[0][2]).toContain('source = otel-v1-genai-evaluation*');
  });

  it('counts on the data source of the other index patterns when no dataset has one', async () => {
    // A workspace with only untyped index patterns on a data source (an APM setup), and no
    // local cluster to ask: the count must not go to the local cluster.
    mockRunPpl.mockResolvedValue([{ n: 3 }]);
    const { services } = makeServices({
      withEvals: false,
      withTraces: false,
      extra: [
        {
          id: 'apm-traces-ip',
          attributes: { title: 'otel-v1-apm-span*' },
          references: [{ id: 'ds-1', name: 'dataSource', type: 'data-source' }],
        },
      ],
    });
    const found = await detectEvals(asServices(services));
    expect(found.traces).toEqual([]);
    expect(found.results).toBe(3);
    expect(mockRunPpl.mock.calls[0][1]).toMatchObject({ dataSource: { id: 'ds-1' } });
  });
});

describe('EvalSetupWizard', () => {
  beforeEach(() => {
    mockRunPpl.mockReset();
    mockRunPpl.mockResolvedValue([{ n: 1234 }]);
  });

  it('walks overview, evaluations, traces and create, then saves with the existing dataset', async () => {
    // Agent Traces has a traces dataset open: the setup proposes it.
    const { services, client, createAndSave, addSuccess } = makeServices({
      queryDataset: { id: 'tr', signalType: 'traces' },
    });
    const { onClose } = renderWizard(services);
    expect(screen.getByTestId('agtEvlSetupScreen-overview')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlOnlineCard')).toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlSetupBack')).not.toBeInTheDocument();
    next();
    const found = await screen.findByTestId('agtEvlSetupFound');
    expect(found).toHaveTextContent('Found 1,234 evaluation results in otel-v1-genai-evaluation*');
    expect(screen.queryByTestId('agtEvlSetupNotFound')).not.toBeInTheDocument();
    next();
    expect(screen.getByTestId('agtEvlSetupScreen-traces')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlSetupTraces')).toHaveTextContent('otel-v1-apm-span*');
    next();
    expect(screen.getByTestId('agtEvlSetupReview')).toHaveTextContent('1,234');
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(createAndSave).not.toHaveBeenCalled();
    expect(client.create).toHaveBeenCalledWith(
      'correlations',
      expect.objectContaining({ correlationType: 'AgentEvals-Config-ws1' }),
      expect.objectContaining({
        references: [expect.objectContaining({ id: 'tr' }), expect.objectContaining({ id: 'ev' })],
      })
    );
    expect(addSuccess).toHaveBeenCalledWith('Agent Evaluations is set up');
  });

  it('with nothing found: shows the snippets and SDK links, and detects again', async () => {
    mockRunPpl.mockRejectedValue(new Error('no such index [otel-v1-genai-evaluation*]'));
    const { services } = makeServices({ withEvals: false });
    renderWizard(services);
    next();
    const notFound = await screen.findByTestId('agtEvlSetupNotFound');
    expect(notFound).toHaveTextContent('No evaluation results yet');
    const screenEl = screen.getByTestId('agtEvlSetupScreen-evaluations');
    expect(screenEl).toHaveTextContent('from opensearch_genai_observability_sdk_py import score');
    expect(screenEl).toHaveTextContent('genai-evaluation-pipeline');
    expect(within(screenEl).getByTestId('agtEvlSdkPy')).toBeInTheDocument();
    expect(within(screenEl).getByTestId('agtEvlSdkTs')).toBeInTheDocument();
    // Results arrive: Detect again finds them.
    mockRunPpl.mockReset();
    mockRunPpl.mockResolvedValue([{ n: 3 }]);
    fireEvent.click(screen.getByTestId('agtEvlSetupDetect'));
    expect(await screen.findByTestId('agtEvlSetupFound')).toHaveTextContent('Found 3');
  });

  it('creates the evaluations dataset when there is none, then saves', async () => {
    const { services, client, createAndSave } = makeServices({
      withEvals: false,
      queryDataset: { id: 'tr', signalType: 'traces' },
    });
    const { onClose } = renderWizard(services);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    expect(screen.getByTestId('agtEvlSetupReview')).toHaveTextContent(
      'Create otel-v1-genai-evaluation* (logs, time field @timestamp)'
    );
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(createAndSave).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenCalledWith(
      'correlations',
      expect.anything(),
      expect.objectContaining({
        references: [
          expect.objectContaining({ id: 'tr' }),
          expect.objectContaining({ id: 'ev-new' }),
        ],
      })
    );
  });

  it('updates the existing config in place', async () => {
    const { services, client } = makeServices();
    const { onClose } = renderWizard(services, { configId: 'corr-1' });
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(client.update).toHaveBeenCalledWith(
      'correlations',
      'corr-1',
      expect.anything(),
      expect.anything()
    );
    expect(client.create).not.toHaveBeenCalled();
  });

  it('says why the setup could not finish, and stays open', async () => {
    const { services } = makeServices({ withEvals: false, createError: 'Duplicate index pattern' });
    const { onClose } = renderWizard(services);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    expect(await screen.findByTestId('agtEvlSetupCreateError')).toHaveTextContent(
      'Duplicate index pattern'
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retries after the dataset was created but the settings failed, without a duplicate', async () => {
    const { services, client, createAndSave } = makeServices({
      withEvals: false,
      queryDataset: { id: 'tr', signalType: 'traces' },
    });
    client.create.mockRejectedValueOnce(new Error('403 Forbidden'));
    const { onClose } = renderWizard(services);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    expect(await screen.findByTestId('agtEvlSetupCreateError')).toHaveTextContent('403 Forbidden');
    expect(createAndSave).toHaveBeenCalledTimes(1);
    // The review shows the dataset it made; the retry saves the settings with it.
    expect(screen.getByTestId('agtEvlSetupReview')).toHaveTextContent('Evaluation Dataset');
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(createAndSave).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenLastCalledWith(
      'correlations',
      expect.anything(),
      expect.objectContaining({
        references: [
          expect.objectContaining({ id: 'tr' }),
          expect.objectContaining({ id: 'ev-new' }),
        ],
      })
    );
  });

  it('uses an existing non-logs index pattern with the evaluations title', async () => {
    const { services, client, create } = makeServices({
      withEvals: false,
      queryDataset: { id: 'tr', signalType: 'traces' },
      extra: [{ id: 'plain', attributes: { title: 'otel-v1-genai-evaluation*' } }],
    });
    const { onClose } = renderWizard(services);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    expect(screen.getByTestId('agtEvlSetupReview')).toHaveTextContent('otel-v1-genai-evaluation*');
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(create).not.toHaveBeenCalled();
    expect(client.create).toHaveBeenCalledWith(
      'correlations',
      expect.anything(),
      expect.objectContaining({
        references: [
          expect.objectContaining({ id: 'tr' }),
          expect.objectContaining({ id: 'plain' }),
        ],
      })
    );
  });

  it('does not read fields when no evaluation index exists', async () => {
    mockRunPpl.mockRejectedValue(new Error('no such index [otel-v1-genai-evaluation*]'));
    const { services, create } = makeServices({
      withEvals: false,
      queryDataset: { id: 'tr', signalType: 'traces' },
    });
    const { onClose } = renderWizard(services);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    fireEvent.click(screen.getByTestId('agtEvlSetupCreate'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(create).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('without a traces dataset: says so, and Create is disabled', async () => {
    const { services } = makeServices({ withTraces: false });
    renderWizard(services);
    await waitFor(() => expect(mockRunPpl).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-traces'));
    expect(await screen.findByTestId('agtEvlSetupNoTraces')).toHaveTextContent(
      'No traces dataset in this workspace'
    );
    expect(screen.queryByTestId('agtEvlSetupTraces')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlSetupStep-create'));
    expect(screen.getByTestId('agtEvlSetupCreate')).toBeDisabled();
  });

  it('shows a detection error', async () => {
    mockRunPpl.mockRejectedValue(new Error('Boom'));
    const { services } = makeServices();
    renderWizard(services);
    next();
    expect(await screen.findByText('Detection failed')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlSetupScreen-evaluations')).toHaveTextContent('Boom');
  });

  it('Back and Cancel', async () => {
    const { services } = makeServices();
    const { onClose } = renderWizard(services);
    next();
    await screen.findByTestId('agtEvlSetupFound');
    fireEvent.click(screen.getByTestId('agtEvlSetupBack'));
    expect(screen.getByTestId('agtEvlSetupScreen-overview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlSetupCancel'));
    expect(onClose).toHaveBeenCalledWith();
  });
});
