/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { FailingEvaluationFilter } from './failing_evaluation_filter';
import {
  failingTracesOf,
  getFailingTracesFilter,
  setFailingTracesFilter,
  withFailingFilter,
  withFailingTracesFilter,
} from '../../evaluations/failing_traces_filter';
import { buildFailingTracesQuery } from '../../evaluations/eval_ppl';

const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('../../utils/state_management/actions/query_actions', () => ({
  executeQueries: (arg: unknown) => ({ type: 'executeQueries', arg }),
  defaultPrepareQueryString: (q: { query: string }) => q.query,
}));
const mockServices = {
  data: {
    query: {
      timefilter: {
        timefilter: {
          getTime: () => ({ from: 'now-24h', to: 'now' }),
          calculateBounds: () => ({
            min: { toISOString: () => '2026-11-02T00:00:00.000Z' },
            max: { valueOf: () => 0 },
          }),
          getTimeUpdate$: () => ({ subscribe: () => ({ unsubscribe: jest.fn() }) }),
        },
      },
    },
  },
};
jest.mock('../../../../../opensearch_dashboards_react/public', () => ({
  useOpenSearchDashboards: () => ({ services: mockServices }),
}));
jest.mock('../../evaluations/eval_feature_flag', () => ({ useAgentEvalsEnabled: () => true }));
jest.mock('../../evaluations/eval_dataset', () => ({ useEvalsIndexPattern: () => 'evals-*' }));
const mockRunPpl = jest.fn();
jest.mock('../../evaluations/use_ppl_rows', () => ({
  ...jest.requireActual('../../evaluations/use_ppl_rows'),
  runPpl: (...args: unknown[]) => mockRunPpl(...args),
}));

const T = 'traceId';

describe('Failing evaluations only (Agent Traces)', () => {
  afterEach(() => {
    setFailingTracesFilter(undefined);
    mockDispatch.mockClear();
    mockRunPpl.mockReset();
  });

  it('narrows the traces query to the failing trace ids', () => {
    expect(withFailingTracesFilter('| where a = 1')).toBe('| where a = 1');
    const f = { traceIds: ['abc', 'def'], capped: false };
    expect(withFailingTracesFilter('| where a = 1', f)).toBe(
      "| where a = 1 | where `traceId` in ('abc', 'def')"
    );
    expect(withFailingTracesFilter('', f)).toBe("| where `traceId` in ('abc', 'def')");
    // No failing trace: an impossible id keeps the table empty instead of unfiltered.
    expect(withFailingTracesFilter('', { traceIds: [], capped: false })).toBe(
      "| where `traceId` in ('-')"
    );
  });

  it('applies to the Traces tab query only while on', () => {
    const prepare = withFailingFilter((q) => String(q.query));
    const query = { query: 'source = spans', language: 'PPL' };
    expect(prepare(query as never, [])).toBe('source = spans');
    setFailingTracesFilter({ traceIds: ['abc'], capped: false });
    expect(prepare(query as never, [])).toBe("source = spans | where `traceId` in ('abc')");
  });

  it('reads trace ids newest first and says when the 500 cap is hit', () => {
    expect(failingTracesOf([{ [T]: 'a' }, { [T]: "b' or 1=1" }, { [T]: 'c' }])).toEqual({
      traceIds: ['a', 'c'],
      capped: false,
    });
    const many = Array.from({ length: 500 }, (_, i) => ({ [T]: `t${i}` }));
    expect(failingTracesOf(many).capped).toBe(true);
  });

  it('is disabled with a spinner while the failing traces load', async () => {
    let resolve: (rows: unknown[]) => void = () => undefined;
    mockRunPpl.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(
      <I18nProvider>
        <FailingEvaluationFilter />
      </I18nProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('agtEvlFailingFilter'));
    });
    expect(screen.getByTestId('agtEvlFailingFilter')).toBeDisabled();
    expect(
      screen.getByTestId('agtEvlFailingFilterBar').querySelector('.euiLoadingSpinner')
    ).toBeInTheDocument();
    await act(async () => {
      resolve([{ [T]: 'a' }]);
    });
    expect(screen.getByTestId('agtEvlFailingFilter')).not.toBeDisabled();
    expect(screen.getByTestId('agtEvlFailingFilterBar')).toHaveTextContent(
      'Failing evaluations only (1)'
    );
    expect(
      screen.getByTestId('agtEvlFailingFilterBar').querySelector('.euiLoadingSpinner')
    ).not.toBeInTheDocument();
  });

  it('turning it on runs one bounded query, then the traces query again', async () => {
    mockRunPpl.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ [T]: `t${i}` })));
    render(
      <I18nProvider>
        <FailingEvaluationFilter />
      </I18nProvider>
    );
    const toggle = screen.getByTestId('agtEvlFailingFilter');
    // A switch, off at first, with no count yet.
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Failing evaluations only')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(mockRunPpl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('agtEvlFailingFilter')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('agtEvlFailingFilterBar')).toHaveTextContent(
      'Failing evaluations only (500)'
    );
    const [, dataset, query, range] = mockRunPpl.mock.calls[0];
    expect(query).toBe(buildFailingTracesQuery('evals-*'));
    expect((dataset as { timeFieldName: string }).timeFieldName).toBe('@timestamp');
    expect((range as { from: string }).from).toBe('2026-11-02T00:00:00.000Z');
    expect(getFailingTracesFilter()?.traceIds).toHaveLength(500);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('agtEvlFailingFilterCapped')).toHaveTextContent(
      'Showing the 500 most recent failing traces in the range'
    );
    // Off: the filter is dropped and the traces query runs again.
    await act(async () => {
      fireEvent.click(screen.getByTestId('agtEvlFailingFilter'));
    });
    expect(getFailingTracesFilter()).toBeUndefined();
    expect(screen.getByTestId('agtEvlFailingFilter')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('agtEvlFailingFilterCapped')).not.toBeInTheDocument();
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockRunPpl).toHaveBeenCalledTimes(1);
  });
});
