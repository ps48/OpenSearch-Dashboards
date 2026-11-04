/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  AnnotationDomainType,
  Axis,
  Chart,
  LineAnnotation,
  LineSeries,
  Position,
  ScaleType,
  Settings,
  BrushEndListener,
  XYChartElementEvent,
} from '@elastic/charts';
import { i18n } from '@osd/i18n';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import type { EvaluationsServices } from '.';
import { formatTime } from './eval_components';
import { axisTimeFormat, formatInUtc, getEvalTimezone } from './eval_time';

export interface ChartPoint {
  t: number;
  /** 0..1 */
  rate: number;
  /** Shown in the tooltip (a run's agent version). */
  label?: string;
}

/** One line (a version on the agent page). */
export interface ChartSeries {
  id: string;
  name: string;
  points: ChartPoint[];
}

export interface ChartMarker {
  t: number;
  label: string;
}

const useChartThemes = () => {
  const { services } = useOpenSearchDashboards<Partial<EvaluationsServices>>();
  const theme = services?.charts?.theme;
  // The theme service hooks are stable for the app's lifetime.
  return { chartsTheme: theme?.useChartsTheme(), baseTheme: theme?.useChartsBaseTheme() };
};

/** Drag across the chart to zoom: sets the global time range, as Discover's histogram does. */
const useBrushToTime = (): BrushEndListener | undefined => {
  const { services } = useOpenSearchDashboards<Partial<EvaluationsServices>>();
  const timefilter = services?.data?.query.timefilter.timefilter;
  if (!timefilter) return undefined;
  return (event) => {
    if (!('x' in event) || !event.x) return;
    const [from, to] = event.x as [number, number];
    if (!(to > from)) return;
    timefilter.setTime({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  };
};

const toData = (points: ChartPoint[]) =>
  points.map((p) => ({ x: p.t, y: Math.round(p.rate * 100), label: p.label }));

/**
 * Pass rate in percent over time: one line (or one per series, with a legend), optional dashed
 * markers, and points (one per run on a suite). `onPointClick`: a click on a point gives its x.
 * Dragging across the chart sets the global time range to the selection.
 */
export const PassRateChart: React.FC<{
  id: string;
  points?: ChartPoint[];
  series?: ChartSeries[];
  markers?: ChartMarker[];
  showPoints?: boolean;
  height?: number;
  domain?: { min: number; max: number };
  onPointClick?: (t: number) => void;
  /**
   * Points are UTC day or week buckets (`span(@timestamp, 1d)` starts at UTC midnight): the
   * axis is labelled in UTC, so a bucket is not shown under the previous day's date.
   */
  utc?: boolean;
}> = ({
  id,
  points = [],
  series,
  markers = [],
  showPoints = false,
  height = 200,
  domain,
  onPointClick,
  utc = false,
}) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const onBrushEnd = useBrushToTime();
  const lines: ChartSeries[] = series ?? [
    {
      id: 'rate',
      name: i18n.translate('agentTraces.evals.chart.passRate', { defaultMessage: 'Pass rate' }),
      points,
    },
  ];
  const xs = lines.flatMap((l) => l.points.map((p) => p.t));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  // Pad the data's ends so the first and last points (and their markers) are not cut off.
  const pad = Number.isFinite(hi - lo) ? Math.max((hi - lo) * 0.02, 60e3) : 0;
  const min = domain?.min ?? lo - pad;
  const max = domain?.max ?? hi + pad;
  return (
    <div style={{ height }} data-test-subj={`agtEvlChart-${id}`}>
      <Chart>
        <Settings
          // Room above the plot for the version labels.
          theme={[{ chartMargins: { top: 18 } }, ...(chartsTheme ? [chartsTheme] : [])]}
          baseTheme={baseTheme}
          showLegend={!!series}
          legendPosition={Position.Top}
          onElementClick={
            onPointClick
              ? (elements) => {
                  const [geometry] = (elements[0] ?? []) as XYChartElementEvent;
                  if (geometry && typeof geometry.x === 'number') onPointClick(geometry.x);
                }
              : undefined
          }
          onBrushEnd={onBrushEnd}
          xDomain={Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined}
        />
        <Axis
          id={`${id}-x`}
          position={Position.Bottom}
          title={
            utc
              ? i18n.translate('agentTraces.evals.chart.utcAxis', { defaultMessage: 'UTC' })
              : undefined
          }
          tickFormat={(v: number) =>
            utc
              ? formatInUtc(v, axisTimeFormat(max - min))
              : formatTime(v, axisTimeFormat(max - min))
          }
        />
        <Axis
          id={`${id}-y`}
          position={Position.Left}
          domain={{ min: 0, max: 100 }}
          tickFormat={(v) => `${v}%`}
          ticks={5}
          gridLine={{ visible: true }}
        />
        {lines.map((line) => (
          <LineSeries
            key={line.id}
            id={`${id}-${line.id}`}
            name={line.name}
            xScaleType={ScaleType.Time}
            yScaleType={ScaleType.Linear}
            timeZone={utc ? 'UTC' : getEvalTimezone()}
            xAccessor="x"
            yAccessors={['y']}
            data={toData(line.points)}
            color={series ? undefined : euiThemeVars.euiColorPrimary}
            tickFormat={(v) => `${v}%`}
            lineSeriesStyle={{
              point: { visible: showPoints || onPointClick ? 'always' : 'never', radius: 3 },
            }}
          />
        ))}
        {markers.map((m, i) => (
          <LineAnnotation
            key={`${m.label}-${m.t}`}
            id={`${id}-version-${i}`}
            domainType={AnnotationDomainType.XDomain}
            dataValues={[{ dataValue: m.t, details: formatTime(m.t), header: m.label }]}
            marker={<span className="agtEvlChartMarker">{m.label}</span>}
            markerPosition={Position.Top}
            style={{
              line: {
                strokeWidth: 1,
                stroke: euiThemeVars.euiColorDarkShade,
                dash: [4, 4],
                opacity: 1,
              },
            }}
          />
        ))}
      </Chart>
    </div>
  );
};
