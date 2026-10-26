/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  Axis,
  BarSeries,
  Chart,
  LineSeries,
  Position,
  ScaleType,
  Settings,
  niceTimeFormatter,
} from '@elastic/charts';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { EvalOutcome, EvalResult } from './eval_data';
import { TimeBoundsMs, bucketOutcomes, scoreTrend } from './eval_aggregations';
import { OUTCOME_CHART_COLOR, OUTCOME_TEXT } from './eval_components';
import type { EvaluationsServices } from '.';

const useChartThemes = () => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const theme = services.charts?.theme;
  // The theme service hooks are stable for the app's lifetime.
  const chartsTheme = theme?.useChartsTheme();
  const baseTheme = theme?.useChartsBaseTheme();
  return { chartsTheme, baseTheme };
};

const OUTCOMES: EvalOutcome[] = ['fail', 'neutral', 'pass'];

/** Results per time bucket, stacked by outcome (fail at the bottom, where the eye starts). */
export const OutcomeHistogram: React.FC<{
  results: EvalResult[];
  bounds: TimeBoundsMs;
  interval: number;
  height: number;
  compact?: boolean;
  'data-test-subj'?: string;
}> = ({ results, bounds, interval, height, compact, ...rest }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const data = useMemo(() => bucketOutcomes(results, interval), [results, interval]);
  const formatter = useMemo(() => niceTimeFormatter([bounds.from, bounds.to]), [bounds]);
  return (
    <div style={{ height }} data-test-subj={rest['data-test-subj'] ?? 'agtEvlOutcomeHistogram'}>
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend={!compact}
          legendPosition={Position.Right}
          xDomain={{ min: bounds.from, max: bounds.to, minInterval: interval }}
        />
        {!compact && (
          <Axis id="time" position={Position.Bottom} tickFormat={formatter} showOverlappingTicks />
        )}
        {!compact && <Axis id="count" position={Position.Left} ticks={3} />}
        {OUTCOMES.map((outcome) => (
          <BarSeries
            key={outcome}
            id={outcome}
            name={OUTCOME_TEXT[outcome]}
            xScaleType={ScaleType.Time}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['count']}
            stackAccessors={['x']}
            color={OUTCOME_CHART_COLOR[outcome]}
            data={data.filter((d) => d.outcome === outcome)}
          />
        ))}
      </Chart>
    </div>
  );
};

/** Normalized mean score (0 to 1, higher is better) per evaluation over time. */
export const ScoreTrendChart: React.FC<{
  results: EvalResult[];
  bounds: TimeBoundsMs;
  interval: number;
  height?: number;
}> = ({ results, bounds, interval, height = 240 }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const points = useMemo(() => scoreTrend(results, interval), [results, interval]);
  const names = useMemo(() => Array.from(new Set(points.map((p) => p.name))).sort(), [points]);
  const formatter = useMemo(() => niceTimeFormatter([bounds.from, bounds.to]), [bounds]);
  return (
    <div style={{ height }} data-test-subj="agtEvlScoreTrend">
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend
          legendPosition={Position.Right}
          xDomain={{ min: bounds.from, max: bounds.to }}
        />
        <Axis id="time" position={Position.Bottom} tickFormat={formatter} showOverlappingTicks />
        <Axis
          id="score"
          position={Position.Left}
          domain={{ min: 0, max: 1 }}
          ticks={5}
          tickFormat={(v: number) => `${Math.round(v * 100)}%`}
          title={i18n.translate('agentTraces.evalsPage.trendAxis', {
            defaultMessage: 'Normalized score',
          })}
        />
        {names.map((name) => (
          <LineSeries
            key={name}
            id={name}
            name={name}
            xScaleType={ScaleType.Time}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['value']}
            data={points.filter((p) => p.name === name)}
            lineSeriesStyle={{ point: { visible: true, radius: 2 } }}
          />
        ))}
      </Chart>
    </div>
  );
};
