/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EvalFiltersBar, countBy, optionsFor } from './eval_filters_bar';
import { DEFAULT_APP_STATE, EvalAppState } from './eval_url_state';
import { Facet } from './eval_ppl';

const facets: Facet[] = [
  { name: 'accuracy', level: 'trace', source: 'opensearch-sdk', outcome: 'fail', count: 3 },
  { name: 'accuracy', level: 'trace', source: 'opensearch-sdk', outcome: 'pass', count: 5 },
  { name: 'Builtin.Helpfulness', level: 'session', source: 'agentcore', outcome: 'pass', count: 2 },
  { name: 'latency', level: 'span', source: 'otel', outcome: 'neutral', count: 4 },
  { name: 'custom', level: 'agent_step', source: 'my-harness', outcome: 'error', count: 1 },
];

const renderBar = (state: Partial<EvalAppState> = {}) => {
  const onChange = jest.fn();
  render(
    <EvalFiltersBar
      state={{ ...DEFAULT_APP_STATE, ...state }}
      facets={facets}
      onChange={onChange}
    />
  );
  return onChange;
};

/** The labels a combo box lists, opened with a click on it. */
const optionLabels = (testSubj: string) => {
  fireEvent.click(within(screen.getByTestId(testSubj)).getByTestId('comboBoxSearchInput'));
  return screen.getAllByRole('option').map((o) => o.textContent);
};

describe('optionsFor', () => {
  it('lists the values of the data with counts, most results first', () => {
    const counts = countBy(facets, 'name');
    expect(optionsFor(counts, [], (v) => v).map((o) => o.label)).toEqual([
      'accuracy (8)',
      'latency (4)',
      'Builtin.Helpfulness (2)',
      'custom (1)',
    ]);
  });

  it('keeps a selected value the range does not hold, with 0', () => {
    expect(optionsFor(new Map([['a', 1]]), ['gone'], (v) => v)).toEqual([
      { label: 'a (1)', value: 'a' },
      { label: 'gone (0)', value: 'gone' },
    ]);
  });
});

describe('EvalFiltersBar', () => {
  it('builds every picker from the data in the range, with counts', () => {
    renderBar();
    expect(optionLabels('agtEvlFilterLevels')).toEqual([
      'Trace (8)',
      'Span (4)',
      'Session (2)',
      'agent_step (1)',
    ]);
  });

  it('names sources, showing an unknown source as is', () => {
    renderBar();
    expect(optionLabels('agtEvlFilterSources')).toEqual([
      'OpenSearch SDK (8)',
      'OpenTelemetry (4)',
      'Bedrock AgentCore (2)',
      'my-harness (1)',
    ]);
  });

  it('lists the verdicts the range holds, failures first, with counts', () => {
    renderBar();
    expect(optionLabels('agtEvlFilterVerdicts')).toEqual([
      'Fail (3)',
      'Pass (7)',
      'Evaluator error (1)',
      'Scored (4)',
    ]);
  });

  it('keeps a selected value visible with zero results', () => {
    renderBar({ sources: ['vertex'], verdicts: ['error'], names: ['gone'] });
    expect(screen.getByTestId('agtEvlFilterSources')).toHaveTextContent('vertex (0)');
    expect(screen.getByTestId('agtEvlFilterNames')).toHaveTextContent('gone (0)');
    expect(screen.getByTestId('agtEvlFilterVerdicts')).toHaveTextContent('Evaluator error (1)');
  });

  it('lists nothing hardcoded when the range is empty', () => {
    render(<EvalFiltersBar state={DEFAULT_APP_STATE} facets={[]} onChange={jest.fn()} />);
    fireEvent.click(
      within(screen.getByTestId('agtEvlFilterLevels')).getByTestId('comboBoxSearchInput')
    );
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
