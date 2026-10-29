/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import { EuiContextMenuItem, EuiContextMenuPanel, EuiPopover, EuiPopoverTitle } from '@elastic/eui';
import {
  AnnotationDomainType,
  Axis,
  BarSeries,
  Chart,
  LineAnnotation,
  LineSeries,
  Position,
  ScaleType,
  Settings,
  Tooltip,
  XYChartElementEvent,
  niceTimeFormatter,
} from '@elastic/charts';
import { i18n } from '@osd/i18n';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { EvalOutcome, EvalResult, normalizedScore } from './eval_data';
import {
  OutcomeBucket,
  RunCaseRow,
  SuiteTrendPoint,
  TrendPoint,
  TimeBoundsMs,
  bucketOutcomes,
  parseEvalTime,
  scoreTrend,
} from './eval_aggregations';
import {
  OUTCOME_CHART_COLOR,
  OUTCOME_TEXT,
  formatEvalTime,
  seriesColor,
  shortId,
} from './eval_components';
import type { EvaluationsServices } from '.';

const useChartThemes = () => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const theme = services.charts?.theme;
  // The theme service hooks are stable for the app's lifetime.
  const chartsTheme = theme?.useChartsTheme();
  const baseTheme = theme?.useChartsBaseTheme();
  return { chartsTheme, baseTheme };
};

/** The results behind a chart point: a time bucket, an evaluation, a verdict, a run. */
export interface ChartPoint {
  /** Bucket start and end, epoch millis. */
  from: number;
  to: number;
  name?: string;
  outcome?: EvalOutcome;
  runId?: string;
}

/** What a chart point leads to. Absent: points are not clickable. */
export interface ChartActions {
  showResults: (point: ChartPoint) => void;
  showTraces: (point: ChartPoint) => void;
}

export const ChartActionsContext = createContext<ChartActions | undefined>(undefined);

