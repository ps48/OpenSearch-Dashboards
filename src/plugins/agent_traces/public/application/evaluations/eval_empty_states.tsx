/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCode,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';

/** The Agent evaluations docs (producing results, pass rules) and the AI observability docs. */
export const AGENT_EVALS_DOCS_URL = 'https://observability.opensearch.org/docs/agent-evals/';
export const AI_OBSERVABILITY_DOCS_URL =
  'https://observability.opensearch.org/docs/ai-observability/';

/**
 * A small picture of what the page shows: a trace's steps, each with a pass or fail grade, and
 * the pass rate over time. Theme colors, so it reads in light and dark mode.
 */
const EvalsIllustration: React.FC = () => {
  const pass = euiThemeVars.euiColorSuccess;
  const fail = euiThemeVars.euiColorDanger;
  const ink = euiThemeVars.euiColorMediumShade;
  const panel = euiThemeVars.euiColorLightestShade;
  const rows = [
    { y: 26, w: 92, ok: true },
    { y: 50, w: 70, ok: true },
    { y: 74, w: 108, ok: false },
    { y: 98, w: 60, ok: true },
  ];
  const bars = [0.9, 0.85, 0.6, 0.7, 0.95, 0.9];
  return (
    <svg
      width="320"
      height="132"
      viewBox="0 0 320 132"
      role="img"
      aria-hidden="true"
      className="agtEvlEmptyIllustration"
      data-test-subj="agtEvlEmptyIllustration"
    >
      <rect x="1" y="1" width="170" height="126" rx="6" fill={panel} stroke={ink} />
      {rows.map((r, i) => (
        <g key={r.y}>
          <rect
            x={16 + i * 6}
            y={r.y - 6}
            width={r.w}
            height="10"
            rx="2"
            fill={ink}
            opacity="0.5"
          />
          <circle cx="150" cy={r.y - 1} r="7" fill={r.ok ? pass : fail} />
          <path
            d={
              r.ok
                ? `M146.5 ${r.y - 1} l2.5 2.5 l4.5 -5`
                : `M147 ${r.y - 4} l6 6 M153 ${r.y - 4} l-6 6`
            }
            stroke="#fff"
            strokeWidth="1.6"
            fill="none"
          />
        </g>
      ))}
      <rect x="186" y="1" width="133" height="126" rx="6" fill={panel} stroke={ink} />
      {bars.map((v, i) => {
        const h = Math.round(v * 84);
        return (
          <g key={i}>
            <rect x={200 + i * 19} y={112 - h} width="13" height={h} fill={pass} rx="1" />
            <rect
              x={200 + i * 19}
              y={112 - 84}
              width="13"
              height={84 - h}
              fill={fail}
              opacity="0.8"
              rx="1"
            />
          </g>
        );
      })}
    </svg>
  );
};

/**
 * No evaluations dataset configured: what evaluations are, Get started (the settings), and
 * how to produce results.
 */
export const NoEvalsDatasetPrompt: React.FC<{
  onGetStarted: () => void;
  /** The config lookup failed. */
  error?: string;
}> = ({ onGetStarted, error }) => (
  <EuiFlexGroup
    direction="column"
    alignItems="center"
    gutterSize="none"
    className="agtEvlEmpty"
    data-test-subj="agtEvlNoDataset"
  >
    <EuiFlexItem grow={false}>
      <EuiSpacer size="l" />
      <EvalsIllustration />
      <EuiSpacer size="l" />
    </EuiFlexItem>
    <EuiFlexItem grow={false}>
      <EuiText textAlign="center">
        <h2>
          <FormattedMessage
            id="agentTraces.evalsEmpty.title"
            defaultMessage="Measure how well your agents do their job"
          />
        </h2>
      </EuiText>
    </EuiFlexItem>
    <EuiFlexItem grow={false} className="agtEvlEmpty__body">
      <EuiSpacer size="s" />
      <EuiText size="s" color="subdued" textAlign="center">
        <p>
          <FormattedMessage
            id="agentTraces.evalsEmpty.body"
            defaultMessage="Evaluations score your agents' spans, traces and sessions: online evaluators grade production traffic as it happens, offline runs score a test suite before you ship. Results are OpenTelemetry log events ({event}) next to your traces. Select the dataset that holds them to see pass rates, regressions, and the traces where an evaluation fails."
            values={{ event: <EuiCode>gen_ai.evaluation.result</EuiCode> }}
          />
        </p>
      </EuiText>
      <EuiSpacer size="m" />
    </EuiFlexItem>
    {error && (
      <EuiFlexItem grow={false} className="agtEvlEmpty__body">
        <EuiCallOut
          size="s"
          color="danger"
          iconType="alert"
          title={i18n.translate('agentTraces.evalsEmpty.lookupError', {
            defaultMessage: 'Could not read the evaluations dataset settings',
          })}
          data-test-subj="agtEvlNoDatasetError"
        >
          <p className="agtEvlMono">{error}</p>
        </EuiCallOut>
        <EuiSpacer size="m" />
      </EuiFlexItem>
    )}
    <EuiFlexItem grow={false}>
      <EuiButton fill iconType="gear" onClick={onGetStarted} data-test-subj="agtEvlGetStarted">
        {i18n.translate('agentTraces.evalsEmpty.getStarted', { defaultMessage: 'Get started' })}
      </EuiButton>
      <EuiSpacer size="m" />
    </EuiFlexItem>
    <EuiFlexItem grow={false}>
      <EuiFlexGroup gutterSize="l" justifyContent="center" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiLink
            href={AGENT_EVALS_DOCS_URL}
            target="_blank"
            external
            data-test-subj="agtEvlEvalsDocsLink"
          >
            {i18n.translate('agentTraces.evalsEmpty.evalsDocsLink', {
              defaultMessage: 'Agent evaluations docs',
            })}
          </EuiLink>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiLink
            href={AI_OBSERVABILITY_DOCS_URL}
            target="_blank"
            external
            data-test-subj="agtEvlAiObservabilityDocsLink"
          >
            {i18n.translate('agentTraces.evalsEmpty.aiObservabilityDocsLink', {
              defaultMessage: 'AI observability docs',
            })}
          </EuiLink>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="xl" />
    </EuiFlexItem>
  </EuiFlexGroup>
);

