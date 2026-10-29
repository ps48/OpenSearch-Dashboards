/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import {
  ChartActionsContext,
  OutcomeHistogram,
  ScoreDistributionChart,
  ScoreTrendChart,
  bucketPoint,
  pointTitle,
} from './eval_charts';
import { makeResult } from './eval_test_fixtures';

/** A chart whose Settings exposes onElementClick as a button holding a datum. */
let mockDatum: unknown;
jest.mock('@elastic/charts', () => {
  const actual = jest.requireActual('@elastic/charts');
  return {
    ...actual,
    Chart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Settings: ({ onElementClick }: { onElementClick?: (e: unknown[]) => void }) =>
      onElementClick ? (
        <button
          data-test-subj="chartClick"
          onClick={() => onElementClick([[{ datum: mockDatum }, { specId: 'x' }]])}
        />
      ) : null,
    Axis: () => null,
    BarSeries: () => null,
    LineSeries: () => null,
    LineAnnotation: () => null,
  };
});

const HOUR = 3600 * 1000;
const bounds = { from: Date.UTC(2026, 9, 28, 0), to: Date.UTC(2026, 9, 28, 12) };

const renderWithActions = (chart: React.ReactElement) => {
  const actions = { showResults: jest.fn(), showTraces: jest.fn() };
  render(
    <I18nProvider>
      <ChartActionsContext.Provider value={actions}>{chart}</ChartActionsContext.Provider>
    </I18nProvider>
  );
  const click = () => {
    const target = screen.getByTestId('chartClick');
    fireEvent.mouseDown(target);
    fireEvent.click(target);
  };
  return { actions, click };
};

describe('chart click-through', () => {
  it('opens a menu for a bar of results over time, with its bucket, evaluation and verdict', () => {
    mockDatum = { x: bounds.from + HOUR, outcome: 'fail', count: 3 };
    const { actions, click } = renderWithActions(
      <OutcomeHistogram buckets={[]} bounds={bounds} interval={HOUR} height={100} name="tone" />
    );
    click();
    expect(screen.getByTestId('agtEvlChartPopover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlChartShowResults'));
    expect(actions.showResults).toHaveBeenCalledWith({
      from: bounds.from + HOUR,
      to: bounds.from + 2 * HOUR,
      name: 'tone',
      outcome: 'fail',
    });
    click();
    fireEvent.click(screen.getByTestId('agtEvlChartShowTraces'));
    expect(actions.showTraces).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tone', outcome: 'fail' })
    );
  });

  it('names the evaluation of a score trend point', () => {
    mockDatum = { x: bounds.from, name: 'accuracy', value: 0.5, count: 1 };
    const { actions, click } = renderWithActions(
      <ScoreTrendChart trend={[]} bounds={bounds} interval={HOUR} />
    );
    click();
    fireEvent.click(screen.getByTestId('agtEvlChartShowResults'));
    expect(actions.showResults).toHaveBeenCalledWith({
      from: bounds.from,
      to: bounds.from + HOUR,
      name: 'accuracy',
    });
  });

  it("scopes a run histogram bar to the run and its results' time", () => {
    mockDatum = { x: 0.2, outcome: 'pass', count: 1 };
    const results = [
      makeResult({ name: 'accuracy', value: 0.25, time: '2026-10-28 10:00:00.000' }),
      makeResult({ name: 'accuracy', value: 0.9, time: '2026-10-28 10:00:30.000' }),
    ];
    const { actions, click } = renderWithActions(
      <ScoreDistributionChart results={results} name="accuracy" runId="run-1" />
    );
    click();
    fireEvent.click(screen.getByTestId('agtEvlChartShowResults'));
    expect(actions.showResults).toHaveBeenCalledWith({
      from: Date.parse('2026-10-28T09:59:59Z'),
      to: Date.parse('2026-10-28T10:00:31Z'),
      name: 'accuracy',
      runId: 'run-1',
      outcome: 'pass',
    });
  });

  it('is not clickable without actions', () => {
    render(<OutcomeHistogram buckets={[]} bounds={bounds} interval={HOUR} height={100} />);
    expect(screen.queryByTestId('chartClick')).not.toBeInTheDocument();
  });

  it('titles a point with its evaluation, verdict and bucket', () => {
    const p = bucketPoint(Date.UTC(2026, 9, 28, 14), HOUR, { name: 'tone', outcome: 'fail' });
    expect(pointTitle(p)).toMatch(/^tone · Fail · Oct 28, \d\d:00 to Oct 28, \d\d:00$/);
    expect(pointTitle({ from: 0, to: 1 })).toMatch(/^All evaluations · /);
  });
});