export const pointTitle = (p: ChartPoint): string =>
  [
    p.name ??
      i18n.translate('agentTraces.evalsPage.pointAll', { defaultMessage: 'All evaluations' }),
    p.outcome ? OUTCOME_TEXT[p.outcome] : undefined,
    `${formatEvalTime(p.from, 'MMM D, HH:mm')} to ${formatEvalTime(p.to, 'MMM D, HH:mm')}`,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * Click a bar or point: a small menu at the pointer with Show these results and Show these
 * traces. The pointer position is taken on mouse down, before the chart reports the element.
 */
const useChartPoint = () => {
  const actions = useContext(ChartActionsContext);
  const [open, setOpen] = useState<{ point: ChartPoint; x: number; y: number }>();
  const last = useRef({ x: 0, y: 0 });
  const wrapperProps = {
    style: { position: 'relative' as const },
    onMouseDownCapture: (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      last.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
  };
  const select = (point: ChartPoint | undefined) => {
    if (actions && point) setOpen({ point, ...last.current });
  };
  const close = () => setOpen(undefined);
  const popover =
    actions && open ? (
      <EuiPopover
        isOpen
        closePopover={close}
        panelPaddingSize="none"
        anchorPosition="downCenter"
        display="block"
        style={{ position: 'absolute', left: open.x, top: open.y, width: 1, height: 1 }}
        button={<span className="agtEvlChartAnchor" />}
        data-test-subj="agtEvlChartPopover"
      >
        <EuiPopoverTitle paddingSize="s">
          <span className="agtEvlNum">{pointTitle(open.point)}</span>
        </EuiPopoverTitle>
        <EuiContextMenuPanel
          size="s"
          items={[
            <EuiContextMenuItem
              key="results"
              icon="visTable"
              onClick={() => {
                close();
                actions.showResults(open.point);
              }}
              data-test-subj="agtEvlChartShowResults"
            >
              {i18n.translate('agentTraces.evalsPage.showTheseResults', {
                defaultMessage: 'Show these results',
              })}
            </EuiContextMenuItem>,
            <EuiContextMenuItem
              key="traces"
              icon="apmTrace"
              onClick={() => {
                close();
                actions.showTraces(open.point);
              }}
              data-test-subj="agtEvlChartShowTraces"
            >
              {i18n.translate('agentTraces.evalsPage.showTheseTraces', {
                defaultMessage: 'Show these traces',
              })}
            </EuiContextMenuItem>,
          ]}
        />
      </EuiPopover>
    ) : null;
  return { clickable: !!actions, wrapperProps, select, popover };
};

/** Small tick labels without tick marks, for the axis of a chart in a card. */
export const COMPACT_AXIS_STYLE = {
  tickLabel: { fontSize: 9, padding: { inner: 1, outer: 0 } },
  tickLine: { visible: false, size: 0, padding: 0 },
  axisLine: { visible: false },
};

/** A time bucket in a tooltip header: its start to its end. */
export const bucketRangeText = (from: number, to: number): string => {
  const sameDay = formatEvalTime(from, 'YYYY-MM-DD') === formatEvalTime(to, 'YYYY-MM-DD');
  return i18n.translate('agentTraces.evalsPage.bucketRange', {
    defaultMessage: '{from} to {to}',
    values: {
      from: formatEvalTime(from, 'MMM D, HH:mm'),
      to: formatEvalTime(to, sameDay ? 'HH:mm' : 'MMM D, HH:mm'),
    },
  });
};

/** A score bin in a tooltip header: `40% to 50%`. */
export const binRangeText = (x: number, width = 0.1): string =>
  i18n.translate('agentTraces.evalsPage.binRange', {
    defaultMessage: '{from} to {to}',
    values: {
      from: `${Math.round(x * 100)}%`,
      to: `${Math.round(Math.min(1, x + width) * 100)}%`,
    },
  });

/** The datum under a click on an XY chart. */
const datumOf = <T,>(elements: unknown[]): T | undefined => {
  const [first] = elements as XYChartElementEvent[];
  return (first?.[0] as { datum?: T } | undefined)?.datum;
};

/** Points of the results over time: one per bucket start, a click names its bucket. */
export const bucketPoint = (
  x: number,
  interval: number,
  extra: Omit<ChartPoint, 'from' | 'to'> = {}
): ChartPoint => ({ from: x, to: x + interval, ...extra });

const OUTCOMES: EvalOutcome[] = ['fail', 'error', 'neutral', 'pass'];

/** Results per time bucket, stacked by outcome (fail at the bottom, where the eye starts). */
export const OutcomeHistogram: React.FC<{
  /** Results to bucket, or buckets already counted (server-side aggregations). */
  results?: EvalResult[];
  buckets?: OutcomeBucket[];
  bounds: TimeBoundsMs;
  interval: number;
  height: number;
  compact?: boolean;
  /** The evaluation the chart is about, carried by a clicked bar. */
  name?: string;
  'data-test-subj'?: string;
}> = ({ results, buckets, bounds, interval, height, compact, name, ...rest }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const point = useChartPoint();
  const data = useMemo(
    () => buckets ?? bucketOutcomes(results ?? [], interval),
    [buckets, results, interval]
  );
  const formatter = useMemo(() => niceTimeFormatter([bounds.from, bounds.to]), [bounds]);
  return (
    <div
      {...point.wrapperProps}
      style={{ ...point.wrapperProps.style, height }}
      data-test-subj={rest['data-test-subj'] ?? 'agtEvlOutcomeHistogram'}
    >
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend={!compact}
          legendPosition={Position.Right}
          xDomain={{ min: bounds.from, max: bounds.to, minInterval: interval }}
          onElementClick={
            point.clickable
              ? (elements) => {
                  const d = datumOf<OutcomeBucket>(elements);
                  if (d) point.select(bucketPoint(d.x, interval, { name, outcome: d.outcome }));
                }
              : undefined
          }
        />
        <Tooltip
          headerFormatter={({ value }) => bucketRangeText(Number(value), Number(value) + interval)}
        />
        {/* In a card: a few small time ticks (start, middle, end), no count axis. */}
        <Axis
          id="time"
          position={Position.Bottom}
          tickFormat={formatter}
          ticks={compact ? 3 : undefined}
          style={compact ? COMPACT_AXIS_STYLE : undefined}
          showOverlappingTicks={!compact}
        />
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
      {point.popover}
    </div>
  );
};

/** Normalized mean score (0 to 1, higher is better) per evaluation over time. */
export const ScoreTrendChart: React.FC<{
  /** Results to average, or points already averaged (server-side aggregations). */
  results?: EvalResult[];
  trend?: TrendPoint[];
  bounds: TimeBoundsMs;
  interval: number;
  height?: number;
}> = ({ results, trend, bounds, interval, height = 240 }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const point = useChartPoint();
  const points = useMemo(
    () => trend ?? scoreTrend(results ?? [], interval),
    [trend, results, interval]
  );
  const names = useMemo(() => Array.from(new Set(points.map((p) => p.name))).sort(), [points]);
  const formatter = useMemo(() => niceTimeFormatter([bounds.from, bounds.to]), [bounds]);
  return (
    <div
      {...point.wrapperProps}
      style={{ ...point.wrapperProps.style, height }}
      data-test-subj="agtEvlScoreTrend"
    >
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend
          legendPosition={Position.Right}
          xDomain={{ min: bounds.from, max: bounds.to }}
          onElementClick={
            point.clickable
              ? (elements) => {
                  const d = datumOf<TrendPoint>(elements);
                  if (d) point.select(bucketPoint(d.x, interval, { name: d.name }));
                }
              : undefined
          }
        />
        <Tooltip
          headerFormatter={({ value }) => bucketRangeText(Number(value), Number(value) + interval)}
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
            color={seriesColor(names.indexOf(name))}
            lineSeriesStyle={{ point: { visible: true, radius: 2 } }}
          />
        ))}
      </Chart>
      {point.popover}
    </div>
  );
};

