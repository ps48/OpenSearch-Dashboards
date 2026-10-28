/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiCallOut,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiHealth,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { TestCaseEvent } from './eval_data';
import {
  CaseComparison,
  CaseStatus,
  EvaluatorAggregate,
  ValueComparison,
  parseEvalTime,
} from './eval_aggregations';
import { CASE_STATUS_COLOR, formatAggregate, formatDuration, shortId } from './eval_components';

export const STATUS_TEXT: Record<CaseStatus, string> = {
  pass: i18n.translate('agentTraces.evalsPage.casePassed', { defaultMessage: 'Passed' }),
  fail: i18n.translate('agentTraces.evalsPage.caseFailed', { defaultMessage: 'Failed' }),
  error: i18n.translate('agentTraces.evalsPage.caseErrored', { defaultMessage: 'Errored' }),
  unknown: i18n.translate('agentTraces.evalsPage.caseUnknown', { defaultMessage: 'Scored' }),
};

/** Case status; an errored case shows a badge with the exception type. */
export const CaseStatusView: React.FC<{ status?: CaseStatus; errorType?: string }> = ({
  status,
  errorType,
}) => {
  if (!status) {
    return (
      <EuiText size="xs" color="subdued">
        -
      </EuiText>
    );
  }
  if (status === 'error') {
    return (
      <EuiToolTip content={errorType}>
        <EuiBadge color="warning" iconType="alert" data-test-subj="agtEvlCaseErrorBadge">
          {errorType ? `${STATUS_TEXT.error}: ${errorType}` : STATUS_TEXT.error}
        </EuiBadge>
      </EuiToolTip>
    );
  }
  return (
    <EuiHealth color={CASE_STATUS_COLOR[status]} data-test-subj={`agtEvlCaseStatus-${status}`}>
      {STATUS_TEXT[status]}
    </EuiHealth>
  );
};

/** JSON is pretty-printed; anything else is shown as is. */
const pretty = (text: string): { text: string; language?: string } => {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), language: 'json' };
    } catch {
      // not JSON
    }
  }
  return { text };
};

const Content: React.FC<{ value?: string; testSubj: string }> = ({ value, testSubj }) => {
  if (value === undefined) {
    return (
      <EuiText size="xs" color="subdued" data-test-subj={testSubj}>
        {i18n.translate('agentTraces.evalsPage.caseNotRecorded', {
          defaultMessage: 'Not recorded',
        })}
      </EuiText>
    );
  }
  const shown = pretty(value);
  return (
    <div data-test-subj={testSubj}>
      <EuiCodeBlock
        fontSize="s"
        paddingSize="s"
        language={shown.language}
        overflowHeight={320}
        whiteSpace="pre-wrap"
        isCopyable
      >
        {shown.text}
      </EuiCodeBlock>
    </div>
  );
};

const SubTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EuiTitle size="xxs">
    <h4>{children}</h4>
  </EuiTitle>
);

