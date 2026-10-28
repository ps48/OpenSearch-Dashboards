/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './eval_chips.scss';

import React from 'react';
import { EuiBadge, EuiToolTip } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { EvalOutcome, EvalResult, LEVEL_LABEL, SOURCE_LABEL, formatScore } from './eval_data';

/**
 * Chips of the evaluation views. Color means one thing, the verdict: pass green, fail red,
 * evaluator error amber, no pass rule gray. Level and source pills are outlined in hues
 * that carry no verdict meaning.
 */

export const OUTCOME_TEXT: Record<EvalOutcome, string> = {
  pass: i18n.translate('agentTraces.evals.outcomePass', { defaultMessage: 'Pass' }),
  fail: i18n.translate('agentTraces.evals.outcomeFail', { defaultMessage: 'Fail' }),
  error: i18n.translate('agentTraces.evals.outcomeError', { defaultMessage: 'Evaluator error' }),
  neutral: i18n.translate('agentTraces.evals.outcomeNeutral', { defaultMessage: 'Scored' }),
};

/** OUI badge colors per verdict. */
export const OUTCOME_BADGE_COLOR: Record<EvalOutcome, string> = {
  pass: 'secondary',
  fail: 'danger',
  error: 'warning',
  neutral: 'hollow',
};

export const OUTCOME_ICON: Record<EvalOutcome, string | undefined> = {
  pass: 'check',
  fail: 'cross',
  error: 'alert',
  neutral: undefined,
};

/** EuiHealth colors per verdict. */
export const OUTCOME_HEALTH_COLOR: Record<EvalOutcome, string> = {
  pass: 'success',
  fail: 'danger',
  error: 'warning',
  neutral: 'subdued',
};

/** Text of a chip: the label and value; the verdict word when there is neither. */
export const chipText = (result: Pick<EvalResult, 'outcome' | 'value' | 'label'>): string => {
  const score = formatScore(result);
  return score === '-' ? OUTCOME_TEXT[result.outcome] : score;
};

/** One result: colored by verdict, text is its label and value, the icon repeats the verdict. */
export const VerdictBadge: React.FC<{
  result: Pick<EvalResult, 'outcome' | 'value' | 'label'>;
  /** Prefix, e.g. the evaluation name in the trace views. */
  prefix?: string;
  onClick?: () => void;
  'data-test-subj'?: string;
}> = ({ result, prefix, onClick, ...rest }) => {
  const text = chipText(result);
  const verdict = OUTCOME_TEXT[result.outcome];
  const content = prefix ? `${prefix}: ${text}` : text;
  const badgeProps = onClick
    ? { onClick, onClickAriaLabel: `${content}, ${verdict}` }
    : { 'aria-label': `${content}, ${verdict}` };
  return (
    <EuiBadge
      color={OUTCOME_BADGE_COLOR[result.outcome]}
      iconType={OUTCOME_ICON[result.outcome]}
      title={`${verdict}: ${content}`}
      className="agtEvlVerdict"
      data-test-subj={rest['data-test-subj'] ?? 'agtEvlOutcomeBadge'}
      data-outcome={result.outcome}
      {...badgeProps}
    >
      {content}
    </EuiBadge>
  );
};

export const levelLabel = (level: string) => LEVEL_LABEL[level] ?? level;
export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? source;

const KNOWN_LEVELS = new Set(['session', 'trace', 'span', 'tool_call']);

/** What a result judged: an outlined pill, its hue says the level, never a verdict. */
export const LevelPill: React.FC<{ level: string }> = ({ level }) => (
  <span
    className={`agtEvlPill agtEvlPill--level agtEvlPill--${
      KNOWN_LEVELS.has(level) ? level : 'other'
    }`}
    data-test-subj="agtEvlLevelBadge"
  >
    {levelLabel(level)}
  </span>
);

/** The producer of a result: an outlined gray pill. */
export const SourcePill: React.FC<{ source: string }> = ({ source }) => (
  <span className="agtEvlPill agtEvlPill--source" data-test-subj="agtEvlSourceBadge">
    {sourceLabel(source)}
  </span>
);

export interface VerdictCounts {
  pass: number;
  fail: number;
  error: number;
  neutral: number;
}

export const countVerdicts = (results: Array<Pick<EvalResult, 'outcome'>>): VerdictCounts => {
  const counts: VerdictCounts = { pass: 0, fail: 0, error: 0, neutral: 0 };
  results.forEach((r) => {
    counts[r.outcome] += 1;
  });
  return counts;
};

/** `✗ 2 · ✓ 4 · 1 error · 3 scored`, the parts that are not zero. */
export const summaryParts = (counts: VerdictCounts): string[] => {
  const parts: string[] = [];
  if (counts.fail) parts.push(`✗ ${counts.fail}`);
  if (counts.pass) parts.push(`✓ ${counts.pass}`);
  if (counts.error) {
    parts.push(
      i18n.translate('agentTraces.evals.summaryErrors', {
        defaultMessage: '{count} {count, plural, one {error} other {errors}}',
        values: { count: counts.error },
      })
    );
  }
  if (counts.neutral) {
    parts.push(
      i18n.translate('agentTraces.evals.summaryScored', {
        defaultMessage: '{count} scored',
        values: { count: counts.neutral },
      })
    );
  }
  return parts;
};

export const summaryAria = (counts: VerdictCounts) =>
  i18n.translate('agentTraces.evals.summaryAria', {
    defaultMessage:
      '{fail} failed, {pass} passed, {error} evaluator errors, {neutral} scored without a pass rule',
    values: {
      fail: counts.fail,
      pass: counts.pass,
      error: counts.error,
      neutral: counts.neutral,
    },
  });

/** Color of a summary: red when anything failed, amber for evaluator errors, else gray. */
export const summaryColor = (counts: VerdictCounts) =>
  counts.fail > 0 ? 'danger' : counts.error > 0 ? 'warning' : 'hollow';

/** One compact chip for a set of results. */
export const VerdictSummaryChip: React.FC<{
  counts: VerdictCounts;
  onClick?: () => void;
  tooltip?: React.ReactNode;
  'data-test-subj'?: string;
}> = ({ counts, onClick, tooltip, ...rest }) => {
  const text = summaryParts(counts).join(' · ');
  const aria = summaryAria(counts);
  const badge = (
    <EuiBadge
      color={summaryColor(counts)}
      className="agtEvlSummaryChip"
      data-test-subj={rest['data-test-subj'] ?? 'agtEvlSummaryChip'}
      {...(onClick ? { onClick, onClickAriaLabel: aria } : { 'aria-label': aria, title: aria })}
    >
      {text}
    </EuiBadge>
  );
  return tooltip ? <EuiToolTip content={tooltip}>{badge}</EuiToolTip> : badge;
};