const percentTick = (v: number) => `${Math.round(v * 100)}%`;

/** The run the page is about, on its suite's trend: the theme's primary color. */
const CURRENT_RUN_COLOR = euiThemeVars.euiColorPrimary;

/** Normalized score bins (0 to 100%, 10 bins) stacked by outcome. */
export const scoreBins = (results: EvalResult[], bins = 10) => {
  const counts = new Map<string, { x: number; outcome: EvalOutcome; count: number }>();
  results.forEach((r) => {
    const score = normalizedScore(r);
    if (score === undefined) return;
    const bin = Math.min(bins - 1, Math.floor(score * bins));
    const x = bin / bins;
    const key = `${x}|${r.outcome}`;
    const entry = counts.get(key) ?? { x, outcome: r.outcome, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  });
  return Array.from(counts.values()).sort((a, b) => a.x - b.x);
};

/** How the scores of one evaluation spread: normalized score bins colored by outcome. */
export const ScoreDistributionChart: React.FC<{
  results: EvalResult[];
  height?: number;
  /** The evaluation and run the bins are about, carried by a clicked bar. */
  name?: string;
  runId?: string;
}> = ({ results, height = 160, name, runId }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const data = useMemo(() => scoreBins(results), [results]);
  const point = useChartPoint();
  // A bar of a run's histogram: its verdict over the time the run's results span.
  const span = useMemo(() => {
    const times = results.map((r) => parseEvalTime(r.time)).filter(Number.isFinite);
    return times.length
      ? { from: Math.min(...times) - 1000, to: Math.max(...times) + 1000 }
      : undefined;
  }, [results]);
  return (
    <div
      {...point.wrapperProps}
      style={{ ...point.wrapperProps.style, height }}
      data-test-subj="agtEvlScoreDistribution"
    >
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend={false}
          xDomain={{ min: 0, max: 0.9, minInterval: 0.1 }}
          onElementClick={
            point.clickable && span
              ? (elements) => {
                  const d = datumOf<{ outcome: EvalOutcome }>(elements);
                  if (d) point.select({ ...span, name, runId, outcome: d.outcome });
                }
              : undefined
          }
        />
        <Tooltip headerFormatter={({ value }) => binRangeText(Number(value))} />
        <Axis
          id="score"
          position={Position.Bottom}
          tickFormat={(v: number) => `${percentTick(v)}+`}
          title={i18n.translate('agentTraces.evalsPage.distributionAxis', {
            defaultMessage: 'Normalized score',
          })}
        />
        <Axis id="count" position={Position.Left} ticks={3} />
        {OUTCOMES.map((outcome) => (
          <BarSeries
            key={outcome}
            id={outcome}
            name={OUTCOME_TEXT[outcome]}
            xScaleType={ScaleType.Linear}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['count']}
            stackAccessors={['x']}
            color={OUTCOME_CHART_COLOR[outcome]}
            data={data.filter((d) => d.outcome === outcome)}
          />
        ))}
      </Chart>
      {point.popover}
    </div>
  );
};

/** Normalized score per test case, one bar per evaluation, worst cases first. */
export const CaseScoresChart: React.FC<{
  cases: RunCaseRow[];
  evaluatorNames: string[];
  height?: number;
}> = ({ cases, evaluatorNames, height = 220 }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const data = useMemo(
    () =>
      cases.flatMap((c) =>
        evaluatorNames
          .filter((name) => c.evaluators[name]?.normalizedMean !== undefined)
          .map((name) => ({
            x: c.caseName ?? shortId(c.caseId, 16),
            name,
            value: c.evaluators[name].normalizedMean as number,
          }))
      ),
    [cases, evaluatorNames]
  );
  return (
    <div style={{ height }} data-test-subj="agtEvlCaseScoresChart">
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend={evaluatorNames.length > 1}
          legendPosition={Position.Bottom}
        />
        <Axis id="case" position={Position.Bottom} />
        <Axis
          id="score"
          position={Position.Left}
          domain={{ min: 0, max: 1 }}
          ticks={5}
          tickFormat={percentTick}
        />
        {evaluatorNames.map((name, i) => (
          <BarSeries
            key={name}
            id={name}
            name={name}
            xScaleType={ScaleType.Ordinal}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['value']}
            color={seriesColor(i)}
            data={data.filter((d) => d.name === name)}
          />
        ))}
      </Chart>
    </div>
  );
};

