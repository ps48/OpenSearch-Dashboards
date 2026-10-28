/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  EuiEmptyPrompt,
  EuiFlexGrid,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { EvalOutcome, EvalResult, EvaluatorSummary, summarizeByEvaluator } from './eval_data';
import {
  EvalKpis,
  TimeBoundsMs,
  computeKpis,
  parseEvalTime,
  pickInterval,
} from './eval_aggregations';
import { OutcomeHistogram, ScoreTrendChart } from './eval_charts';
import {
  LevelBadge,
  OUTCOME_CHART_COLOR,
  OutcomeBadge,
  SectionHeader,
  SourceBadge,
  TargetText,
  formatCount,
  formatEvalTime,
  formatPercent,
  formatValue,
} from './eval_components';

export const RECENT_FAILURES_LIMIT = 10;

type Good = 'up' | 'down' | 'none';

/** Signed change vs the previous period, colored by whether the change is good. */
export const DeltaText: React.FC<{
  current?: number;
  previous?: number;
  /** `rate` values are 0..1 shown as percentage points. */
  kind: 'count' | 'rate' | 'score';
  good: Good;
}> = ({ current, previous, kind, good }) => {
  if (current === undefined || previous === undefined) {
    return (
      <EuiText size="xs" color="subdued">
        <FormattedMessage id="agentTraces.evalsPage.deltaNone" defaultMessage="No earlier data" />
      </EuiText>
    );
  }
  const diff = current - previous;
  const flat = Math.abs(diff) < (kind === 'count' ? 0.5 : 0.005);
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  const magnitude =
    kind === 'count'
      ? Math.abs(diff).toLocaleString()
      : kind === 'rate'
        ? `${Math.abs(diff * 100).toFixed(1)} pts`
        : Math.abs(diff).toFixed(2);
  const pct =
    kind === 'count' && previous > 0 && !flat
      ? ` (${sign}${Math.round(Math.abs(diff / previous) * 100)}%)`
      : '';
  const better = good === 'none' || flat ? undefined : diff > 0 === (good === 'up');
  const color = better === undefined ? 'subdued' : better ? 'success' : 'danger';
  return (
    <EuiText size="xs" color={color} data-test-subj="agtEvlDelta">
      {flat ? (
        <FormattedMessage id="agentTraces.evalsPage.deltaFlat" defaultMessage="No change" />
      ) : (
        <FormattedMessage
          id="agentTraces.evalsPage.delta"
          defaultMessage="{change} vs previous"
          values={{ change: `${sign}${magnitude}${pct}` }}
        />
      )}
    </EuiText>
  );
};

const KpiPanel: React.FC<{
  title: string;
  value: string;
  help: string;
  testSubj: string;
  children?: React.ReactNode;
}> = ({ title, value, help, testSubj, children }) => (
  <EuiPanel paddingSize="s" hasBorder className="agtEvlStatCard" data-test-subj={testSubj}>
    <EuiToolTip content={help}>
      <EuiText size="xs" color="subdued" className="agtEvlKpi__title">
        {title}
      </EuiText>
    </EuiToolTip>
    <EuiTitle size="m">
      <p className="agtEvlKpi__value">{value}</p>
    </EuiTitle>
    {children}
  </EuiPanel>
);

