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
  EuiIcon,
  EuiLink,
  EuiLoadingSpinner,
  EuiPanel,
  EuiPopover,
  EuiPopoverTitle,
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
import {
  LevelPill,
  OUTCOME_BADGE_COLOR,
  OUTCOME_HEALTH_COLOR,
  OUTCOME_ICON,
  OUTCOME_TEXT,
  VerdictBadge,
  VerdictSummaryChip,
  countVerdicts,
  summaryAria,
} from '../../../evaluations/eval_chips';
import { ShowTracesMenu } from '../../../evaluations/eval_trace_filter';
import { DatasetRef, useEvalsDataset } from '../../../evaluations/eval_dataset';
import { parseEvalTime } from '../../../evaluations/eval_aggregations';
import { buildExploreLogsUrl } from '../../../../../../explore/public';
import { TraceEvaluations } from './use_trace_evaluations';
import './trace_evaluations.scss';

const HEALTH_COLOR = OUTCOME_HEALTH_COLOR;
const BADGE_COLOR = OUTCOME_BADGE_COLOR;

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

/** One result as a compact badge: `name: label (value)`, colored by verdict. */
export const EvalBadge: React.FC<{ result: EvalResult; onClick?: () => void }> = ({
  result,
  onClick,
}) => (
  <EuiToolTip content={resultTooltip(result)}>
    <EuiBadge
      color={BADGE_COLOR[result.outcome]}
      iconType={OUTCOME_ICON[result.outcome]}
      onClick={onClick}
      onClickAriaLabel={onClick ? `${result.name} ${OUTCOME_TEXT[result.outcome]}` : undefined}
      data-test-subj="agentTracesEvalBadge"
      data-outcome={result.outcome}
    >
      {result.name}: {formatScore(result)}
    </EuiBadge>
  </EuiToolTip>
);

/** First line of an explanation, for one-line previews. */
export const firstLine = (text?: string, max = 140): string => {
  const line = (text ?? '').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return truncate(line.trim(), max);
};

/** Every result of a row, failures first: verdict chip, name, level, first explanation line. */
export const EvalResultsList: React.FC<{
  results: EvalResult[];
  onOpen?: (r: EvalResult) => void;
}> = ({ results, onOpen }) => (
  <ul className="agtEvlPopList" data-test-subj="agentTracesEvalList">
    {failuresFirst(results).map((r) => (
      <li key={r.id} className="agtEvlPopList__item" data-test-subj="agentTracesEvalListItem">
        <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap={false}>
          <EuiFlexItem grow={false}>
            <VerdictBadge result={r} />
          </EuiFlexItem>
          <EuiFlexItem className="agtEvlPopList__name">
            {onOpen ? (
              <EuiLink
                onClick={() => onOpen(r)}
                className="eui-textTruncate"
                data-test-subj="agentTracesEvalListOpen"
              >
                {r.name}
              </EuiLink>
            ) : (
              <EuiText size="xs" className="eui-textTruncate">
                {r.name}
              </EuiText>
            )}
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <LevelPill level={r.level} />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <ShowTracesMenu name={r.name} label={r.label} value={r.value} />
          </EuiFlexItem>
        </EuiFlexGroup>
        {r.explanation && (
          <EuiText size="xs" color="subdued" className="agtEvlPopList__explanation">
            {firstLine(r.explanation)}
          </EuiText>
        )}
      </li>
    ))}
  </ul>
);

/**
 * The Evaluations column: one chip per row, `✗ 2 · ✓ 4 · 3 scored`, red only when something
 * failed. Clicking it lists every result; a result opens the trace on its Evaluations tab.
 */
export const EvalSummaryCell: React.FC<{
  results: EvalResult[];
  onOpen?: () => void;
}> = ({ results, onOpen }) => {
  const [open, setOpen] = useState(false);
  if (results.length === 0) return null;
  const counts = countVerdicts(results);
  return (
    <span
      className="agtEvlSummaryCell"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <EuiPopover
        isOpen={open}
        closePopover={() => setOpen(false)}
        anchorPosition="downLeft"
        panelPaddingSize="s"
        button={
          <VerdictSummaryChip
            counts={counts}
            onClick={() => setOpen(!open)}
            data-test-subj="agentTracesEvalSummary"
          />
        }
      >
        <EuiPopoverTitle paddingSize="s">
          {i18n.translate('agentTraces.evals.popoverTitle', {
            defaultMessage: 'Evaluations ({count})',
            values: { count: results.length },
          })}
        </EuiPopoverTitle>
        <div className="agtEvlPopover" data-test-subj="agentTracesEvalPopover">
          <EvalResultsList
            results={results}
            onOpen={
              onOpen
                ? () => {
                    setOpen(false);
                    onOpen();
                  }
                : undefined
            }
          />
        </div>
      </EuiPopover>
    </span>
  );
};

