/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './eval_components.scss';

import React from 'react';
import moment from 'moment';
import {
  EuiBadge,
  EuiCallOut,
  EuiFilterButton,
  EuiFilterGroup,
  EuiIconTip,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CaseStatus, Tally, Verdict } from './eval_model';
import { EvalSource, NO_AGENT } from './eval_ppl';

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: i18n.translate('agentTraces.evals.verdict.pass', { defaultMessage: 'Pass' }),
  fail: i18n.translate('agentTraces.evals.verdict.fail', { defaultMessage: 'Fail' }),
  error: i18n.translate('agentTraces.evals.verdict.error', { defaultMessage: 'Evaluator error' }),
  scored: i18n.translate('agentTraces.evals.verdict.scored', { defaultMessage: 'Scored' }),
};

const VERDICT_COLOR: Record<Verdict, string> = {
  pass: 'success',
  fail: 'danger',
  error: 'warning',
  scored: 'hollow',
};

export const NO_AGENT_LABEL = i18n.translate('agentTraces.evals.noAgentName', {
  defaultMessage: '(no agent name)',
});

export const agentLabel = (agent?: string) =>
  !agent || agent === NO_AGENT ? NO_AGENT_LABEL : agent;

export const DASH = '—';

export const pct = (x?: number) => (x === undefined ? DASH : `${Math.round(x * 100)}%`);

export const formatTime = (ms: number, format = 'MMM D, HH:mm') =>
  Number.isFinite(ms) ? moment(ms).format(format) : DASH;

export const formatDay = (ms: number) => formatTime(ms, 'MMM D');

export const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60e3) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3600e3) return `${Math.floor(ms / 60e3)} min ${Math.round((ms % 60e3) / 1000)} s`;
  return `${Math.floor(ms / 3600e3)} h ${Math.round((ms % 3600e3) / 60e3)} min`;
};

/** The short form of an id: a run id's last part (`run_<date>_<hex>`), 8 characters. */
export const shortId = (id?: string, size = 8) =>
  id ? (id.split('_').pop() ?? id).slice(0, size) : '';

export const formatScore = (value?: number) =>
  value === undefined ? DASH : Number.isInteger(value) ? String(value) : value.toFixed(2);

export const VerdictBadge: React.FC<{ verdict: Verdict | CaseStatus }> = ({ verdict }) => (
  <EuiBadge color={VERDICT_COLOR[verdict]} data-test-subj={`agtEvlVerdict-${verdict}`}>
    {VERDICT_LABEL[verdict]}
  </EuiBadge>
);

export const VersionBadge: React.FC<{ version?: string }> = ({ version }) =>
  version ? (
    <EuiBadge color="default">{version}</EuiBadge>
  ) : (
    <span className="agtEvlDim">{DASH}</span>
  );

/** A pass rate with a small bar. */
export const PassRateCell: React.FC<{ rate?: number }> = ({ rate }) =>
  rate === undefined ? (
    <span className="agtEvlDim">{DASH}</span>
  ) : (
    <span className="agtEvlRate">
      <strong>{pct(rate)}</strong>
      <span className="agtEvlRate__bar">
        <span className="agtEvlRate__fill" style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
    </span>
  );

/** A change in points (b - a); 3 points or more is colored. */
export const DeltaCell: React.FC<{ delta?: number }> = ({ delta }) => {
  if (delta === undefined) return <span className="agtEvlDim">{DASH}</span>;
  const d = Math.round(delta * 100);
  const tone = d <= -3 ? 'bad' : d >= 3 ? 'good' : 'flat';
  const sign = d > 0 ? '+' : d < 0 ? '-' : '±';
  return (
    <span className={`agtEvlDelta agtEvlDelta--${tone}`} data-test-subj="agtEvlDelta">
      {i18n.translate('agentTraces.evals.deltaPoints', {
        defaultMessage: '{sign}{points} pts',
        values: { sign, points: Math.abs(d) },
      })}
    </span>
  );
};

/** Counts per verdict as colored dots: fail, pass, evaluator error, scored. */
export const TallyCell: React.FC<{ tally: Tally }> = ({ tally }) => {
  const parts: Array<[Verdict, number]> = (['fail', 'pass', 'error', 'scored'] as Verdict[])
    .map((v): [Verdict, number] => [v, tally[v]])
    .filter(([, n]) => n > 0);
  if (!parts.length) return <span className="agtEvlDim">{DASH}</span>;
  return (
    <span className="agtEvlTally" data-test-subj="agtEvlTally">
      {parts.map(([v, n]) => (
        <EuiToolTip key={v} content={`${VERDICT_LABEL[v]}: ${n}`}>
          <span className="agtEvlTally__item">
            <span className={`agtEvlTally__dot agtEvlTally__dot--${v}`} />
            {n}
          </span>
        </EuiToolTip>
      ))}
    </span>
  );
};

const SOURCE_LABEL: Record<EvalSource, string> = {
  all: i18n.translate('agentTraces.evals.source.all', { defaultMessage: 'All' }),
  online: i18n.translate('agentTraces.evals.source.online', { defaultMessage: 'Online' }),
  offline: i18n.translate('agentTraces.evals.source.offline', { defaultMessage: 'Offline' }),
};

const SOURCE_TIP: Partial<Record<EvalSource, string>> = {
  online: i18n.translate('agentTraces.evals.source.onlineTip', {
    defaultMessage: 'Results on live traffic (no test.suite.run.id)',
  }),
  offline: i18n.translate('agentTraces.evals.source.offlineTip', {
    defaultMessage: 'Results from suite runs (test.suite.run.id set)',
  }),
};

export const SourceFilter: React.FC<{
  value: EvalSource;
  onChange: (source: EvalSource) => void;
}> = ({ value, onChange }) => (
  <EuiFilterGroup data-test-subj="agtEvlSource">
    {(['all', 'online', 'offline'] as EvalSource[]).map((s) => (
      <EuiFilterButton
        key={s}
        hasActiveFilters={value === s}
        onClick={() => onChange(s)}
        title={SOURCE_TIP[s]}
        data-test-subj={`agtEvlSource-${s}`}
      >
        {SOURCE_LABEL[s]}
      </EuiFilterButton>
    ))}
  </EuiFilterGroup>
);

export const QueryErrorCallout: React.FC<{ message: string }> = ({ message }) => (
  <EuiCallOut
    color="danger"
    iconType="alert"
    size="s"
    title={i18n.translate('agentTraces.evals.queryError', {
      defaultMessage: 'The query failed',
    })}
    data-test-subj="agtEvlQueryError"
  >
    <EuiText size="xs">
      <p>{message}</p>
    </EuiText>
  </EuiCallOut>
);

export const PassRateTip: React.FC = () => (
  <EuiIconTip
    type="questionInCircle"
    size="s"
    content={i18n.translate('agentTraces.evals.passRateTip', {
      defaultMessage:
        'Passed / (passed + failed) results. Scored-only results and evaluator errors are not counted.',
    })}
  />
);

/** A labelled value in a page's meta line. */
export const MetaItem: React.FC<{ label: string }> = ({ label, children }) => (
  <span className="agtEvlMeta__item">
    <span className="agtEvlDim">{label}</span> {children}
  </span>
);

export const RUN_A = i18n.translate('agentTraces.evals.runA', { defaultMessage: 'Run A' });
export const RUN_B = i18n.translate('agentTraces.evals.runB', { defaultMessage: 'Run B' });
