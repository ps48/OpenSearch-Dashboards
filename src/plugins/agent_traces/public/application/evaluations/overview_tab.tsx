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
import { EVALS_RULES_SETTING } from '../../../common';
import {
  EvalOutcome,
  EvalResult,
  EvaluatorSummary,
  LabelCount,
  summaryPassRate,
} from './eval_data';
import {
  EvalKpis,
  OutcomeBucket,
  RunSummary,
  TimeBoundsMs,
  parseEvalTime,
} from './eval_aggregations';
import { Finding, TopChange, needsAttention, topChanges } from './eval_attention';
import { formatPointsDelta } from './eval_compare';
import { ChangeDelta } from './compare_runs';
import type { EvalAggregates } from './use_eval_data';
import { ShowTracesMenu, useShowTraces } from './eval_trace_filter';
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
  shortId,
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
        ? `${Math.abs(diff * 100).toFixed(1)} pp`
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
    sub?: string;
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
          'Passing results among passing and failing ones. Results without a pass rule (Scored) and evaluator errors are left out. Pass rules come from the evaluator (assessment or threshold), the agentTraces:evaluationRules setting, or built-in rules for Bedrock AgentCore evaluators.',
      }),
      value: formatPercent(current.passRate),
      sub:
        current.scored > 0
          ? i18n.translate('agentTraces.evalsPage.kpiScoredSub', {
              defaultMessage: '{count} scored without a rule',
              values: { count: formatCount(current.scored) },
            })
          : undefined,
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
        defaultMessage: 'Results that failed their pass rule.',
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
            {item.sub && (
              <EuiText size="xs" color="subdued" data-test-subj={`agtEvlKpi${item.id}Sub`}>
                {item.sub}
              </EuiText>
            )}
          </KpiPanel>
        </EuiFlexItem>
      ))}
    </EuiFlexGroup>
  );
};

/** Shades per verdict, so a failing label never reads as green. */
const LABEL_SHADES: Record<EvalOutcome, string[]> = {
  pass: [OUTCOME_CHART_COLOR.pass, '#9ADBC7', '#C6EDE1'],
  fail: [OUTCOME_CHART_COLOR.fail, '#FFA996', '#FFD2C7'],
  error: [OUTCOME_CHART_COLOR.error, '#F5DE9A', '#FAEDC4'],
  neutral: [OUTCOME_CHART_COLOR.neutral, '#B8C0CC', '#D3DAE6'],
};
const OTHER_SHADE = '#D3DAE6';

