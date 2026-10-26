/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  EuiBadge,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHealth,
  EuiLink,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import moment from 'moment-timezone';
import {
  EvalResult,
  LEVEL_LABEL,
  SOURCE_LABEL,
  failuresFirst,
  formatScore,
} from '../../../evaluations/eval_data';
import { TraceEvaluations } from './use_trace_evaluations';
import './trace_evaluations.scss';

const OUTCOME_TEXT = {
  pass: i18n.translate('agentTraces.evals.outcomePass', { defaultMessage: 'Pass' }),
  fail: i18n.translate('agentTraces.evals.outcomeFail', { defaultMessage: 'Fail' }),
  neutral: i18n.translate('agentTraces.evals.outcomeNeutral', { defaultMessage: 'Scored' }),
};
const HEALTH_COLOR = { pass: 'success', fail: 'danger', neutral: 'subdued' } as const;
const BADGE_COLOR = { pass: 'secondary', fail: 'danger', neutral: 'hollow' } as const;

/** PPL timestamps are UTC without a zone ("2026-10-26 09:38:26.94"); show them in local time. */
const formatTime = (time: string) => {
  const parsed = moment.utc(time.replace(' ', 'T'));
  return parsed.isValid() ? parsed.local().format('MMM D, YYYY HH:mm:ss') : time;
};

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const resultTooltip = (r: EvalResult) => (
  <div>
    <strong>
      {r.name}: {OUTCOME_TEXT[r.outcome]} {formatScore(r)}
    </strong>
    <div>
      {LEVEL_LABEL[r.level] ?? r.level} · {r.evaluator} · {SOURCE_LABEL[r.source] ?? r.source}
    </div>
    {r.explanation && <div>{truncate(r.explanation, 300)}</div>}
  </div>
);

/** One result as a compact badge: `name: label (value)`, colored by outcome, with the word too. */
export const EvalBadge: React.FC<{ result: EvalResult; onClick?: () => void }> = ({
  result,
  onClick,
}) => (
  <EuiToolTip content={resultTooltip(result)}>
    <EuiBadge
      color={BADGE_COLOR[result.outcome]}
      iconType={
        result.outcome === 'fail' ? 'alert' : result.outcome === 'pass' ? 'check' : undefined
      }
      onClick={onClick}
      onClickAriaLabel={onClick ? `${result.name} ${OUTCOME_TEXT[result.outcome]}` : undefined}
      data-test-subj="agentTracesEvalBadge"
    >
      {result.name}: {formatScore(result)}
    </EuiBadge>
  </EuiToolTip>
);

