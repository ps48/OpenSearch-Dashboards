/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import moment from 'moment';
import {
  EuiBadge,
  EuiCallOut,
  EuiCode,
  EuiEmptyPrompt,
  EuiLink,
  EuiText,
  EuiTitle,
  EuiToolTip,
  euiPaletteColorBlind,
  euiPaletteColorBlindBehindText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { EvalOutcome, EvalResult } from './eval_data';
import { LevelPill, SourcePill, VerdictBadge } from './eval_chips';
import { CaseStatus, EvaluatorAggregate, parseEvalTime } from './eval_aggregations';
import { sessionToOpen, useOpenSession } from './eval_links';

export { OUTCOME_BADGE_COLOR, OUTCOME_TEXT, levelLabel, sourceLabel } from './eval_chips';

/**
 * Pass, fail and errored colors: the shades the OUI badges use (`secondary`, `danger`,
 * `warning`), so a bar, a dot and a badge for the same outcome look the same.
 */
const BADGE_SHADES = euiPaletteColorBlindBehindText();
const NEUTRAL_COLOR = '#98A2B3';

export const OUTCOME_CHART_COLOR: Record<EvalOutcome, string> = {
  pass: BADGE_SHADES[0],
  fail: BADGE_SHADES[9],
  error: BADGE_SHADES[5],
  neutral: NEUTRAL_COLOR,
};

export const CASE_STATUS_COLOR: Record<CaseStatus, string> = {
  pass: BADGE_SHADES[0],
  fail: BADGE_SHADES[9],
  error: BADGE_SHADES[5],
  unknown: NEUTRAL_COLOR,
};

/**
 * Series colors for evaluation names: blues, purples and neutrals of the OUI vis palette.
 * Never green, red, pink, orange or amber, which read as verdicts.
 */
const VIS = euiPaletteColorBlind();
export const SERIES_COLORS = [VIS[1], VIS[3], VIS[6], '#3F6E9A', '#6B4D94', '#8D9BAD', '#5C7FA3'];
export const seriesColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

/** Short display of an id: first 8 characters. */
export const shortId = (id: string | undefined, length = 8) =>
  id ? (id.length > length + 1 ? id.slice(0, length) : id) : '';

export const formatEvalTime = (time: string | number, format = 'MMM D, HH:mm:ss') => {
  const ms = typeof time === 'number' ? time : parseEvalTime(time);
  return Number.isFinite(ms) ? moment(ms).format(format) : String(time);
};

/** `850 ms`, `2.40 s`, `3m 05s`; `-` when unknown. */
export const formatDuration = (ms?: number): string => {
  if (ms === undefined || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
};

export const formatPercent = (rate: number | undefined, digits = 0) =>
  rate === undefined || !Number.isFinite(rate) ? '-' : `${(rate * 100).toFixed(digits)}%`;

/** A score value: integers as is, else two decimals; `-` when unknown. */
export const formatValue = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value)
    ? '-'
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(2);

/** Counts with separators; large token counts as `12.3k` / `1.2M`. */
export const formatCount = (n: number | undefined): string =>
  n === undefined || !Number.isFinite(n) ? '-' : Math.round(n).toLocaleString();

export const formatTokens = (n: number | undefined): string => {
  if (n === undefined || !Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
};

/** An aggregate as shown in tables: mean score when numeric, else the pass rate. */
export const formatAggregate = (agg?: EvaluatorAggregate): string => {
  if (!agg) return '-';
  if (agg.mean !== undefined) return formatValue(agg.mean);
  if (agg.passRate !== undefined) return formatPercent(agg.passRate);
  return agg.topLabel ?? '-';
};

/** Section header: title, an optional count, a one-line help and right-aligned actions. */
export const SectionHeader: React.FC<{
  title: React.ReactNode;
  count?: number;
  help?: React.ReactNode;
  actions?: React.ReactNode;
  testSubj?: string;
}> = ({ title, count, help, actions, testSubj }) => (
  <div className="agtEvlSection" data-test-subj={testSubj}>
    <div className="agtEvlSection__row">
      <EuiTitle size="xs">
        <h2>
          {title}
          {count !== undefined && (
            <>
              {' '}
              <EuiBadge color="hollow">{count.toLocaleString()}</EuiBadge>
            </>
          )}
        </h2>
      </EuiTitle>
      {actions && <div>{actions}</div>}
    </div>
    {help && (
      <EuiText size="xs" color="subdued">
        {help}
      </EuiText>
    )}
  </div>
);

/** A result's chip, colored by verdict. */
export const OutcomeBadge = VerdictBadge;
export const LevelBadge = LevelPill;
export const SourceBadge = SourcePill;

/** What a result judged, as a short label: `Session abcd1234`, `Trace ...`, `Span ...`. */
export const targetLabelOf = (r: EvalResult): string => {
  if (r.level === 'session' && r.sessionId) {
    return i18n.translate('agentTraces.evalsPage.targetSession', {
      defaultMessage: 'Session {id}',
      values: { id: shortId(r.sessionId, 12) },
    });
  }
  if ((r.level === 'span' || r.level === 'tool_call') && r.spanId) {
    return i18n.translate('agentTraces.evalsPage.targetSpan', {
      defaultMessage: 'Span {id}',
      values: { id: shortId(r.spanId) },
    });
  }
  if (r.traceId) {
    return i18n.translate('agentTraces.evalsPage.targetTrace', {
      defaultMessage: 'Trace {id}',
      values: { id: shortId(r.traceId) },
    });
  }
  return '-';
};

export const TargetText: React.FC<{ result: EvalResult }> = ({ result }) => {
  const label = targetLabelOf(result);
  const openSession = useOpenSession();
  const sessionId = sessionToOpen(result);
  if (openSession && sessionId) {
    return (
      <EuiToolTip
        content={i18n.translate('agentTraces.evalsPage.openSessionTip', {
          defaultMessage: 'Open session {id} in Agent Traces',
          values: { id: sessionId },
        })}
      >
        <EuiLink
          onClick={(e: React.MouseEvent) => {
            // In a table row that opens the result: open the session only.
            e.stopPropagation();
            openSession(sessionId, parseEvalTime(result.time));
          }}
          data-test-subj="agtEvlTargetSession"
        >
          <EuiText size="xs">
            <span className="agtEvlMono">{label}</span>
          </EuiText>
        </EuiLink>
      </EuiToolTip>
    );
  }
  const full = [
    result.sessionId && `session ${result.sessionId}`,
    result.traceId && `trace ${result.traceId}`,
    result.spanId && `span ${result.spanId}`,
  ]
    .filter(Boolean)
    .join(', ');
  return full ? (
    <EuiToolTip content={full}>
      <EuiText size="xs">
        <span className="agtEvlMono">{label}</span>
      </EuiText>
    </EuiToolTip>
  ) : (
    <EuiText size="xs">{label}</EuiText>
  );
};

/** No evaluation index in the cluster yet: how results get here. */
export const NoEvalIndexPrompt: React.FC<{ index?: string }> = ({
  index = AGENT_EVALS_INDEX_PATTERN,
}) => (
  <EuiEmptyPrompt
    iconType="visGauge"
    data-test-subj="agtEvlNoIndex"
    title={
      <h2>
        <FormattedMessage
          id="agentTraces.evalsPage.noIndexTitle"
          defaultMessage="No evaluation results yet"
        />
      </h2>
    }
    body={
      <EuiText size="s" textAlign="left">
        <p>
          <FormattedMessage
            id="agentTraces.evalsPage.noIndexBody"
            defaultMessage="Agent Evaluations reads OpenTelemetry {event} events from {index}. Emit them with:"
            values={{
              event: <EuiCode>gen_ai.evaluation.result</EuiCode>,
              index: <EuiCode>{index}</EuiCode>,
            }}
          />
        </p>
        <ul>
          <li>
            <FormattedMessage
              id="agentTraces.evalsPage.noIndexSdk"
              defaultMessage="the OpenSearch GenAI SDK {fn} (Python or TypeScript), inline or after the fact;"
              values={{ fn: <EuiCode>score()</EuiCode> }}
            />
          </li>
          <li>
            <FormattedMessage
              id="agentTraces.evalsPage.noIndexAgentCore"
              defaultMessage="Bedrock AgentCore online evaluations, imported from their results log group;"
            />
          </li>
          <li>
            <FormattedMessage
              id="agentTraces.evalsPage.noIndexOtel"
              defaultMessage="any OpenTelemetry evaluator that emits the event with the evaluated span as context."
            />
          </li>
        </ul>
        <p>
          <FormattedMessage
            id="agentTraces.evalsPage.noIndexPipeline"
            defaultMessage="Send them over OTLP logs like your traces. Data Prepper routes evaluation events to {index}."
            values={{ index: <EuiCode>otel-v1-genai-evaluation</EuiCode> }}
          />
        </p>
        <p>
          <FormattedMessage
            id="agentTraces.evalsPage.noIndexSetting"
            defaultMessage="Results in another index? Select its dataset in {settings}."
            values={{
              settings: (
                <strong>
                  {i18n.translate('agentTraces.evalsPage.noIndexSettingsName', {
                    defaultMessage: 'Settings',
                  })}
                </strong>
              ),
            }}
          />
        </p>
      </EuiText>
    }
  />
);

export const QueryErrorCallout: React.FC<{ message: string; title?: string }> = ({
  message,
  title,
}) => (
  <EuiCallOut
    color="danger"
    iconType="alert"
    size="s"
    data-test-subj="agtEvlQueryError"
    title={
      title ??
      i18n.translate('agentTraces.evalsPage.queryError', {
        defaultMessage: 'Could not load evaluation results',
      })
    }
  >
    <p className="agtEvlMono">{message}</p>
  </EuiCallOut>
);

/** Aggregates use the latest results only: say so. */
export const TruncationNotice: React.FC<{ shown: number; total?: number }> = ({ shown, total }) => (
  <EuiCallOut
    size="s"
    color="warning"
    iconType="iInCircle"
    data-test-subj="agtEvlTruncated"
    title={i18n.translate('agentTraces.evalsPage.truncated', {
      defaultMessage:
        'Showing the latest {shown} of {total} results. Narrow the time range or filters for exact numbers.',
      values: {
        shown: shown.toLocaleString(),
        total: total !== undefined ? total.toLocaleString() : `${shown.toLocaleString()}+`,
      },
    })}
  />
);

/** An aggregation hit the engine's row limit: some groups may be missing. */
export const AggregateLimitNotice: React.FC = () => (
  <EuiCallOut
    size="s"
    color="warning"
    iconType="iInCircle"
    data-test-subj="agtEvlAggLimit"
    title={i18n.translate('agentTraces.evalsPage.aggLimit', {
      defaultMessage:
        'More than 10,000 combinations of evaluation, label and interval: some are left out. Narrow the time range or filters.',
    })}
  />
);
