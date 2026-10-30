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
  EuiIcon,
  EuiLink,
  EuiLoadingSpinner,
  EuiPopover,
  EuiPopoverTitle,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import moment from 'moment-timezone';
import type { ApplicationStart } from '../../../../../../../core/public';
import { useOpenSearchDashboards } from '../../../../../../opensearch_dashboards_react/public';
import { AGENT_EVALS_NAV_ID } from '../../../../../common';
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
  OUTCOME_ICON,
  OUTCOME_TEXT,
  VerdictBadge,
  countVerdicts,
  summaryAria,
} from '../../../evaluations/eval_chips';
import { JudgeIcon, JudgePill, judgeState } from '../../../evaluations/eval_judge_icon';
import { ShowTracesMenu } from '../../../evaluations/eval_trace_filter';
import { DatasetRef, useEvalsDataset } from '../../../evaluations/eval_dataset';
import { parseEvalTime } from '../../../evaluations/eval_aggregations';
import { buildExploreLogsUrl } from '../../../../../../explore/public';
import { TraceEvaluations } from './use_trace_evaluations';
import './trace_evaluations.scss';

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
 * The Evaluations column: one judge pill per row, `⚖ 2 failing of 4` (red) or `⚖ 4 passing`
 * (green). Clicking it lists every result; a result opens the trace on its Evaluations tab.
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
          <JudgePill
            counts={counts}
            onClick={() => setOpen(!open)}
            aria-label={summaryAria(counts)}
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

export type HeaderVerdictFilter = 'fail';

/**
 * Trace flyout header: `2 FAILED` `1 PASSED` `1 ERRORED` `1 SCORED` chips. FAILED toggles the
 * span filter (only spans with a failing evaluation stay bright); the others open the tab.
 */
export const EvalHeaderSummary: React.FC<{
  results: EvalResult[];
  onClick: () => void;
  activeFilter?: HeaderVerdictFilter;
  onToggleFailFilter?: () => void;
}> = ({ results, onClick, activeFilter, onToggleFailFilter }) => {
  const counts = countVerdicts(results);
  const chips: Array<{ key: string; count: number; text: string; onChip: () => void }> = [
    {
      key: 'fail',
      count: counts.fail,
      text: i18n.translate('agentTraces.flyout.evalsFailed', {
        defaultMessage: '{count} FAILED',
        values: { count: counts.fail },
      }),
      onChip: onToggleFailFilter ?? onClick,
    },
    {
      key: 'pass',
      count: counts.pass,
      text: i18n.translate('agentTraces.flyout.evalsPassed', {
        defaultMessage: '{count} PASSED',
        values: { count: counts.pass },
      }),
      onChip: onClick,
    },
    {
      key: 'error',
      count: counts.error,
      text: i18n.translate('agentTraces.flyout.evalsErrored', {
        defaultMessage: '{count} ERRORED',
        values: { count: counts.error },
      }),
      onChip: onClick,
    },
    {
      key: 'neutral',
      count: counts.neutral,
      text: i18n.translate('agentTraces.flyout.evalsScored', {
        defaultMessage: '{count} SCORED',
        values: { count: counts.neutral },
      }),
      onChip: onClick,
    },
  ];
  return (
    <span
      className="agtEvlHeaderSummary"
      aria-label={summaryAria(counts)}
      data-test-subj="agentTracesFlyoutEvalSummary"
    >
      {chips
        .filter((c) => c.count > 0)
        .map((c) => {
          const active = c.key === 'fail' && activeFilter === 'fail';
          return (
            <button
              key={c.key}
              type="button"
              className={`agtEvlTally agtEvlTally--${c.key}${active ? ' agtEvlTally--active' : ''}`}
              onClick={c.onChip}
              aria-pressed={c.key === 'fail' && onToggleFailFilter ? active : undefined}
              title={
                c.key === 'fail' && onToggleFailFilter
                  ? active
                    ? i18n.translate('agentTraces.flyout.evalsFailedClear', {
                        defaultMessage: 'Show all spans',
                      })
                    : i18n.translate('agentTraces.flyout.evalsFailedFilter', {
                        defaultMessage: 'Highlight spans with a failing evaluation',
                      })
                  : undefined
              }
              data-test-subj={`agentTracesFlyoutEvalTally-${c.key}`}
            >
              {c.text}
            </button>
          );
        })}
    </span>
  );
};

/** Spans whose results include a failure. */
export const failingSpanIds = (bySpanId: Record<string, EvalResult[]>): Set<string> =>
  new Set(Object.keys(bySpanId).filter((id) => bySpanId[id].some((r) => r.outcome === 'fail')));

