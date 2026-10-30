/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { of } from 'rxjs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import { ResultFlyout } from './result_flyout';
import { makeResult } from './eval_test_fixtures';
import { AGENT_TRACES_NAV_ID } from '../../../common';
import { resetEvalsDatasetState } from './eval_dataset';

const spanRow = {
  traceId: 't1',
  spanId: 's1',
  parentSpanId: 'root',
  name: 'invoke_agent Events Agent',
  serviceName: 'events-agent',
  startTime: '2026-10-26 09:02:06.099',
  durationInNanos: 237574288,
  attributes: {
    gen_ai: {
      operation: { name: 'invoke_agent' },
      agent: { name: 'Events Agent' },
      input: {
        messages: '[{"role":"user","parts":[{"type":"text","content":"Events in Paris?"}]}]',
      },
      output: {
        messages: '[{"role":"assistant","parts":[{"type":"text","content":"Three events."}]}]',
      },
    },
  },
};

const otherEval = {
  '@timestamp': '2026-10-26 09:03:33',
  traceId: 't1',
  spanId: 's1',
  attributes: {
    gen_ai: { evaluation: { name: 'error_free', score: { value: 1, label: 'pass' } } },
    derived: { evaluation: { level: 'span', source: 'opensearch-sdk', target_trace_id: 't1' } },
  },
};

const toResponse = (rows: Array<Record<string, unknown>>) => ({
  schema: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [],
  datarows: rows.map((r) => Object.values(r)),
});

const setup = (
  result = makeResult({
    id: 'self',
    traceId: 't1',
    spanId: 's1',
    explanation: 'Looped.',
    label: 'fail',
    name: 'tool_diversity',
    judgeTraceId: 'judge1',
    onlineConfig: 'cfg',
  }),
  siblings?: Array<ReturnType<typeof makeResult>>
) => {
  const search = jest.fn(
    (request: { params: { body: { query: { queries: Array<{ query: string }> } } } }) => {
      const query = request.params.body.query.queries[0].query;
      return of(
        query.includes('otel-v1-apm-span') ? toResponse([spanRow]) : toResponse([otherEval])
      );
    }
  );
  const navigateToApp = jest.fn();
  const services = { data: { search: { search } }, application: { navigateToApp } };
  const onOpenResult = jest.fn();
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        <ResultFlyout
          result={result}
          onClose={jest.fn()}
          onOpenResult={onOpenResult}
          siblings={siblings}
        />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return { search, navigateToApp, onOpenResult };
};

