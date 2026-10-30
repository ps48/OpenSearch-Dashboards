/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import {
  ChartActionsContext,
  JudgedLatencyChart,
  OutcomeHistogram,
  ValueDistributionChart,
  formatMs,
  ScoreDistributionChart,
  ScoreTrendChart,
  binRangeText,
  bucketPoint,
  bucketRangeText,
  compactTicks,
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
    Axis: ({ id }: { id: string }) => <span data-test-subj={`chartAxis-${id}`} />,
    Tooltip: () => null,
    BarSeries: () => null,
    LineSeries: () => null,
    LineAnnotation: ({ id }: { id: string }) => <span data-test-subj={`chartAnnotation-${id}`} />,
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

describe('chart axes and tooltips', () => {
  it('gives a card histogram a compact time axis: start, middle and end, no count axis', () => {
    render(<OutcomeHistogram buckets={[]} bounds={bounds} interval={HOUR} height={56} compact />);
    expect(screen.getByTestId('agtEvlMiniAxis').querySelectorAll('span')).toHaveLength(3);
    expect(screen.queryByTestId('chartAxis-time')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chartAxis-count')).not.toBeInTheDocument();
  });

  it('labels the compact axis for the length of the range', () => {
    const from = Date.UTC(2026, 9, 28, 0);
    expect(compactTicks({ from, to: from + 12 * HOUR })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\d\d:\d\d$/)])
    );
    expect(compactTicks({ from, to: from + 2 * 24 * HOUR })[0]).toMatch(/^Oct \d+ \d\d:\d\d$/);
    expect(compactTicks({ from, to: from + 30 * 24 * HOUR })[2]).toMatch(/^Nov \d+$/);
  });

  it('keeps both axes on a full histogram', () => {
    render(<OutcomeHistogram buckets={[]} bounds={bounds} interval={HOUR} height={200} />);
    expect(screen.getByTestId('chartAxis-time')).toBeInTheDocument();
    expect(screen.getByTestId('chartAxis-count')).toBeInTheDocument();
  });

  it('names a time bucket and a score bin', () => {
    const from = Date.UTC(2026, 9, 28, 14);
    expect(bucketRangeText(from, from + HOUR)).toMatch(/^Oct 28, \d\d:00 to \d\d:00$/);
    expect(bucketRangeText(from, from + 3 * 24 * HOUR)).toMatch(
      /^Oct 28, \d\d:00 to Oct 31, \d\d:00$/
    );
    expect(binRangeText(0.4)).toBe('40% to 50%');
    expect(binRangeText(0.9)).toBe('90% to 100%');
  });
});

describe('Overview charts', () => {
  it('draws a value distribution with its threshold line', () => {
    render(
      <ValueDistributionChart
        distribution={{
          bins: [{ x: 1, outcome: 'fail', count: 2 }],
          width: 1,
          min: 1,
          max: 5,
          threshold: 4,
          total: 2,
        }}
      />
    );
    expect(screen.getByTestId('agtEvlValueDistribution')).toBeInTheDocument();
    expect(screen.getByTestId('chartAnnotation-threshold')).toBeInTheDocument();
  });

  it('has no threshold line without a threshold', () => {
    render(
      <ValueDistributionChart distribution={{ bins: [], width: 0.1, min: 0, max: 0.9, total: 0 }} />
    );
    expect(screen.queryByTestId('chartAnnotation-threshold')).not.toBeInTheDocument();
  });

  it('draws judged trace latency over the range', () => {
    render(
      <JudgedLatencyChart
        latency={{ points: [], passingCount: 0, failingCount: 0 }}
        bounds={{ from: 0, to: 3600 * 1000 }}
      />
    );
    expect(screen.getByTestId('agtEvlJudgedLatency')).toBeInTheDocument();
    expect(screen.getByTestId('chartAxis-latency')).toBeInTheDocument();
  });

  it('formats latencies', () => {
    expect(formatMs(850)).toBe('850 ms');
    expect(formatMs(2500)).toBe('2.5 s');
  });
});
