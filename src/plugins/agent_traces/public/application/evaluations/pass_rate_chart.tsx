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
  niceTimeFormatter,
} from '@elastic/charts';
import { i18n } from '@osd/i18n';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import type { EvaluationsServices } from '.';
import { formatTime } from './eval_components';

export interface ChartPoint {
  t: number;
  /** 0..1 */
  rate: number;
  /** Shown in the tooltip (a run's agent version). */
  label?: string;
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

/**
 * Pass rate in percent over time: one line, optional dashed markers (where a version starts),
 * and points (one per run on a suite).
 */
export const PassRateChart: React.FC<{
  id: string;
  points: ChartPoint[];
  markers?: ChartMarker[];
  showPoints?: boolean;
  height?: number;
  domain?: { min: number; max: number };
}> = ({ id, points, markers = [], showPoints = false, height = 200, domain }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const data = points.map((p) => ({ x: p.t, y: Math.round(p.rate * 100), label: p.label }));
  const xs = data.map((d) => d.x);
  const min = domain?.min ?? Math.min(...xs);
  const max = domain?.max ?? Math.max(...xs);
  return (
    <div style={{ height }} data-test-subj={`agtEvlChart-${id}`}>
      <Chart>
        <Settings
          // Room above the plot for the version labels.
          theme={[{ chartMargins: { top: 18 } }, ...(chartsTheme ? [chartsTheme] : [])]}
          baseTheme={baseTheme}
          showLegend={false}
          xDomain={Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined}
        />
        <Axis
          id={`${id}-x`}
          position={Position.Bottom}
          tickFormat={niceTimeFormatter([min, max])}
        />
        <Axis
          id={`${id}-y`}
          position={Position.Left}
          domain={{ min: 0, max: 100 }}
          tickFormat={(v) => `${v}%`}
          ticks={5}
          gridLine={{ visible: true }}
        />
        <LineSeries
          id={`${id}-rate`}
          name={i18n.translate('agentTraces.evals.chart.passRate', { defaultMessage: 'Pass rate' })}
          xScaleType={ScaleType.Time}
          yScaleType={ScaleType.Linear}
          xAccessor="x"
          yAccessors={['y']}
          data={data}
          color={euiThemeVars.euiColorPrimary}
          tickFormat={(v) => `${v}%`}
          lineSeriesStyle={{ point: { visible: showPoints ? 'always' : 'never', radius: 4 } }}
        />
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