describe('ResultFlyout', () => {
  it('steps through the table rows with the arrows and j / k', () => {
    const rows = ['a', 'self', 'c'].map((id) => makeResult({ id, traceId: 't1', spanId: 's1' }));
    const { onOpenResult } = setup(rows[1], rows);
    expect(screen.getByTestId('agtEvlResultPosition')).toHaveTextContent('2 of 3');
    fireEvent.click(screen.getByTestId('agtEvlNextResult'));
    expect(onOpenResult).toHaveBeenLastCalledWith(rows[2]);
    fireEvent.keyDown(window, { key: 'k' });
    expect(onOpenResult).toHaveBeenLastCalledWith(rows[0]);
  });

  it('shows no stepping outside a table', () => {
    setup();
    expect(screen.queryByTestId('agtEvlResultPosition')).toBeNull();
  });

  it('shows the result, evaluator details and the judged span with its messages', async () => {
    setup();
    const flyout = screen.getByTestId('agtEvlResultFlyout');
    expect(within(flyout).getByText('tool_diversity')).toBeInTheDocument();
    expect(screen.getByTestId('agtEvlExplanation')).toHaveTextContent('Looped.');
    expect(screen.getByTestId('agtEvlFlyoutEvaluator')).toHaveTextContent('cfg');
    await waitFor(() => expect(screen.getByTestId('agtEvlTargetSpan')).toBeInTheDocument());
    const target = screen.getByTestId('agtEvlTargetSpan');
    expect(target).toHaveTextContent('Events Agent');
    expect(target).toHaveTextContent('238 ms');
    expect(screen.getByTestId('agtEvlJudgedInput')).toHaveTextContent('Events in Paris?');
    expect(screen.getByTestId('agtEvlJudgedOutput')).toHaveTextContent('Three events.');
  });

  it('lists other evaluations of the same span and opens them', async () => {
    const { onOpenResult } = setup();
    await waitFor(() => expect(screen.getByTestId('agtEvlOtherResult')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('agtEvlOtherResult'));
    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({ name: 'error_free' }));
  });

  it('opens the trace and the judge trace in Agent Traces', async () => {
    const { navigateToApp } = setup();
    fireEvent.click(screen.getByTestId('agtEvlOpenTrace'));
    expect(navigateToApp).toHaveBeenCalledWith(AGENT_TRACES_NAV_ID, {
      path: expect.stringContaining('openTraceId=t1'),
    });
    fireEvent.click(screen.getByTestId('agtEvlJudgeTraceLink'));
    expect(navigateToApp).toHaveBeenLastCalledWith(AGENT_TRACES_NAV_ID, {
      path: expect.stringContaining('openTraceId=judge1'),
    });
    await waitFor(() => expect(screen.getByTestId('agtEvlTargetSpan')).toBeInTheDocument());
  });

  it('opens a session result as its session view, not one of its traces', async () => {
    const { navigateToApp } = setup(
      makeResult({
        level: 'session',
        sessionId: 'evalpoc-r2-s1',
        traceId: undefined,
        spanId: undefined,
        endTraceId: 'last-trace',
        source: 'agentcore',
      })
    );
    expect(screen.queryByTestId('agtEvlOpenTrace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlOpenSession'));
    expect(navigateToApp).toHaveBeenCalledWith(AGENT_TRACES_NAV_ID, {
      path: expect.stringContaining('openSessionId=evalpoc-r2-s1'),
    });
    await waitFor(() => expect(navigateToApp).toHaveBeenCalledTimes(1));
  });

  it('says when the judged spans are not found', async () => {
    const search = jest.fn(() => of(toResponse([])));
    render(
      <I18nProvider>
        <OpenSearchDashboardsContextProvider
          services={{ data: { search: { search } }, application: { navigateToApp: jest.fn() } }}
        >
          <ResultFlyout
            result={makeResult({ level: 'trace', traceId: 'gone', spanId: undefined })}
            onClose={jest.fn()}
            onOpenResult={jest.fn()}
          />
        </OpenSearchDashboardsContextProvider>
      </I18nProvider>
    );
    await waitFor(() => expect(screen.getByTestId('agtEvlTargetMissing')).toBeInTheDocument());
    expect(screen.getByTestId('agtEvlTargetMissing')).toHaveTextContent('otel-v1-apm-span-*');
  });

  it("reads the judged span from the config's traces dataset", async () => {
    resetEvalsDatasetState({
      status: 'ready',
      config: {
        configId: 'c',
        tracesDataset: { id: 'tr', title: 'agent-spans*' },
        evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*' },
        index: 'otel-v1-genai-evaluation*',
      },
    });
    try {
      const search = jest.fn(() => of(toResponse([])));
      render(
        <I18nProvider>
          <OpenSearchDashboardsContextProvider
            services={{ data: { search: { search } }, application: { navigateToApp: jest.fn() } }}
          >
            <ResultFlyout
              result={makeResult({ level: 'trace', traceId: 'gone', spanId: undefined })}
              onClose={jest.fn()}
              onOpenResult={jest.fn()}
            />
          </OpenSearchDashboardsContextProvider>
        </I18nProvider>
      );
      await waitFor(() => expect(screen.getByTestId('agtEvlTargetMissing')).toBeInTheDocument());
      expect(screen.getByTestId('agtEvlTargetMissing')).toHaveTextContent('agent-spans*');
      const queries = (
        search.mock.calls as unknown as Array<
          [{ params: { body: { query: { queries: Array<{ query: string }> } } } }]
        >
      ).map(([r]) => r.params.body.query.queries[0].query);
      expect(queries.some((q) => q.startsWith('source = agent-spans* |'))).toBe(true);
      expect(queries.some((q) => q.includes('otel-v1-apm-span'))).toBe(false);
    } finally {
      resetEvalsDatasetState();
    }
  });
});