export const KpiRow: React.FC<{ current: EvalKpis; previous?: EvalKpis }> = ({
  current,
  previous,
}) => {
  const prev = (pick: (k: EvalKpis) => number | undefined) =>
    previous && previous.results > 0 ? pick(previous) : undefined;
  const items: Array<{
    id: string;
    title: string;
    help: string;
    value: string;
    current?: number;
    previous?: number;
    kind: 'count' | 'rate';
    good: Good;
  }> = [
    {
      id: 'Results',
      title: i18n.translate('agentTraces.evalsPage.kpiResults', { defaultMessage: 'Results' }),
      help: i18n.translate('agentTraces.evalsPage.kpiResultsHelp', {
        defaultMessage: 'Evaluation results in the time range under the filters.',
      }),
      value: formatCount(current.results),
      current: current.results,
      previous: prev((k) => k.results),
      kind: 'count',
      good: 'none',
    },
    {
      id: 'Evaluators',
      title: i18n.translate('agentTraces.evalsPage.kpiEvaluators', {
        defaultMessage: 'Evaluations',
      }),
      help: i18n.translate('agentTraces.evalsPage.kpiEvaluatorsHelp', {
        defaultMessage: 'Distinct evaluation names (gen_ai.evaluation.name) that reported results.',
      }),
      value: formatCount(current.evaluators),
      current: current.evaluators,
      previous: prev((k) => k.evaluators),
      kind: 'count',
      good: 'none',
    },
    {
      id: 'PassRate',
      title: i18n.translate('agentTraces.evalsPage.kpiPassRate', { defaultMessage: 'Pass rate' }),
      help: i18n.translate('agentTraces.evalsPage.kpiPassRateHelp', {
        defaultMessage:
          'Passing results among passing and failing ones. A known label decides (Pass, Yes, Very Helpful); otherwise the score is compared with the middle of its range, in its direction.',
      }),
      value: formatPercent(current.passRate),
      current: current.passRate,
      previous: prev((k) => k.passRate),
      kind: 'rate',
      good: 'up',
    },
    {
      id: 'Failing',
      title: i18n.translate('agentTraces.evalsPage.kpiFailing', {
        defaultMessage: 'Failing results',
      }),
      help: i18n.translate('agentTraces.evalsPage.kpiFailingHelp', {
        defaultMessage: 'Results whose label or score counts as a failure.',
      }),
      value: formatCount(current.failing),
      current: current.failing,
      previous: prev((k) => k.failing),
      kind: 'count',
      good: 'down',
    },
    {
      id: 'Traces',
      title: i18n.translate('agentTraces.evalsPage.kpiTraces', {
        defaultMessage: 'Evaluated traces',
      }),
      help: i18n.translate('agentTraces.evalsPage.kpiTracesHelp', {
        defaultMessage: 'Distinct traces judged by at least one result (span or trace level).',
      }),
      value: formatCount(current.traces),
      current: current.traces,
      previous: prev((k) => k.traces),
      kind: 'count',
      good: 'none',
    },
    {
      id: 'Sessions',
      title: i18n.translate('agentTraces.evalsPage.kpiSessions', {
        defaultMessage: 'Evaluated sessions',
      }),
      help: i18n.translate('agentTraces.evalsPage.kpiSessionsHelp', {
        defaultMessage: 'Distinct sessions (gen_ai.conversation.id) with at least one result.',
      }),
      value: formatCount(current.sessions),
      current: current.sessions,
      previous: prev((k) => k.sessions),
      kind: 'count',
      good: 'none',
    },
  ];
  return (
    <EuiFlexGroup gutterSize="s" wrap responsive={false}>
      {items.map((item) => (
        <EuiFlexItem key={item.id} style={{ minWidth: 150 }}>
          <KpiPanel
            title={item.title}
            value={item.value}
            help={item.help}
            testSubj={`agtEvlKpi${item.id}`}
          >
            <DeltaText
              current={item.current}
              previous={item.previous}
              kind={item.kind}
              good={item.good}
            />
          </KpiPanel>
        </EuiFlexItem>
      ))}
    </EuiFlexGroup>
  );
};

const directionOf = (results: EvalResult[]) =>
  results.some((r) => r.direction === 'minimize') ? 'minimize' : 'maximize';

/** Shades per outcome, so a failing label never reads as green. */
const LABEL_SHADES: Record<EvalOutcome, string[]> = {
  pass: [OUTCOME_CHART_COLOR.pass, '#9ADBC7', '#C6EDE1'],
  fail: [OUTCOME_CHART_COLOR.fail, '#FFA996', '#FFD2C7'],
  neutral: [OUTCOME_CHART_COLOR.neutral, '#B8C0CC', '#D3DAE6'],
};
const OTHER_SHADE = '#D3DAE6';