/** Trace Map marks for a span's evaluations: the judge pill, and a red banner when one failed. */
export const flowEvalDecoration = (
  results: EvalResult[] | undefined
): { className?: string; badge?: React.ReactNode } | undefined => {
  if (!results || results.length === 0) return undefined;
  const counts = countVerdicts(results);
  const failing = results.filter((r) => r.outcome === 'fail');
  if (failing.length === 0) {
    return {
      className: 'agtEvlFlowNode',
      badge: <JudgePill counts={counts} data-test-subj="agentTracesFlowEvalMark" />,
    };
  }
  const names = Array.from(new Set(failing.map((r) => r.name)));
  return {
    className: 'agtEvlFlowNode agtEvlFlowNode--fail',
    badge: (
      <div className="agtEvlFlowBanner" data-test-subj="agentTracesFlowEvalBanner">
        <JudgeIcon />
        <span className="eui-textTruncate">
          {i18n.translate('agentTraces.flowView.failingEvals', {
            defaultMessage:
              '{count, plural, one {# failing evaluation} other {# failing evaluations}} · {names}',
            values: { count: failing.length, names: names.join(', ') },
          })}
        </span>
      </div>
    ),
  };
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
        className={`agtEvlSpanMark agtEvlSpanMark--${judgeState(counts)}`}
        aria-label={summaryAria(counts)}
        data-test-subj="agentTracesSpanEvalMark"
        data-failed={counts.fail > 0 ? 'true' : 'false'}
      >
        <JudgeIcon />
        {counts.fail > 0 ? `${counts.fail}/${results.length}` : results.length}
      </span>
    </EuiToolTip>
  );
};

/** Literal `\n` sequences some judges emit become real line breaks. */
export const proseOf = (text: string): string => text.replace(/(?:\\r)?\\n/g, '\n').trim();

const ExplanationText: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const prose = proseOf(text);
  const long = prose.length > 280;
  return (
    <EuiText size="s" className="agtEvl__explanation" data-test-subj="agentTracesEvalExplanation">
      <p>
        {expanded || !long ? prose : truncate(prose, 280)}{' '}
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

/** The score on its scale when the scale is known: `1 / 5`, else the label or value. */
export const scoreOnScale = (r: EvalResult): string => {
  if (r.value === undefined) return r.label ?? '';
  const v = Number.isInteger(r.value) ? String(r.value) : r.value.toFixed(2);
  if (r.scoreMax !== undefined && r.scoreMax !== 1) return `${v} / ${r.scoreMax}`;
  return r.label ? `${r.label} (${v})` : v;
};

/** `1 / 5 · Fail`, tinted by verdict. */
export const VerdictScoreChip: React.FC<{ result: EvalResult }> = ({ result: r }) => {
  const score = scoreOnScale(r);
  return (
    <span
      className={`agtEvlVerdictChip agtEvlVerdictChip--${r.outcome}`}
      data-test-subj="agentTracesEvalVerdict"
      data-outcome={r.outcome}
    >
      {score ? `${score} · ` : ''}
      {OUTCOME_TEXT[r.outcome]}
    </span>
  );
};

const HOUR = 60 * 60 * 1000;

/** The result opened in the Evaluations app's Results tab (its flyout), around its time. */
export const resultInEvaluationsPath = (r: Pick<EvalResult, 'id' | 'time'>): string => {
  const t = parseEvalTime(r.time);
  const time = Number.isFinite(t)
    ? `(from:'${new Date(t - HOUR).toISOString()}',to:'${new Date(t + HOUR).toISOString()}')`
    : `(from:now-7d,to:now)`;
  const id = r.id.replace(/!/g, '!!').replace(/'/g, "!'");
  return `#/?_g=(time:${time})&_a=(result:'${encodeURIComponent(id)}',tab:results)`;
};

const OpenInResults: React.FC<{ result: EvalResult }> = ({ result }) => {
  const { services } = useOpenSearchDashboards<{ application?: ApplicationStart }>();
  const application = services?.application;
  if (!application) return null;
  return (
    <EuiLink
      onClick={() =>
        application.navigateToApp(AGENT_EVALS_NAV_ID, { path: resultInEvaluationsPath(result) })
      }
      data-test-subj="agentTracesEvalOpenInResults"
    >
      {i18n.translate('agentTraces.evals.openInResults', {
        defaultMessage: 'Open in Evaluations → Results',
      })}
    </EuiLink>
  );
};

/** One result as a row: name, `1 / 5 · Fail`, the judged span, the explanation as prose. */
export const EvalResultItem: React.FC<{
  result: EvalResult;
  targetLabel?: string;
  onTargetClick?: () => void;
}> = ({ result: r, targetLabel, onTargetClick }) => (
  <div className="agtEvl__item" data-test-subj="agentTracesEvalItem" data-outcome={r.outcome}>
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
      <EuiFlexItem grow={false}>
        <EuiText size="s">
          <strong>{r.name}</strong>
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <VerdictScoreChip result={r} />
      </EuiFlexItem>
      {targetLabel && (
        <EuiFlexItem grow={false} className="agtEvl__target">
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
      <EuiFlexItem />
      <EuiFlexItem grow={false}>
        <ShowTracesMenu name={r.name} label={r.label} value={r.value} />
      </EuiFlexItem>
    </EuiFlexGroup>
    {r.explanation && <ExplanationText text={r.explanation} />}
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
      <EuiFlexItem>
        <EuiText size="xs" color="subdued">
          {LEVEL_LABEL[r.level] ?? r.level} · {r.evaluator}
          {r.evaluatorVersion ? ` ${r.evaluatorVersion}` : ''} ·{' '}
          {SOURCE_LABEL[r.source] ?? r.source}
          {r.onlineConfig ? ` · ${r.onlineConfig}` : ''}
          {r.errorType ? ` · error: ${r.errorType}` : ''} · {formatTime(r.time)}
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiText size="xs">
          <OpenInResults result={r} />
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
  </div>
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