const RunSide: React.FC<{
  title: string;
  side: 'baseline' | 'candidate';
  status?: CaseStatus;
  event?: TestCaseEvent;
  traceId?: string;
  fallbackTimeMs: number;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}> = ({ title, side, status, event, traceId, fallbackTimeMs, onOpenTrace }) => {
  const eventTime = parseEvalTime(event?.time);
  return (
    <EuiPanel hasBorder paddingSize="s" data-test-subj={`agtEvlCaseSide-${side}`}>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiText size="xs">
            <strong>{title}</strong>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <CaseStatusView status={status} errorType={event?.errorType} />
        </EuiFlexItem>
        {event?.durationMs !== undefined && (
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {formatDuration(event.durationMs)}
            </EuiText>
          </EuiFlexItem>
        )}
        {traceId && (
          <EuiFlexItem grow={false}>
            <EuiLink
              onClick={() =>
                onOpenTrace(traceId, Number.isFinite(eventTime) ? eventTime : fallbackTimeMs)
              }
              data-test-subj={`agtEvlCaseTrace-${side}`}
            >
              {i18n.translate('agentTraces.evalsPage.caseOpenTrace', {
                defaultMessage: 'Agent trace {id}',
                values: { id: shortId(traceId) },
              })}
            </EuiLink>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <SubTitle>
        {i18n.translate('agentTraces.evalsPage.caseOutput', { defaultMessage: 'Output' })}
      </SubTitle>
      <EuiSpacer size="xs" />
      <Content value={event?.output} testSubj={`agtEvlCaseOutput-${side}`} />
    </EuiPanel>
  );
};

/** One test case in both runs: input, expected, both outputs, statuses, scores and traces. */
export const CaseCompareFlyout: React.FC<{
  comparison: CaseComparison;
  baselineStartedMs: number;
  candidateStartedMs: number;
  onClose: () => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
  /** Opens both agent traces side by side; shown when both runs have a trace for the case. */
  onCompareTraces?: () => void;
}> = ({
  comparison: c,
  baselineStartedMs,
  candidateStartedMs,
  onClose,
  onOpenTrace,
  onCompareTraces,
}) => {
  const input = c.candidateCase?.input ?? c.baselineCase?.input;
  const expected = c.candidateCase?.expected ?? c.baselineCase?.expected;
  const hasContent =
    input !== undefined ||
    expected !== undefined ||
    c.baselineCase?.output !== undefined ||
    c.candidateCase?.output !== undefined;
  const evaluatorNames = Object.keys(c.evaluators).sort();
  return (
    <EuiFlyout
      onClose={onClose}
      size="l"
      ownFocus={false}
      aria-labelledby="agtEvlCaseFlyoutTitle"
      data-test-subj="agtEvlCaseFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id="agtEvlCaseFlyoutTitle">{c.caseName ?? c.caseId}</h2>
        </EuiTitle>
        {c.caseName && (
          <EuiText size="xs" color="subdued" className="agtEvlMono">
            {c.caseId}
          </EuiText>
        )}
        {onCompareTraces && c.baselineTraceId && c.candidateTraceId && (
          <>
            <EuiSpacer size="s" />
            <EuiButton
              size="s"
              iconType="inspect"
              onClick={onCompareTraces}
              data-test-subj="agtEvlCaseCompareTraces"
            >
              {i18n.translate('agentTraces.evalsPage.compareTraces', {
                defaultMessage: 'Compare agent traces',
              })}
            </EuiButton>
          </>
        )}
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {!hasContent && (
          <>
            <EuiCallOut
              size="s"
              iconType="iInCircle"
              data-test-subj="agtEvlCaseNoContent"
              title={i18n.translate('agentTraces.evalsPage.caseNoContent', {
                defaultMessage:
                  'Input, expected and output were not recorded for this test case. Runs that emit test case events with input and output recording turned on include them.',
              })}
            />
            <EuiSpacer size="m" />
          </>
        )}
        <SubTitle>
          {i18n.translate('agentTraces.evalsPage.caseInput', { defaultMessage: 'Input' })}
        </SubTitle>
        <EuiSpacer size="xs" />
        <Content value={input} testSubj="agtEvlCaseInput" />
        <EuiSpacer size="m" />
        <SubTitle>
          {i18n.translate('agentTraces.evalsPage.caseExpected', { defaultMessage: 'Expected' })}
        </SubTitle>
        <EuiSpacer size="xs" />
        <Content value={expected} testSubj="agtEvlCaseExpected" />
        <EuiSpacer size="m" />
        <EuiFlexGroup gutterSize="s">
          <EuiFlexItem>
            <RunSide
              title={i18n.translate('agentTraces.evalsPage.baseline', {
                defaultMessage: 'Baseline',
              })}
              side="baseline"
              status={c.baselineStatus}
              event={c.baselineCase}
              traceId={c.baselineTraceId}
              fallbackTimeMs={baselineStartedMs}
              onOpenTrace={onOpenTrace}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <RunSide
              title={i18n.translate('agentTraces.evalsPage.candidate', {
                defaultMessage: 'Candidate',
              })}
              side="candidate"
              status={c.candidateStatus}
              event={c.candidateCase}
              traceId={c.candidateTraceId}
              fallbackTimeMs={candidateStartedMs}
              onOpenTrace={onOpenTrace}
            />
          </EuiFlexItem>
        </EuiFlexGroup>
        {evaluatorNames.length > 0 && (
          <>
            <EuiSpacer size="m" />
            <SubTitle>
              {i18n.translate('agentTraces.evalsPage.caseScores', { defaultMessage: 'Scores' })}
            </SubTitle>
            <EuiSpacer size="xs" />
            <EuiBasicTable<{ name: string } & ValueComparison>
              compressed
              items={evaluatorNames.map((name) => ({ name, ...c.evaluators[name] }))}
              columns={[
                {
                  field: 'name',
                  name: i18n.translate('agentTraces.evalsPage.caseScoreName', {
                    defaultMessage: 'Evaluation',
                  }),
                },
                {
                  field: 'baseline',
                  name: i18n.translate('agentTraces.evalsPage.baseline', {
                    defaultMessage: 'Baseline',
                  }),
                  render: (v?: EvaluatorAggregate) => formatAggregate(v),
                },
                {
                  field: 'candidate',
                  name: i18n.translate('agentTraces.evalsPage.candidate', {
                    defaultMessage: 'Candidate',
                  }),
                  render: (v?: EvaluatorAggregate) => formatAggregate(v),
                },
              ]}
              data-test-subj="agtEvlCaseScores"
            />
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
