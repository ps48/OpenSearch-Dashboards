/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { ResultsTab, toResultRows } from './results_tab';
import { makeResult } from './eval_test_fixtures';

const results = [
  makeResult({
    name: 'tool_diversity',
    value: 0.33,
    label: 'Looping on one tool',
    explanation: 'x'.repeat(300),
    time: '2026-10-26 09:00:00',
    traceId: 'aaaaaaaabbbbbbbbccccccccdddddddd',
    spanId: '1111222233334444',
    serviceName: 'events-agent',
  }),
  makeResult({
    name: 'Helpfulness',
    label: 'Very Helpful',
    level: 'session',
    source: 'agentcore',
    sessionId: 'session-0123456789',
    traceId: undefined,
    spanId: undefined,
    agentName: 'Travel',
    time: '2026-10-26 10:00:00',
  }),
];

describe('ResultsTab', () => {
  it('renders one row per result, newest first, with outcome, level and target', () => {
    render(
      <I18nProvider>
        <ResultsTab results={results} onOpenResult={jest.fn()} />
      </I18nProvider>
    );
    const table = screen.getByTestId('agtEvlResultsTable');
    // Clickable rows are buttons for assistive tech, so select them as table rows.
    const rows = Array.from(table.querySelectorAll<HTMLElement>('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Helpfulness')).toBeInTheDocument();
    const pass = within(rows[0]).getByTestId('agtEvlOutcomeBadge');
    expect(pass).toHaveTextContent('Very Helpful');
    expect(pass).toHaveAttribute('data-outcome', 'pass');
    expect(within(rows[0]).getByText('Session session-0123')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Travel')).toBeInTheDocument();
    expect(within(rows[1]).getByTestId('agtEvlOutcomeBadge')).toHaveAttribute(
      'data-outcome',
      'fail'
    );
    expect(within(rows[1]).getByTestId('agtEvlOutcomeBadge')).toHaveTextContent(
      'Looping on one tool (0.33)'
    );
    expect(within(rows[1]).getByText('Span 11112222')).toBeInTheDocument();
    // explanation truncated in the cell
    expect(within(rows[1]).getByText(/^x+\.\.\.$/).textContent).toHaveLength(120);
  });

  it('opens a result on row click', () => {
    const onOpenResult = jest.fn();
    render(
      <I18nProvider>
        <ResultsTab results={results} onOpenResult={onOpenResult} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByTestId('agtEvlResultRow-fail'));
    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({ name: 'tool_diversity' }));
  });

  it('gives the exact total and says when the table lists only the latest results', () => {
    render(
      <I18nProvider>
        <ResultsTab results={results} total={12345} limit={2} onOpenResult={jest.fn()} />
      </I18nProvider>
    );
    expect(screen.getByTestId('agtEvlResultsTotal')).toHaveTextContent(
      '12,345 results. The table lists the latest 2'
    );
  });

  it('ranks failures before passes for the result sort', () => {
    const [fail, pass] = toResultRows(results);
    expect(fail.rank).toBeLessThan(pass.rank);
  });
});
