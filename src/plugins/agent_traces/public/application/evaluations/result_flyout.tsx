/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EuiAccordion,
  EuiBadge,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { EvalResult } from './eval_model';
import {
  DASH,
  NO_AGENT_LABEL,
  VerdictBadge,
  VersionBadge,
  formatScore,
  formatTime,
  shortId,
} from './eval_components';

export interface ResultLinks {
  /** View trace; absent where the trace is already open. */
  openTrace?: (traceId: string, aroundMs: number) => void;
  openSuite?: (suite: string) => void;
  openRun?: (runId: string) => void;
}

/** Where the score sits on its declared scale (`opensearch.evaluation.score.min|max`). */
export const scalePosition = (r: Pick<EvalResult, 'value' | 'scoreMin' | 'scoreMax'>) =>
  r.value !== undefined &&
  r.scoreMin !== undefined &&
  r.scoreMax !== undefined &&
  r.scoreMax > r.scoreMin
    ? Math.min(1, Math.max(0, (r.value - r.scoreMin) / (r.scoreMax - r.scoreMin)))
    : undefined;

/** One result, from the row that listed it: no query. */
export const ResultFlyout: React.FC<{
  result: EvalResult;
  onClose: () => void;
  links?: ResultLinks;
}> = ({ result: r, onClose, links = {} }) => {
  const at = scalePosition(r);
  const online = !r.runId;
  const items = [
    {
      title: i18n.translate('agentTraces.evals.flyout.evaluator', { defaultMessage: 'Evaluator' }),
      description: (
        <span>
          {r.evaluatorName ?? r.scope ?? DASH}{' '}
          {r.evaluatorType && <EuiBadge color="hollow">{r.evaluatorType}</EuiBadge>}
        </span>
      ),
    },
    {
      title: i18n.translate('agentTraces.evals.flyout.judged', { defaultMessage: 'Judged' }),
      description: (
        <span data-test-subj="agtEvlFlyoutJudged">
          {r.level === 'span' && r.spanId
            ? i18n.translate('agentTraces.evals.flyout.span', {
                defaultMessage: 'Span {id}',
                values: { id: r.spanId },
              })
            : i18n.translate('agentTraces.evals.flyout.wholeTrace', {
                defaultMessage: 'Whole trace',
              })}
          {r.traceId && links.openTrace && (
            <>
              {' · '}
              <EuiLink
                onClick={() => r.traceId && links.openTrace?.(r.traceId, r.time)}
                data-test-subj="agtEvlFlyoutViewTrace"
              >
                {i18n.translate('agentTraces.evals.flyout.viewTrace', {
                  defaultMessage: 'View trace',
                })}
              </EuiLink>
            </>
          )}
          {r.traceId && !links.openTrace && (
            <span className="agtEvlMono agtEvlDim"> · {shortId(r.traceId)}</span>
          )}
        </span>
      ),
    },
    online
      ? {
          title: i18n.translate('agentTraces.evals.flyout.source', { defaultMessage: 'Source' }),
          description: i18n.translate('agentTraces.evals.flyout.onlineSource', {
            defaultMessage: 'Online (live traffic)',
          }),
        }
      : {
          title: i18n.translate('agentTraces.evals.flyout.suiteRun', {
            defaultMessage: 'Suite run',
          }),
          description: (
            <span data-test-subj="agtEvlFlyoutSuiteRun">
              {r.suiteName &&
                (links.openSuite ? (
                  <EuiLink onClick={() => r.suiteName && links.openSuite?.(r.suiteName)}>
                    {r.suiteName}
                  </EuiLink>
                ) : (
                  r.suiteName
                ))}
              {' · '}
              {links.openRun && r.runId ? (
                <EuiLink
                  className="agtEvlMono"
                  title={r.runId}
                  onClick={() => r.runId && links.openRun?.(r.runId)}
                >
                  {shortId(r.runId)}
                </EuiLink>
              ) : (
                <span className="agtEvlMono">{shortId(r.runId)}</span>
              )}
              {r.caseId && (
                <>
                  {' · '}
                  {i18n.translate('agentTraces.evals.flyout.case', {
                    defaultMessage: 'case {name}',
                    values: { name: r.caseName ? `${r.caseName} (${r.caseId})` : r.caseId },
                  })}
                </>
              )}
            </span>
          ),
        },
  ];

  return (
    <EuiFlyout
      onClose={onClose}
      size="m"
      ownFocus={false}
      maxWidth={720}
      aria-labelledby="agtEvlResultFlyoutTitle"
      data-test-subj="agtEvlResultFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiTitle size="s">
              <h2 id="agtEvlResultFlyoutTitle">{r.name}</h2>
            </EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <VerdictBadge verdict={r.verdict} />
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiText size="xs" color="subdued">
          <p>
            {r.agentName ?? NO_AGENT_LABEL}{' '}
            {r.agentVersion && <VersionBadge version={r.agentVersion} />}
            {' · '}
            {formatTime(r.time, 'MMM D, HH:mm:ss')}
            {' · '}
            {online
              ? i18n.translate('agentTraces.evals.flyout.online', { defaultMessage: 'Online' })
              : i18n.translate('agentTraces.evals.flyout.offline', { defaultMessage: 'Offline' })}
          </p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiPanel paddingSize="s" hasShadow={false} hasBorder className="agtEvlScore">
          <EuiTitle size="m">
            <span data-test-subj="agtEvlFlyoutScore">
              {formatScore(r.value)}
              {r.scoreMax !== undefined && at !== undefined && (
                <span className="agtEvlDim agtEvlSmall"> / {r.scoreMax}</span>
              )}
            </span>
          </EuiTitle>
          <EuiText size="xs" color="subdued">
            <span>
              {i18n.translate('agentTraces.evals.flyout.score', { defaultMessage: 'Score' })}
              {r.label && (
                <>
                  {' · '}
                  {i18n.translate('agentTraces.evals.flyout.label', {
                    defaultMessage: 'label',
                  })}{' '}
                  <code>{r.label}</code>
                </>
              )}
              {r.errorType && (
                <>
                  {' · '}
                  <code>{r.errorType}</code>
                </>
              )}
            </span>
          </EuiText>
          {at !== undefined && (
            <div className="agtEvlScale" data-test-subj="agtEvlFlyoutScale">
              <div className="agtEvlScale__track">
                <span className="agtEvlScale__mark" style={{ left: `${at * 100}%` }} />
              </div>
              <EuiFlexGroup justifyContent="spaceBetween" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiText size="xs" color="subdued">
                    {r.scoreMin}
                  </EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="xs" color="subdued">
                    {r.scoreMax}
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </div>
          )}
        </EuiPanel>
        <EuiSpacer size="m" />
        {r.explanation && (
          <>
            <EuiText size="s">
              <h4>
                {i18n.translate('agentTraces.evals.flyout.explanation', {
                  defaultMessage: 'Explanation',
                })}
              </h4>
              <p className="agtEvlProse">{r.explanation}</p>
            </EuiText>
            <EuiSpacer size="m" />
          </>
        )}
        <EuiDescriptionList type="column" compressed listItems={items} />
        <EuiSpacer size="m" />
        <EuiAccordion
          id="agtEvlRawEvent"
          buttonContent={i18n.translate('agentTraces.evals.flyout.rawEvent', {
            defaultMessage: 'Raw event',
          })}
          data-test-subj="agtEvlRawEvent"
        >
          <EuiCodeBlock language="json" fontSize="s" paddingSize="s" isCopyable>
            {JSON.stringify(r.raw, null, 2)}
          </EuiCodeBlock>
        </EuiAccordion>
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