/**
 * One point per run of the suite: the share of passing test cases and each evaluation's
 * normalized mean, with the current run marked. Clicking a point opens that run.
 */
export const SuiteTrendChart: React.FC<{
  points: SuiteTrendPoint[];
  currentRunId: string;
  onSelectRun?: (runId: string) => void;
  height?: number;
}> = ({ points, currentRunId, onSelectRun, height = 220 }) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const names = useMemo(
    () => Array.from(new Set(points.flatMap((p) => Object.keys(p.evaluators)))).sort(),
    [points]
  );
  const xs = points.map((p) => p.x);
  const formatter = useMemo(
    () =>
      xs.length > 1
        ? niceTimeFormatter([Math.min(...xs), Math.max(...xs)])
        : (v: number) => formatEvalTime(v, 'MMM D, HH:mm'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xs.join(',')]
  );
  const current = points.find((p) => p.runId === currentRunId);
  const xDomain = useMemo(() => {
    if (xs.length === 0) return undefined;
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const pad = Math.max((max - min) * 0.04, 60 * 60 * 1000);
    return { min: min - pad, max: max + pad };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xs.join(',')]);
  const thisRunLabel = i18n.translate('agentTraces.evalsPage.trendThisRun', {
    defaultMessage: 'This run',
  });
  const currentPoints = current
    ? [
        ...(current.passRate !== undefined ? [{ x: current.x, y: current.passRate }] : []),
        ...Object.values(current.evaluators).map((y) => ({ x: current.x, y })),
      ]
    : [];
  const runAt = useMemo(() => new Map(points.map((p) => [p.x, p.runId])), [points]);
  const passLabel = i18n.translate('agentTraces.evalsPage.trendPassRate', {
    defaultMessage: 'Test cases passed',
  });
  return (
    <div style={{ height }} data-test-subj="agtEvlSuiteTrend">
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend
          legendPosition={Position.Bottom}
          // Room on both sides, so the first and last runs' rings are not cut at the edge.
          xDomain={xDomain}
          onElementClick={(elements) => {
            const [first] = elements as XYChartElementEvent[];
            const runId = first ? runAt.get(Number(first[0].x)) : undefined;
            if (runId && onSelectRun) onSelectRun(runId);
          }}
        />
        <Axis id="time" position={Position.Bottom} tickFormat={formatter} showOverlappingTicks />
        <Axis
          id="score"
          position={Position.Left}
          domain={{ min: 0, max: 1 }}
          ticks={5}
          tickFormat={percentTick}
        />
        {current && (
          // A dashed vertical line through the run, plus ringed points on its values.
          <LineAnnotation
            id="currentRun"
            domainType={AnnotationDomainType.XDomain}
            dataValues={[{ dataValue: current.x, details: thisRunLabel }]}
            style={{
              line: { stroke: CURRENT_RUN_COLOR, strokeWidth: 1, opacity: 0.8, dash: [4, 3] },
            }}
          />
        )}
        {current && currentPoints.length > 0 && (
          <LineSeries
            id="currentRunPoints"
            name={thisRunLabel}
            xScaleType={ScaleType.Time}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['y']}
            color={CURRENT_RUN_COLOR}
            data={currentPoints}
            lineSeriesStyle={{
              line: { visible: false },
              point: { visible: true, radius: 7, strokeWidth: 2, fill: 'transparent', opacity: 1 },
            }}
          />
        )}
        <LineSeries
          id="passRate"
          name={passLabel}
          xScaleType={ScaleType.Time}
          yScaleType={ScaleType.Linear}
          xAccessor="x"
          yAccessors={['y']}
          color={OUTCOME_CHART_COLOR.pass}
          data={points
            .filter((p) => p.passRate !== undefined)
            .map((p) => ({ x: p.x, y: p.passRate }))}
          lineSeriesStyle={{ line: { strokeWidth: 3 }, point: { visible: true, radius: 4 } }}
        />
        {names.map((name, i) => (
          <LineSeries
            key={name}
            id={`evaluator-${name}`}
            name={name}
            xScaleType={ScaleType.Time}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['y']}
            color={seriesColor(i)}
            data={points
              .filter((p) => p.evaluators[name] !== undefined)
              .map((p) => ({ x: p.x, y: p.evaluators[name] }))}
            lineSeriesStyle={{ point: { visible: true, radius: 3 } }}
          />
        ))}
      </Chart>
    </div>
  );
};