/** The outcome most results with this label had. */
export const labelOutcomes = (results: EvalResult[]): Map<string, EvalOutcome> => {
  const counts = new Map<string, Record<EvalOutcome, number>>();
  results.forEach((r) => {
    if (!r.label) return;
    const c = counts.get(r.label) ?? { pass: 0, fail: 0, neutral: 0 };
    c[r.outcome] += 1;
    counts.set(r.label, c);
  });
  const out = new Map<string, EvalOutcome>();
  counts.forEach((c, label) => {
    const [best] = (Object.keys(c) as EvalOutcome[]).sort((a, b) => c[b] - c[a]);
    out.set(label, best);
  });
  return out;
};

/** Label share as a stacked bar with a legend, colored by outcome; labels always as words. */
const LabelDistribution: React.FC<{ summary: EvaluatorSummary; results: EvalResult[] }> = ({
  summary,
  results,
}) => {
  const outcomes = useMemo(() => labelOutcomes(results), [results]);
  const top = summary.labels.slice(0, 4);
  const rest = summary.labels.slice(4).reduce((n, l) => n + l.count, 0);
  if (top.length === 0) return null;
  const used: Record<EvalOutcome, number> = { pass: 0, fail: 0, neutral: 0 };
  const parts = top.map((p) => {
    const outcome = outcomes.get(p.label) ?? 'neutral';
    const shades = LABEL_SHADES[outcome];
    const color = shades[Math.min(used[outcome]++, shades.length - 1)];
    return { ...p, color };
  });
  if (rest > 0) {
    parts.push({
      label: i18n.translate('agentTraces.evalsPage.otherLabels', { defaultMessage: 'Other' }),
      count: rest,
      color: OTHER_SHADE,
    });
  }
  const total = parts.reduce((n, p) => n + p.count, 0);
  return (
    <div data-test-subj="agtEvlLabelDistribution">
      <div className="agtEvlLabels__bar" aria-hidden>
        {parts.map((p) => (
          <span
            key={p.label}
            className="agtEvlLabels__seg"
            style={{ width: `${(p.count / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <EuiFlexGroup gutterSize="s" wrap responsive={false}>
        {parts.map((p) => (
          <EuiFlexItem grow={false} key={p.label}>
            <EuiText size="xs">
              <span className="agtEvlLabels__dot" style={{ background: p.color }} />
              {p.label} {Math.round((p.count / total) * 100)}%
            </EuiText>
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    </div>
  );
};

export const EvaluatorCard: React.FC<{
  summary: EvaluatorSummary;
  previous?: EvaluatorSummary;
  results: EvalResult[];
  bounds: TimeBoundsMs;
  interval: number;
  onSelect: (name: string) => void;
}> = ({ summary, previous, results, bounds, interval, onSelect }) => {
  const judged = summary.passCount + summary.failCount;
  const passRate = judged > 0 ? summary.passCount / judged : undefined;
  const prevJudged = previous ? previous.passCount + previous.failCount : 0;
  const prevPassRate = previous && prevJudged > 0 ? previous.passCount / prevJudged : undefined;
  const direction = directionOf(results);
  const directionText =
    direction === 'minimize'
      ? i18n.translate('agentTraces.evalsPage.lowerBetter', { defaultMessage: 'lower is better' })
      : i18n.translate('agentTraces.evalsPage.higherBetter', {
          defaultMessage: 'higher is better',
        });
  const showMean = summary.mean !== undefined;
  return (
    <EuiPanel
      paddingSize="m"
      hasBorder
      className="agtEvlCard agtEvlStatCard"
      onClick={() => onSelect(summary.name)}
      data-test-subj="agtEvlEvaluatorCard"
      aria-label={i18n.translate('agentTraces.evalsPage.cardAria', {
        defaultMessage: 'Where {name} fails',
        values: { name: summary.name },
      })}
    >
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={true} style={{ minWidth: 0 }}>
          <EuiTitle size="xs">
            <h3 className="eui-textTruncate" title={summary.name}>
              {summary.name}
            </h3>
          </EuiTitle>
        </EuiFlexItem>
        {summary.levels.map((l) => (
          <EuiFlexItem grow={false} key={l}>
            <LevelBadge level={l} />
          </EuiFlexItem>
        ))}
        {summary.sources.map((s) => (
          <EuiFlexItem grow={false} key={s}>
            <SourceBadge source={s} />
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiFlexGroup gutterSize="l" responsive={false} alignItems="flexEnd">
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.cardPassRate', { defaultMessage: 'Pass rate' })}
          </EuiText>
          <EuiTitle size="s">
            <p data-test-subj="agtEvlCardPassRate">{formatPercent(passRate)}</p>
          </EuiTitle>
        </EuiFlexItem>
        {showMean && (
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              <EuiToolTip content={directionText}>
                <span>
                  {i18n.translate('agentTraces.evalsPage.cardMean', { defaultMessage: 'Mean' })}{' '}
                  <EuiIcon type={direction === 'minimize' ? 'sortDown' : 'sortUp'} size="s" />
                </span>
              </EuiToolTip>
            </EuiText>
            <EuiTitle size="s">
              <p>{formatValue(summary.mean)}</p>
            </EuiTitle>
          </EuiFlexItem>
        )}
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.cardCount', { defaultMessage: 'Results' })}
          </EuiText>
          <EuiTitle size="s">
            <p>{formatCount(summary.count)}</p>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.failing', { defaultMessage: 'Failing' })}
          </EuiText>
          <EuiTitle size="s">
            <p
              style={summary.failCount > 0 ? { color: OUTCOME_CHART_COLOR.fail } : undefined}
              data-test-subj="agtEvlCardFailing"
            >
              {formatCount(summary.failCount)}
            </p>
          </EuiTitle>
        </EuiFlexItem>
      </EuiFlexGroup>
      <DeltaText current={passRate} previous={prevPassRate} kind="rate" good="up" />
      <LabelDistribution summary={summary} results={results} />
      <div className="agtEvlCard__spacer" />
      <OutcomeHistogram
        results={results}
        bounds={bounds}
        interval={interval}
        height={56}
        compact
        data-test-subj="agtEvlCardHistogram"
      />
    </EuiPanel>
  );
};

export const RecentFailures: React.FC<{
  results: EvalResult[];
  onOpenResult: (r: EvalResult) => void;
}> = ({ results, onOpenResult }) => {
  const failures = useMemo(
    () =>
      results
        .filter((r) => r.outcome === 'fail')
        .sort((a, b) => parseEvalTime(b.time) - parseEvalTime(a.time))
        .slice(0, RECENT_FAILURES_LIMIT),
    [results]
  );
  if (failures.length === 0) {
    return (
      <EuiText size="s" color="subdued" data-test-subj="agtEvlNoFailures">
        <FormattedMessage
          id="agentTraces.evalsPage.noFailures"
          defaultMessage="No failing results in this time range."
        />
      </EuiText>
    );
  }
  return (
    <ul className="agtEvlFailures" data-test-subj="agtEvlRecentFailures">
      {failures.map((r) => (
        <li key={r.id} className="agtEvlFailures__item">
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <OutcomeBadge result={r} />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiLink onClick={() => onOpenResult(r)} data-test-subj="agtEvlFailureLink">
                <strong>{r.name}</strong>
              </EuiLink>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <TargetText result={r} />
            </EuiFlexItem>
            <EuiFlexItem className="eui-textTruncate" style={{ minWidth: 0 }}>
              <EuiText size="xs" color="subdued" className="eui-textTruncate">
                {r.explanation ?? ''}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="xs" color="subdued">
                {formatEvalTime(r.time)}
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </li>
      ))}
    </ul>
  );
};

export const OverviewTab: React.FC<{
  results: EvalResult[];
  previous: EvalResult[];
  bounds: TimeBoundsMs;
  onSelectEvaluation: (name: string) => void;
  onOpenResult: (r: EvalResult) => void;
}> = ({ results, previous, bounds, onSelectEvaluation, onOpenResult }) => {
  const interval = useMemo(() => pickInterval(bounds), [bounds]);
  const kpis = useMemo(() => computeKpis(results), [results]);
  const previousKpis = useMemo(() => computeKpis(previous), [previous]);
  const summaries = useMemo(() => summarizeByEvaluator(results), [results]);
  const previousByName = useMemo(
    () => new Map(summarizeByEvaluator(previous).map((s) => [s.name, s])),
    [previous]
  );
  const byName = useMemo(() => {
    const map = new Map<string, EvalResult[]>();
    results.forEach((r) => map.set(r.name, [...(map.get(r.name) ?? []), r]));
    return map;
  }, [results]);

  if (results.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="search"
        data-test-subj="agtEvlOverviewEmpty"
        title={
          <h3>
            <FormattedMessage
              id="agentTraces.evalsPage.noResultsTitle"
              defaultMessage="No results match"
            />
          </h3>
        }
        body={
          <EuiText size="s">
            <FormattedMessage
              id="agentTraces.evalsPage.noResultsBody"
              defaultMessage="No evaluation results in this time range under these filters. Widen the time range or clear filters."
            />
          </EuiText>
        }
      />
    );
  }

  return (
    <div data-test-subj="agtEvlOverview">
      <KpiRow current={kpis} previous={previousKpis} />
      <EuiSpacer size="l" />
      <SectionHeader
        title={
          <FormattedMessage id="agentTraces.evalsPage.byEvaluation" defaultMessage="Evaluations" />
        }
        count={summaries.length}
        help={
          <FormattedMessage
            id="agentTraces.evalsPage.byEvaluationHelp"
            defaultMessage="Most failing first. Select one to see where it fails."
          />
        }
      />
      <EuiSpacer size="s" />
      <EuiFlexGrid columns={3} gutterSize="m">
        {summaries.map((s) => (
          <EuiFlexItem key={s.name}>
            <EvaluatorCard
              summary={s}
              previous={previousByName.get(s.name)}
              results={byName.get(s.name) ?? []}
              bounds={bounds}
              interval={interval}
              onSelect={onSelectEvaluation}
            />
          </EuiFlexItem>
        ))}
      </EuiFlexGrid>
      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="m">
        <EuiFlexItem grow={3}>
          <EuiPanel hasBorder paddingSize="m" className="agtEvlChartPanel">
            <SectionHeader
              title={
                <FormattedMessage
                  id="agentTraces.evalsPage.trendTitle"
                  defaultMessage="Score trend"
                />
              }
              help={
                <FormattedMessage
                  id="agentTraces.evalsPage.trendHelp"
                  defaultMessage="Mean score per evaluation, scaled to its range (100% is best)."
                />
              }
            />
            <EuiSpacer size="s" />
            <ScoreTrendChart results={results} bounds={bounds} interval={interval} />
          </EuiPanel>
        </EuiFlexItem>
        <EuiFlexItem grow={2}>
          <EuiPanel hasBorder paddingSize="m" className="agtEvlChartPanel">
            <SectionHeader
              title={
                <FormattedMessage
                  id="agentTraces.evalsPage.resultsOverTime"
                  defaultMessage="Results over time"
                />
              }
              help={
                <FormattedMessage
                  id="agentTraces.evalsPage.resultsOverTimeHelp"
                  defaultMessage="Pass, fail and scored results per interval."
                />
              }
            />
            <EuiSpacer size="s" />
            <OutcomeHistogram results={results} bounds={bounds} interval={interval} height={240} />
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="l" />
      <EuiPanel hasBorder paddingSize="m">
        <SectionHeader
          title={
            <FormattedMessage
              id="agentTraces.evalsPage.recentFailures"
              defaultMessage="Recent failures"
            />
          }
        />
        <EuiSpacer size="s" />
        <RecentFailures results={results} onOpenResult={onOpenResult} />
      </EuiPanel>
    </div>
  );
};