export interface QuickRangeButton {
  /** Relative start, to `now`. */
  from: string;
  label: string;
}

export const LAST_24H: QuickRangeButton = {
  from: 'now-24h',
  label: i18n.translate('agentTraces.evalsEmpty.last24h', { defaultMessage: 'Last 24 hours' }),
};
export const LAST_7D: QuickRangeButton = {
  from: 'now-7d',
  label: i18n.translate('agentTraces.evalsEmpty.last7d', { defaultMessage: 'Last 7 days' }),
};
export const LAST_30D: QuickRangeButton = {
  from: 'now-30d',
  label: i18n.translate('agentTraces.evalsEmpty.last30d', { defaultMessage: 'Last 30 days' }),
};

/**
 * The dataset is set up but the range holds nothing: one click to a wider range, and to
 * clearing the filters when some are set.
 */
export const NoResultsInRange: React.FC<{
  title?: React.ReactNode;
  body?: React.ReactNode;
  ranges: QuickRangeButton[];
  onSelectRange?: (from: string) => void;
  onClearFilters?: () => void;
  iconType?: string;
  'data-test-subj'?: string;
}> = ({ title, body, ranges, onSelectRange, onClearFilters, iconType = 'search', ...rest }) => (
  <EuiEmptyPrompt
    iconType={iconType}
    data-test-subj={rest['data-test-subj'] ?? 'agtEvlNoResultsInRange'}
    title={
      <h3>
        {title ?? (
          <FormattedMessage
            id="agentTraces.evalsEmpty.noResultsTitle"
            defaultMessage="No evaluation results in this time range"
          />
        )}
      </h3>
    }
    body={
      <EuiText size="s">
        {body ?? (
          <p>
            {onClearFilters ? (
              <FormattedMessage
                id="agentTraces.evalsEmpty.noResultsFilteredBody"
                defaultMessage="Nothing matches these filters in this range. Widen the range or clear the filters."
              />
            ) : (
              <FormattedMessage
                id="agentTraces.evalsEmpty.noResultsBody"
                defaultMessage="Evaluations ran outside this range, or have not run yet. Widen the range."
              />
            )}
          </p>
        )}
      </EuiText>
    }
    actions={
      onSelectRange || onClearFilters ? (
        <EuiFlexGroup gutterSize="s" justifyContent="center" responsive={false} wrap>
          {onSelectRange &&
            ranges.map((r, i) => (
              <EuiFlexItem grow={false} key={r.from}>
                <EuiButton
                  size="s"
                  fill={i === 0}
                  iconType="calendar"
                  onClick={() => onSelectRange(r.from)}
                  data-test-subj={`agtEvlEmptyRange-${r.from}`}
                >
                  {r.label}
                </EuiButton>
              </EuiFlexItem>
            ))}
          {onClearFilters && (
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                size="s"
                onClick={onClearFilters}
                data-test-subj="agtEvlEmptyClearFilters"
              >
                {i18n.translate('agentTraces.evalsEmpty.clearFilters', {
                  defaultMessage: 'Clear filters',
                })}
              </EuiButtonEmpty>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      ) : undefined
    }
  />
);