/** Label share as a stacked bar with a legend, colored by verdict; labels always as words. */
export const LabelDistribution: React.FC<{ labels: LabelCount[] }> = ({ labels }) => {
  const top = labels.slice(0, 4);
  const rest = labels.slice(4).reduce((n, l) => n + l.count, 0);
  if (top.length === 0) return null;
  const used: Record<EvalOutcome, number> = { pass: 0, fail: 0, error: 0, neutral: 0 };
  const parts = top.map((p) => {
    const shades = LABEL_SHADES[p.outcome];
    const color = shades[Math.min(used[p.outcome]++, shades.length - 1)];
    return { label: p.label, count: p.count, color };
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
            <EuiText size="xs" className="agtEvlNum">
              <span className="agtEvlLabels__dot" style={{ background: p.color }} />
              {p.label} {Math.round((p.count / total) * 100)}%
            </EuiText>
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    </div>
  );
};

/** An evaluation without a pass rule: how to give it one. */
export const NoPassRuleHint: React.FC = () => (
  <EuiToolTip
    content={
      <FormattedMessage
        id="agentTraces.evalsPage.noPassRuleHelp"
        defaultMessage="These results are scores without a pass rule, so they are left out of pass rates. Add one in the evaluator (send opensearch.evaluation.assessment, or opensearch.evaluation.score.threshold with .direction), or in Advanced settings ({setting}), e.g. a threshold or pass labels for this name."
        values={{ setting: EVALS_RULES_SETTING }}
      />
    }
  >
    <EuiText
      size="xs"
      color="subdued"
      className="agtEvlKpi__title"
      data-test-subj="agtEvlNoPassRule"
    >
      <FormattedMessage id="agentTraces.evalsPage.noPassRule" defaultMessage="No pass rule" />
    </EuiText>
  </EuiToolTip>
);

const CardStat: React.FC<{ title: React.ReactNode; testSubj?: string; color?: string }> = ({
  title,
  testSubj,
  color,
  children,
}) => (
  <EuiFlexItem grow={false}>
    <EuiText size="xs" color="subdued">
      {title}
    </EuiText>
    <EuiTitle size="s">
      <p className="agtEvlNum" style={color ? { color } : undefined} data-test-subj={testSubj}>
        {children}
      </p>
    </EuiTitle>
  </EuiFlexItem>
);

export const EvaluatorCard: React.FC<{
  summary: EvaluatorSummary;
  previous?: EvaluatorSummary;
  buckets: OutcomeBucket[];
  bounds: TimeBoundsMs;
  interval: number;
  onSelect: (name: string) => void;
}> = ({ summary, previous, buckets, bounds, interval, onSelect }) => {
  const passRate = summaryPassRate(summary);
  const prevPassRate = previous ? summaryPassRate(previous) : undefined;
  const hasRule = summary.passCount + summary.failCount > 0;
  const directionText =
    summary.direction === 'minimize'
      ? i18n.translate('agentTraces.evalsPage.lowerBetter', { defaultMessage: 'lower is better' })
      : i18n.translate('agentTraces.evalsPage.higherBetter', {
          defaultMessage: 'higher is better',
        });
  const meanTitle = (
    <EuiToolTip content={directionText}>
      <span>
        {i18n.translate('agentTraces.evalsPage.cardMean', { defaultMessage: 'Mean' })}{' '}
        <EuiIcon type={summary.direction === 'minimize' ? 'sortDown' : 'sortUp'} size="s" />
      </span>
    </EuiToolTip>
  );
  return (
    // A div, not a button: the card holds its own menu button.
    <div
      role="button"
      tabIndex={0}
      className="agtEvlCardClick"
      onClick={() => onSelect(summary.name)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(summary.name);
        }
      }}
      data-test-subj="agtEvlEvaluatorCard"
      aria-label={i18n.translate('agentTraces.evalsPage.cardAria', {
        defaultMessage: 'Where {name} fails',
        values: { name: summary.name },
      })}
    >
      <EuiPanel paddingSize="m" hasBorder className="agtEvlCard agtEvlStatCard">
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
          <EuiFlexItem grow={false}>
            <ShowTracesMenu
              name={summary.name}
              labels={summary.labels.slice(0, 5).map((l) => l.label)}
            />
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="l" responsive={false} alignItems="flexEnd">
          {hasRule ? (
            <CardStat
              title={i18n.translate('agentTraces.evalsPage.cardPassRate', {
                defaultMessage: 'Pass rate',
              })}
              testSubj="agtEvlCardPassRate"
            >
              {formatPercent(passRate)}
            </CardStat>
          ) : summary.mean !== undefined ? (
            <CardStat title={meanTitle} testSubj="agtEvlCardMean">
              {formatValue(summary.mean)}
            </CardStat>
          ) : (
            <CardStat
              title={i18n.translate('agentTraces.evalsPage.cardTopLabel', {
                defaultMessage: 'Top label',
              })}
              testSubj="agtEvlCardTopLabel"
            >
              {summary.labels[0]?.label ?? '-'}
            </CardStat>
          )}
          {hasRule && summary.mean !== undefined && (
            <CardStat title={meanTitle}>{formatValue(summary.mean)}</CardStat>
          )}
          <CardStat
            title={i18n.translate('agentTraces.evalsPage.cardCount', { defaultMessage: 'Results' })}
            testSubj="agtEvlCardCount"
          >
            {formatCount(summary.count)}
          </CardStat>
          {hasRule && (
            <CardStat
              title={i18n.translate('agentTraces.evalsPage.failing', { defaultMessage: 'Failing' })}
              testSubj="agtEvlCardFailing"
              color={summary.failCount > 0 ? OUTCOME_CHART_COLOR.fail : undefined}
            >
              {formatCount(summary.failCount)}
            </CardStat>
          )}
          {summary.errorCount > 0 && (
            <CardStat
              title={i18n.translate('agentTraces.evalsPage.cardErrors', {
                defaultMessage: 'Errors',
              })}
              testSubj="agtEvlCardErrors"
            >
              {formatCount(summary.errorCount)}
            </CardStat>
          )}
        </EuiFlexGroup>
        {hasRule ? (
          <DeltaText current={passRate} previous={prevPassRate} kind="rate" good="up" />
        ) : (
          <NoPassRuleHint />
        )}
        {hasRule && summary.neutralCount > 0 && (
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.cardScored', {
              defaultMessage: '{count} scored without a rule',
              values: { count: formatCount(summary.neutralCount) },
            })}
          </EuiText>
        )}
        <LabelDistribution labels={summary.labels} />
        <div className="agtEvlCard__spacer" />
        {/* A bar opens its own menu, not the drill-down. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
        <div onClick={(e) => e.stopPropagation()}>
          <OutcomeHistogram
            buckets={buckets}
            bounds={bounds}
            interval={interval}
            height={56}
            compact
            name={summary.name}
            data-test-subj="agtEvlCardHistogram"
          />
        </div>
      </EuiPanel>
    </div>
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
  const showTraces = useShowTraces();
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
            {showTraces && (
              <EuiFlexItem grow={false}>
                <ShowTracesMenu name={r.name} label={r.label} value={r.value} />
              </EuiFlexItem>
            )}
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

/** One finding as a sentence with its link. */
const FindingRow: React.FC<{
  finding: Finding;
  onSelectEvaluation: (name: string) => void;
  onOpenRun?: (runId: string) => void;
  onShowPrevious?: (name: string) => void;
}> = ({ finding: f, onSelectEvaluation, onOpenRun, onShowPrevious }) => {
  const whereFails = i18n.translate('agentTraces.evalsPage.findingWhere', {
    defaultMessage: 'Where it fails',
  });
  let icon = 'alert';
  let color = 'danger';
  let text: string;
  let link: { label: string; onClick: () => void } | undefined;
  switch (f.kind) {
    case 'drop':
      text = i18n.translate('agentTraces.evalsPage.findingDrop', {
        defaultMessage: '{name}: pass rate fell {points} points to {to} (from {from})',
        values: {
          name: f.name,
          points: Math.round((f.from - f.to) * 100),
          to: formatPercent(f.to),
          from: formatPercent(f.from),
        },
      });
      link = { label: whereFails, onClick: () => onSelectEvaluation(f.name) };
      break;
    case 'runRegression': {
      const what = [
        ...f.run.regressedEvaluators,
        ...(f.run.passRateDropped
          ? [
              i18n.translate('agentTraces.evalsPage.findingRunCases', {
                defaultMessage: '{passed} of {cases} test cases passed (was {before})',
                values: {
                  passed: f.run.casesPassed,
                  cases: f.run.cases,
                  before: f.previous ? `${f.previous.casesPassed} of ${f.previous.cases}` : '-',
                },
              }),
            ]
          : []),
      ].join(', ');
      text = i18n.translate('agentTraces.evalsPage.findingRun', {
        defaultMessage: 'Run {run}{suite} regressed against the previous run: {what}',
        values: {
          run: shortId(f.run.runId, 32),
          suite: f.run.suiteName ? ` (${f.run.suiteName})` : '',
          what,
        },
      });
      icon = 'beaker';
      link = onOpenRun
        ? {
            label: i18n.translate('agentTraces.evalsPage.findingOpenRun', {
              defaultMessage: 'Open run',
            }),
            onClick: () => onOpenRun(f.run.runId),
          }
        : undefined;
      break;
    }
    case 'lowest':
      text = i18n.translate('agentTraces.evalsPage.findingLowest', {
        defaultMessage: '{name}: lowest pass rate, {rate} ({fail} of {decided} failing)',
        values: {
          name: f.name,
          rate: formatPercent(f.passRate),
          fail: formatCount(f.failCount),
          decided: formatCount(f.decided),
        },
      });
      link = { label: whereFails, onClick: () => onSelectEvaluation(f.name) };
      break;
    case 'newLabel':
      icon = 'tag';
      text = i18n.translate('agentTraces.evalsPage.findingLabel', {
        defaultMessage:
          '{name}: new failing label "{label}" ({count, plural, one {# result} other {# results}}), not seen in the previous period',
        values: { name: f.name, label: f.label, count: f.count },
      });
      link = { label: whereFails, onClick: () => onSelectEvaluation(f.name) };
      break;
    case 'silent':
      icon = 'clock';
      color = 'warning';
      text = i18n.translate('agentTraces.evalsPage.findingSilent', {
        defaultMessage: '{name}: no results in this period ({count} in the previous period)',
        values: { name: f.name, count: formatCount(f.previousCount) },
      });
      link = onShowPrevious
        ? {
            label: i18n.translate('agentTraces.evalsPage.findingPrevious', {
              defaultMessage: 'Show the previous period',
            }),
            onClick: () => onShowPrevious(f.name),
          }
        : undefined;
      break;
  }
  return (
    <li className="agtEvlAttention__item" data-test-subj={`agtEvlFinding-${f.kind}`}>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiIcon type={icon} color={color} />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s" className="agtEvlNum">
            {text}
          </EuiText>
        </EuiFlexItem>
        {link && (
          <EuiFlexItem grow={false}>
            <EuiLink onClick={link.onClick} data-test-subj="agtEvlFindingLink">
              {link.label}
            </EuiLink>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
    </li>
  );
};

/** "Needs attention": deterministic findings for the range against the previous one. */
export const NeedsAttention: React.FC<{
  findings: Finding[];
  onSelectEvaluation: (name: string) => void;
  onOpenRun?: (runId: string) => void;
  onShowPrevious?: (name: string) => void;
}> = ({ findings, ...links }) => (
  <EuiPanel hasBorder paddingSize="m" data-test-subj="agtEvlNeedsAttention">
    <SectionHeader
      title={
        <FormattedMessage
          id="agentTraces.evalsPage.needsAttention"
          defaultMessage="Needs attention"
        />
      }
      help={
        <FormattedMessage
          id="agentTraces.evalsPage.needsAttentionHelp"
          defaultMessage="Computed from this range against the previous one of the same length, and the evaluation runs in this range."
        />
      }
    />
    <EuiSpacer size="s" />
    {findings.length === 0 ? (
      <EuiText size="s" color="subdued" data-test-subj="agtEvlNothingNeedsAttention">
        <FormattedMessage
          id="agentTraces.evalsPage.nothingNeedsAttention"
          defaultMessage="Nothing needs attention in this range."
        />
      </EuiText>
    ) : (
      <ul className="agtEvlAttention">
        {findings.map((f, i) => (
          <FindingRow key={`${f.kind}|${i}`} finding={f} {...links} />
        ))}
      </ul>
    )}
  </EuiPanel>
);

/** Per evaluation, pass rate (or mean) and its change against the previous period. */
export const TopChangesRow: React.FC<{
  changes: TopChange[];
  onSelectEvaluation: (name: string) => void;
}> = ({ changes, onSelectEvaluation }) => {
  if (changes.length === 0) return null;
  return (
    <div data-test-subj="agtEvlTopChanges">
      <SectionHeader
        title={
          <FormattedMessage id="agentTraces.evalsPage.topChanges" defaultMessage="Top changes" />
        }
        help={
          <FormattedMessage
            id="agentTraces.evalsPage.topChangesHelp"
            defaultMessage="Pass rate, or the mean without a pass rule, against the previous period. Worst change first."
          />
        }
      />
      <EuiSpacer size="s" />
      <EuiFlexGroup gutterSize="s" responsive={false} wrap>
        {changes.map((c) => {
          const delta =
            c.previous === undefined
              ? undefined
              : c.metric === 'passRate'
                ? formatPointsDelta(c.value - c.previous)
                : `${c.value - c.previous > 0 ? '↑' : c.value - c.previous < 0 ? '↓' : '±'}${Math.abs(
                    c.value - c.previous
                  ).toFixed(2)}`;
          return (
            <EuiFlexItem key={c.name} grow={false} style={{ minWidth: 150, maxWidth: 220 }}>
              <EuiPanel
                hasBorder
                paddingSize="s"
                className="agtEvlCard"
                onClick={() => onSelectEvaluation(c.name)}
                data-test-subj="agtEvlTopChange"
              >
                <EuiText size="xs" className="eui-textTruncate">
                  <span title={c.name}>{c.name}</span>
                </EuiText>
                <EuiFlexGroup gutterSize="xs" alignItems="baseline" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiText size="s" className="agtEvlNum">
                      <strong>
                        {c.metric === 'passRate' ? formatPercent(c.value) : formatValue(c.value)}
                      </strong>
                    </EuiText>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    {delta ? (
                      <ChangeDelta
                        text={delta}
                        change={c.change}
                        data-test-subj="agtEvlTopChangeDelta"
                      />
                    ) : (
                      <EuiText size="xs" color="subdued">
                        <FormattedMessage
                          id="agentTraces.evalsPage.topChangeNew"
                          defaultMessage="new"
                        />
                      </EuiText>
                    )}
                  </EuiFlexItem>
                </EuiFlexGroup>
                <EuiText size="xs" color="subdued">
                  {c.metric === 'passRate'
                    ? i18n.translate('agentTraces.evalsPage.topChangePassRate', {
                        defaultMessage: 'pass rate',
                      })
                    : i18n.translate('agentTraces.evalsPage.topChangeMean', {
                        defaultMessage: 'mean',
                      })}
                </EuiText>
              </EuiPanel>
            </EuiFlexItem>
          );
        })}
      </EuiFlexGroup>
    </div>
  );
};

export const OverviewTab: React.FC<{
  current: EvalAggregates;
  previous?: Pick<EvalAggregates, 'summaries' | 'kpis'>;
  failures: EvalResult[];
  bounds: TimeBoundsMs;
  interval: number;
  onSelectEvaluation: (name: string) => void;
  onOpenResult: (r: EvalResult) => void;
  /** Evaluation runs in the range, for "Needs attention". */
  runs?: RunSummary[];
  onOpenRun?: (runId: string) => void;
  /** Opens the previous period (an evaluation that stopped reporting). */
  onShowPrevious?: (name: string) => void;
}> = ({
  current,
  previous,
  failures,
  bounds,
  interval,
  onSelectEvaluation,
  onOpenResult,
  runs,
  onOpenRun,
  onShowPrevious,
}) => {
  const findings = useMemo(
    () => needsAttention(current.summaries, previous?.summaries, runs),
    [current, previous, runs]
  );
  const changes = useMemo(
    () => topChanges(current.summaries, previous?.summaries),
    [current, previous]
  );
  const previousByName = useMemo(
    () => new Map((previous?.summaries ?? []).map((s) => [s.name, s])),
    [previous]
  );

  if (current.kpis.results === 0) {
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
      <NeedsAttention
        findings={findings}
        onSelectEvaluation={onSelectEvaluation}
        onOpenRun={onOpenRun}
        onShowPrevious={onShowPrevious}
      />
      <EuiSpacer size="m" />
      <TopChangesRow changes={changes} onSelectEvaluation={onSelectEvaluation} />
      {changes.length > 0 && <EuiSpacer size="m" />}
      <KpiRow current={current.kpis} previous={previous?.kpis} />
      <EuiSpacer size="l" />
      <SectionHeader
        title={
          <FormattedMessage id="agentTraces.evalsPage.byEvaluation" defaultMessage="Evaluations" />
        }
        count={current.summaries.length}
        help={
          <FormattedMessage
            id="agentTraces.evalsPage.byEvaluationHelp"
            defaultMessage="Most failing first. Select one to see where it fails."
          />
        }
      />
      <EuiSpacer size="s" />
      <EuiFlexGrid columns={3} gutterSize="m">
        {current.summaries.map((s) => (
          <EuiFlexItem key={s.name}>
            <EvaluatorCard
              summary={s}
              previous={previousByName.get(s.name)}
              buckets={current.bucketsByName.get(s.name) ?? []}
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
                  defaultMessage="Mean score per evaluation, scaled to its range (100% is best). Evaluations without a known score range are not drawn."
                />
              }
            />
            <EuiSpacer size="s" />
            <ScoreTrendChart trend={current.trend} bounds={bounds} interval={interval} />
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
                  defaultMessage="Pass, fail, error and scored results per interval."
                />
              }
            />
            <EuiSpacer size="s" />
            <OutcomeHistogram
              buckets={current.buckets}
              bounds={bounds}
              interval={interval}
              height={240}
            />
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
        <RecentFailures results={failures} onOpenResult={onOpenResult} />
      </EuiPanel>
    </div>
  );
};
