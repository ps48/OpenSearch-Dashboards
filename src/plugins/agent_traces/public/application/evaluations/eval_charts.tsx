/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
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
  XYChartElementEvent,
  niceTimeFormatter,
} from '@elastic/charts';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { EvalOutcome, EvalResult, normalizedScore } from './eval_data';
import {
  RunCaseRow,
  SuiteTrendPoint,
  TimeBoundsMs,
  bucketOutcomes,
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
            color={seriesColor(names.indexOf(name))}
            lineSeriesStyle={{ point: { visible: true, radius: 2 } }}
          />
        ))}
      </Chart>
    </div>
  );
};

const percentTick = (v: number) => `${Math.round(v * 100)}%`;

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
export const ScoreDistributionChart: React.FC<{ results: EvalResult[]; height?: number }> = ({
  results,
  height = 160,
}) => {
  const { chartsTheme, baseTheme } = useChartThemes();
  const data = useMemo(() => scoreBins(results), [results]);
  return (
    <div style={{ height }} data-test-subj="agtEvlScoreDistribution">
      <Chart size={{ height }}>
        <Settings
          theme={chartsTheme}
          baseTheme={baseTheme}
          showLegend={false}
          xDomain={{ min: 0, max: 0.9, minInterval: 0.1 }}
        />
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
          <LineAnnotation
            id="currentRun"
            domainType={AnnotationDomainType.XDomain}
            dataValues={[{ dataValue: current.x, details: currentRunId }]}
            marker={<span className="agtEvlTrendMarker" />}
            hideTooltips
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