/** Badges for several results, failures first, collapsing to `+N`. */
export const EvalBadgeGroup: React.FC<{
  results: EvalResult[];
  max?: number;
  onClick?: () => void;
}> = ({ results, max = 3, onClick }) => {
  if (results.length === 0) return null;
  const ordered = failuresFirst(results);
  const shown = ordered.slice(0, max);
  const rest = ordered.slice(max);
  return (
    <EuiFlexGroup gutterSize="xs" wrap responsive={false} className="agtEvl__badgeGroup">
      {shown.map((r) => (
        <EuiFlexItem grow={false} key={r.id}>
          <EvalBadge result={r} onClick={onClick} />
        </EuiFlexItem>
      ))}
      {rest.length > 0 && (
        <EuiFlexItem grow={false}>
          <EuiToolTip
            content={rest.map((r) => (
              <div key={r.id}>
                {r.name}: {OUTCOME_TEXT[r.outcome]} {formatScore(r)}
              </div>
            ))}
          >
            <EuiBadge color="hollow" onClick={onClick} onClickAriaLabel="More evaluations">
              +{rest.length}
            </EuiBadge>
          </EuiToolTip>
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );
};

const ExplanationText: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280;
  return (
    <EuiText size="xs" className="agtEvl__explanation">
      <p>
        {expanded || !long ? text : truncate(text, 280)}{' '}
        {long && (
          <EuiLink onClick={() => setExpanded(!expanded)} data-test-subj="agentTracesEvalMore">
            {expanded
              ? i18n.translate('agentTraces.evals.showLess', { defaultMessage: 'Show less' })
              : i18n.translate('agentTraces.evals.showMore', { defaultMessage: 'Show more' })}
          </EuiLink>
        )}
      </p>
    </EuiText>
  );
};

/** One result with its explanation, evaluator and target. */
export const EvalResultItem: React.FC<{
  result: EvalResult;
  targetLabel?: string;
  onTargetClick?: () => void;
}> = ({ result: r, targetLabel, onTargetClick }) => (
  <EuiPanel paddingSize="s" hasBorder className="agtEvl__item" data-test-subj="agentTracesEvalItem">
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
      <EuiFlexItem grow={false}>
        <EuiHealth color={HEALTH_COLOR[r.outcome]}>{OUTCOME_TEXT[r.outcome]}</EuiHealth>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiText size="s">
          <strong>{r.name}</strong>
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiText size="s">{formatScore(r)}</EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiBadge color="hollow">{LEVEL_LABEL[r.level] ?? r.level}</EuiBadge>
      </EuiFlexItem>
      {targetLabel && (
        <EuiFlexItem grow={false}>
          {onTargetClick ? (
            <EuiLink onClick={onTargetClick} data-test-subj="agentTracesEvalTarget">
              <EuiText size="xs">{targetLabel}</EuiText>
            </EuiLink>
          ) : (
            <EuiText size="xs" color="subdued">
              {targetLabel}
            </EuiText>
          )}
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
    {r.explanation && <ExplanationText text={r.explanation} />}
    <EuiText size="xs" color="subdued">
      {r.evaluator}
      {r.evaluatorVersion ? ` ${r.evaluatorVersion}` : ''} · {SOURCE_LABEL[r.source] ?? r.source}
      {r.onlineConfig ? ` · ${r.onlineConfig}` : ''}
      {r.errorType ? ` · error: ${r.errorType}` : ''} · {formatTime(r.time)}
    </EuiText>
  </EuiPanel>
);

const Section: React.FC<{ title: string; count: number }> = ({ title, count, children }) => (
  <>
    <EuiTitle size="xxs">
      <h4>
        {title} <EuiBadge color="hollow">{count}</EuiBadge>
      </h4>
    </EuiTitle>
    <EuiSpacer size="xs" />
    {children}
    <EuiSpacer size="m" />
  </>
);

/** Trace flyout tab: the session's, the trace's and each span's evaluation results. */
export const TraceEvaluationsTab: React.FC<{
  evals: TraceEvaluations;
  spanLabelOf: (spanId: string) => string | undefined;
  onSelectSpan: (spanId: string) => void;
}> = ({ evals, spanLabelOf, onSelectSpan }) => {
  if (evals.isLoading) {
    return (
      <EuiFlexGroup justifyContent="center" className="agtEvl__tabBody">
        <EuiLoadingSpinner size="l" />
      </EuiFlexGroup>
    );
  }
  if (evals.error) {
    return (
      <div className="agtEvl__tabBody">
        <EuiCallOut
          color="danger"
          size="s"
          iconType="alert"
          title={i18n.translate('agentTraces.evals.loadError', {
            defaultMessage: 'Could not load evaluations',
          })}
        >
          <p>{evals.error}</p>
        </EuiCallOut>
      </div>
    );
  }
  if (evals.results.length === 0) {
    return (
      <EuiEmptyPrompt
        iconType="checkInCircleFilled"
        titleSize="xs"
        title={
          <h4>
            {i18n.translate('agentTraces.evals.emptyTitle', {
              defaultMessage: 'No evaluations for this trace',
            })}
          </h4>
        }
        body={
          <EuiText size="s">
            {i18n.translate('agentTraces.evals.emptyBody', {
              defaultMessage:
                'Evaluation results are OpenTelemetry gen_ai.evaluation.result events linked to a span, trace or session. Send them with the OpenSearch GenAI SDK score() or any OTel evaluator.',
            })}
          </EuiText>
        }
      />
    );
  }
  const spanIds = Object.keys(evals.bySpanId);
  return (
    <div className="agtEvl__tabBody" data-test-subj="agentTracesEvaluationsTab">
      {evals.sessionResults.length > 0 && (
        <Section
          title={i18n.translate('agentTraces.evals.sessionSection', { defaultMessage: 'Session' })}
          count={evals.sessionResults.length}
        >
          {evals.sessionResults.map((r) => (
            <EvalResultItem key={r.id} result={r} />
          ))}
        </Section>
      )}
      {evals.traceResults.length > 0 && (
        <Section
          title={i18n.translate('agentTraces.evals.traceSection', { defaultMessage: 'Trace' })}
          count={evals.traceResults.length}
        >
          {evals.traceResults.map((r) => (
            <EvalResultItem key={r.id} result={r} />
          ))}
        </Section>
      )}
      {spanIds.length > 0 && (
        <Section
          title={i18n.translate('agentTraces.evals.spanSection', { defaultMessage: 'Spans' })}
          count={spanIds.reduce((n, id) => n + evals.bySpanId[id].length, 0)}
        >
          {spanIds.map((spanId) =>
            evals.bySpanId[spanId].map((r) => (
              <EvalResultItem
                key={r.id}
                result={r}
                targetLabel={spanLabelOf(spanId) ?? spanId}
                onTargetClick={spanLabelOf(spanId) ? () => onSelectSpan(spanId) : undefined}
              />
            ))
          )}
        </Section>
      )}
    </div>
  );
};
