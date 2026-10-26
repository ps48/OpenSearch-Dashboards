/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { RunsTab } from './runs_tab';
import { formatDelta } from './compare_runs';
import { twoRunFixture } from './eval_test_fixtures';

const renderRuns = (props: Partial<React.ComponentProps<typeof RunsTab>> = {}) => {
  const onCompareChange = jest.fn();
  const onOpenTrace = jest.fn();
  render(
    <I18nProvider>
      <RunsTab
        results={twoRunFixture()}
        onCompareChange={onCompareChange}
        onOpenTrace={onOpenTrace}
        {...props}
      />
    </I18nProvider>
  );
  return { onCompareChange, onOpenTrace };
};

describe('RunsTab', () => {
  it('explains how to produce runs when there are none', () => {
    renderRuns({ results: [] });
    expect(screen.getByTestId('agtEvlNoRuns')).toHaveTextContent('test.suite.run.id');
  });

  it('lists runs with cases, per-evaluation means and a regression marker', () => {
    renderRuns();
    const table = screen.getByTestId('agtEvlRunsTable');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('run-2')).toBeInTheDocument();
    expect(within(rows[0]).getByTestId('agtEvlRegression')).toBeInTheDocument();
    expect(within(rows[0]).getByText('0.57')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('agtEvlRegression')).not.toBeInTheDocument();
  });

  it('compares two selected runs of a suite, oldest as baseline', () => {
    const { onCompareChange } = renderRuns();
    const button = screen.getByTestId('agtEvlCompareButton');
    expect(button).toBeDisabled();
    // Row checkboxes only (the header has select-all boxes for desktop and mobile).
    const boxes = () =>
      Array.from(
        screen
          .getByTestId('agtEvlRunsTable')
          .querySelectorAll<HTMLElement>('tbody input[type=checkbox]')
      );
    fireEvent.click(boxes()[0]);
    expect(button).toBeDisabled();
    fireEvent.click(boxes()[1]);
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onCompareChange).toHaveBeenCalledWith(['run-1', 'run-2']);
  });

  it('shows the comparison with filter chips and per-case deltas', () => {
    const { onCompareChange } = renderRuns({ compare: ['run-1', 'run-2'] });
    const compare = screen.getByTestId('agtEvlCompare');
    expect(within(compare).getByText('Compare runs: travel-suite')).toBeInTheDocument();
    const evaluator = screen.getByTestId('agtEvlCompareEvaluator');
    expect(evaluator).toHaveTextContent('0.65 → 0.57');
    expect(evaluator).toHaveTextContent('1 improved, 1 regressed, 0 unchanged');
    const cases = () =>
      within(screen.getByTestId('agtEvlCompareCases')).getAllByRole('row').slice(1);
    expect(cases()).toHaveLength(3);
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-regressed'));
    expect(cases()).toHaveLength(1);
    expect(cases()[0]).toHaveTextContent('Case b');
    expect(within(cases()[0]).getByTestId('agtEvlDeltaChip-regressed')).toHaveTextContent('-0.70');
    fireEvent.click(screen.getByTestId('agtEvlCaseFilter-new'));
    expect(cases()[0]).toHaveTextContent('Case c');
    fireEvent.click(screen.getByTestId('agtEvlCompareSwap'));
    expect(onCompareChange).toHaveBeenCalledWith(['run-2', 'run-1']);
    fireEvent.click(screen.getByTestId('agtEvlCompareBack'));
    expect(onCompareChange).toHaveBeenCalledWith(undefined);
  });

  it('warns when a compared run is outside the time range', () => {
    renderRuns({ compare: ['run-1', 'gone'] });
    expect(screen.getByTestId('agtEvlCompareMissing')).toBeInTheDocument();
  });
});

describe('formatDelta', () => {
  const agg = (mean?: number, passRate?: number) => ({ name: 'x', count: 1, mean, passRate });
  it('uses score points when both runs have scores', () => {
    expect(formatDelta({ baseline: agg(0.5), candidate: agg(0.75), change: 'improved' })).toBe(
      '+0.25'
    );
  });
  it('uses pass-rate points for labels', () => {
    expect(
      formatDelta({
        baseline: agg(undefined, 0.5),
        candidate: agg(undefined, 0.25),
        change: 'regressed',
      })
    ).toBe('-25 pts');
  });
  it('has no delta for a new value', () => {
    expect(formatDelta({ candidate: agg(1), change: 'new' })).toBeUndefined();
  });
});