/** Trace flyout header: `2 FAILED · 6 PASSED · 3 SCORED`; opens the Evaluations tab. */
export const EvalHeaderSummary: React.FC<{ results: EvalResult[]; onClick: () => void }> = ({
  results,
  onClick,
}) => {
  const counts = countVerdicts(results);
  const parts = [
    counts.fail &&
      i18n.translate('agentTraces.flyout.evalsFailed', {
        defaultMessage: '{count} FAILED',
        values: { count: counts.fail },
      }),
    counts.pass &&
      i18n.translate('agentTraces.flyout.evalsPassed', {
        defaultMessage: '{count} PASSED',
        values: { count: counts.pass },
      }),
    counts.error &&
      i18n.translate('agentTraces.flyout.evalsErrored', {
        defaultMessage: '{count} ERRORED',
        values: { count: counts.error },
      }),
    counts.neutral &&
      i18n.translate('agentTraces.flyout.evalsScored', {
        defaultMessage: '{count} SCORED',
        values: { count: counts.neutral },
      }),
  ].filter((p): p is string => !!p);
  return (
    <EuiLink
      onClick={onClick}
      color={counts.fail ? 'danger' : 'text'}
      className="agtEvlHeaderSummary"
      aria-label={summaryAria(counts)}
      data-test-subj="agentTracesFlyoutEvalSummary"
    >
      {parts.join(' · ')}
    </EuiLink>
  );
};

/** A span's evaluations in the trace tree: a count, with a red dot when one failed. */
export const SpanEvalMark: React.FC<{ results?: EvalResult[] }> = ({ results }) => {
  if (!results || results.length === 0) return null;
  const counts = countVerdicts(results);
  return (
    <EuiToolTip
      content={results.map((r) => (
        <div key={r.id}>
          {r.name}: {OUTCOME_TEXT[r.outcome]} {formatScore(r)}
        </div>
      ))}
    >
      <span
        className="agtEvlSpanMark"
        aria-label={summaryAria(counts)}
        data-test-subj="agentTracesSpanEvalMark"
        data-failed={counts.fail > 0 ? 'true' : 'false'}
      >
        {counts.fail > 0 && <span className="agtEvlSpanMark__dot" />}
        <EuiIcon type="visGauge" size="s" />
        {results.length}
      </span>
    </EuiToolTip>
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
        <LevelPill level={r.level} />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <ShowTracesMenu name={r.name} label={r.label} value={r.value} />
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

const HOUR_MS = 60 * 60 * 1000;

/**
 * Explore Logs on the evaluations dataset with a PPL query for this trace id (as Related logs'
 * View in Discover Logs builds it), over the time the trace's results span (an hour around
 * them), or the last 90 days without results.
 */
export const evaluationsLogsUrl = (
  dataset: DatasetRef,
  traceId: string,
  results: Array<Pick<EvalResult, 'time'>>
): string => {
  const times = results.map((r) => parseEvalTime(r.time)).filter((t) => Number.isFinite(t));
  const timeRange = times.length
    ? {
        from: new Date(Math.min(...times) - HOUR_MS).toISOString(),
        to: new Date(Math.max(...times) + HOUR_MS).toISOString(),
      }
    : { from: 'now-90d', to: 'now' };
  return buildExploreLogsUrl({
    traceId,
    logDataset: {
      id: dataset.id,
      title: dataset.title,
      type: 'INDEX_PATTERN',
      timeFieldName: dataset.timeFieldName || 'time',
    },
    timeRange,
  });
};

/** View in Logs: the trace's evaluation events in Explore Logs, when an evaluations dataset is set. */
export const ViewEvaluationsInLogs: React.FC<{
  traceId: string;
  results: Array<Pick<EvalResult, 'time'>>;
  className?: string;
}> = ({ traceId, results, className }) => {
  const { config } = useEvalsDataset();
  if (!config) return null;
  return (
    <EuiFlexGroup
      justifyContent="flexEnd"
      gutterSize="none"
      responsive={false}
      className={className}
    >
      <EuiFlexItem grow={false}>
        <EuiLink
          href={evaluationsLogsUrl(config.evaluationsDataset, traceId, results)}
          data-test-subj="agtEvlViewInLogs"
        >
          <EuiIcon type="discoverApp" size="s" />{' '}
          {i18n.translate('agentTraces.evals.viewInLogs', { defaultMessage: 'View in Logs' })}
        </EuiLink>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

/** Trace flyout tab: the session's, the trace's and each span's evaluation results. */
export const TraceEvaluationsTab: React.FC<{
  evals: TraceEvaluations;
  /** The trace the tab shows, for View in Logs. */
  traceId?: string;
  spanLabelOf: (spanId: string) => string | undefined;
  onSelectSpan: (spanId: string) => void;
}> = ({ evals, traceId, spanLabelOf, onSelectSpan }) => {
  const viewInLogs = (className?: string) =>
    traceId ? (
      <ViewEvaluationsInLogs traceId={traceId} results={evals.results} className={className} />
    ) : null;
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
      <>
        {viewInLogs('agtEvl__tabBody')}
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
      </>
    );
  }
  const spanIds = Object.keys(evals.bySpanId);
  return (
    <div className="agtEvl__tabBody" data-test-subj="agentTracesEvaluationsTab">
      {viewInLogs()}
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
