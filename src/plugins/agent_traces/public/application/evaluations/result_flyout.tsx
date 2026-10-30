/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCode,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiHorizontalRule,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import {
  MessageContent,
  MessageViewMode,
  MessageViewModeToggle,
} from '../pages/traces/flyout/message_content_view';
import { pplResponseToRecords, withoutTimeRange } from '../pages/sessions/session_utils';
import {
  EVAL_EVENT_WHERE,
  EVAL_FIELDS,
  EvalResult,
  createEvalsPplService,
  evalsDataset,
  failuresFirst,
  recordToEvalResult,
} from './eval_data';
import { useEvalsIndexPattern, useSpansIndexPattern } from './eval_dataset';
import { ShowTracesMenu } from './eval_trace_filter';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { parseEvalTime } from './eval_aggregations';
import { JudgedTarget, TargetSpan, fetchJudgedTarget } from './eval_target';
import {
  openSessionInAgentTraces,
  openTraceInAgentTraces,
  sessionToOpen,
  traceToOpen,
} from './eval_links';
import {
  LevelBadge,
  OutcomeBadge,
  SourceBadge,
  formatDuration,
  formatEvalTime,
  levelLabel,
  shortId,
} from './eval_components';
import { errorMessage } from './use_eval_data';
import type { EvaluationsServices } from '.';

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Results about the same session or trace (filtered to the same target client-side). */
export const buildSameTargetQuery = (
  r: EvalResult,
  limit = 200,
  index: string = AGENT_EVALS_INDEX_PATTERN,
  /** A session result: also the results of these traces of the session. */
  sessionTraceIds: string[] = []
): string | undefined => {
  const byTrace = (id: string) => `\`${EVAL_FIELDS.targetTraceId}\` = ${quote(id)}`;
  const where =
    r.level === 'session' && r.sessionId
      ? [
          `\`${EVAL_FIELDS.sessionId}\` = ${quote(r.sessionId)}`,
          ...sessionTraceIds.map(byTrace),
        ].join(' or ')
      : r.traceId
        ? byTrace(r.traceId)
        : undefined;
  if (!where) return undefined;
  return `source = ${index} | where ${EVAL_EVENT_WHERE} | where ${where} | sort - \`${EVAL_FIELDS.time}\` | head ${limit}`;
};

/**
 * Results shown as "other evaluations" of `result`: for a session, every result of the session
 * and of its traces and spans; otherwise those that judged the same span or trace.
 */
export const isRelated = (
  r: EvalResult,
  result: EvalResult,
  sessionTraceIds: ReadonlySet<string> = new Set()
): boolean => {
  if (r.id === result.id) return false;
  if (result.level === 'session') {
    return (
      (!!result.sessionId && r.sessionId === result.sessionId) ||
      (!!r.traceId && sessionTraceIds.has(r.traceId))
    );
  }
  return sameTarget(r, result);
};

/** Whether two results judged the same thing (same level and same span, trace or session). */
export const sameTarget = (a: EvalResult, b: EvalResult): boolean => {
  const levelOf = (r: EvalResult) => (r.level === 'tool_call' ? 'span' : r.level);
  if (levelOf(a) !== levelOf(b)) return false;
  if (levelOf(a) === 'session') return !!a.sessionId && a.sessionId === b.sessionId;
  if (levelOf(a) === 'span') return !!a.spanId && a.spanId === b.spanId && a.traceId === b.traceId;
  return !!a.traceId && a.traceId === b.traceId;
};

const Section: React.FC<{
  title: React.ReactNode;
  testSubj?: string;
  children?: React.ReactNode;
}> = ({ title, testSubj, children }) => (
  <div data-test-subj={testSubj}>
    <EuiTitle size="xs">
      <h3>{title}</h3>
    </EuiTitle>
    <EuiSpacer size="s" />
    {children}
    <EuiSpacer size="l" />
  </div>
);

type Detail = [string, React.ReactNode | undefined];
type ShownDetail = [string, NonNullable<React.ReactNode>];

/** Description list items for the details that have a value. */
const details = (items: Detail[]) =>
  items
    .filter(
      (item): item is ShownDetail => item[1] !== undefined && item[1] !== null && item[1] !== ''
    )
    .map(([title, description]) => ({ title, description }));

const SpanDetails: React.FC<{ span: TargetSpan; root?: TargetSpan }> = ({ span, root }) => {
  const [mode, setMode] = useState<MessageViewMode>('formatted');
  const hasMessages = span.input !== undefined || span.output !== undefined;
  const hasTool = span.toolArguments !== undefined || span.toolResult !== undefined;
  return (
    <div data-test-subj="agtEvlTargetSpan">
      <EuiDescriptionList
        compressed
        type="column"
        listItems={details([
          [i18n.translate('agentTraces.evalsPage.spanName', { defaultMessage: 'Span' }), span.name],
          [
            i18n.translate('agentTraces.evalsPage.spanOperation', { defaultMessage: 'Operation' }),
            span.operation,
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanAgent', { defaultMessage: 'Agent' }),
            span.agentName,
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanTool', { defaultMessage: 'Tool' }),
            span.toolName,
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanService', { defaultMessage: 'Service' }),
            span.serviceName,
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanDuration', { defaultMessage: 'Duration' }),
            formatDuration(span.durationMs),
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanStatus', { defaultMessage: 'Status' }),
            span.status,
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanStart', { defaultMessage: 'Started' }),
            span.startTime ? formatEvalTime(span.startTime, 'MMM D, YYYY HH:mm:ss.SSS') : undefined,
          ],
          [
            i18n.translate('agentTraces.evalsPage.spanIds', { defaultMessage: 'Span id' }),
            <EuiCode key="id">{span.spanId}</EuiCode>,
          ],
          [
            i18n.translate('agentTraces.evalsPage.rootSpan', { defaultMessage: 'Trace root' }),
            root ? `${root.name} (${formatDuration(root.durationMs)})` : undefined,
          ],
        ])}
      />
      {(hasMessages || hasTool) && (
        <>
          <EuiSpacer size="m" />
          <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiText size="s">
                <strong>
                  <FormattedMessage
                    id="agentTraces.evalsPage.judgedContent"
                    defaultMessage="What was judged"
                  />
                </strong>
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <MessageViewModeToggle mode={mode} onChange={setMode} idPrefix="agtEvlJudged" />
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiPanel paddingSize="s" color="subdued" data-test-subj="agtEvlJudgedInput">
            <EuiText size="xs" color="subdued">
              {hasMessages
                ? i18n.translate('agentTraces.evalsPage.input', { defaultMessage: 'Input' })
                : i18n.translate('agentTraces.evalsPage.toolArgs', {
                    defaultMessage: 'Tool arguments',
                  })}
            </EuiText>
            <MessageContent value={hasMessages ? span.input : span.toolArguments} mode={mode} />
          </EuiPanel>
          <EuiSpacer size="s" />
          <EuiPanel paddingSize="s" color="subdued" data-test-subj="agtEvlJudgedOutput">
            <EuiText size="xs" color="subdued">
              {hasMessages
                ? i18n.translate('agentTraces.evalsPage.output', { defaultMessage: 'Output' })
                : i18n.translate('agentTraces.evalsPage.toolResult', {
                    defaultMessage: 'Tool result',
                  })}
            </EuiText>
            <MessageContent value={hasMessages ? span.output : span.toolResult} mode={mode} />
          </EuiPanel>
        </>
      )}
    </div>
  );
};

const SessionTraces: React.FC<{
  traces: TargetSpan[];
  onOpenTrace: (span: TargetSpan) => void;
}> = ({ traces, onOpenTrace }) => (
  <ul className="agtEvlSessionTraces" data-test-subj="agtEvlSessionTraces">
    {traces.map((t, i) => (
      <li key={t.traceId} className="agtEvlSessionTraces__item">
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              #{i + 1}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem style={{ minWidth: 0 }}>
            <EuiText size="xs" className="eui-textTruncate">
              <strong>{t.agentName ?? t.name}</strong> {formatEvalTime(t.startTime)}
              {' · '}
              {formatDuration(t.durationMs)}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiLink onClick={() => onOpenTrace(t)} data-test-subj="agtEvlSessionTraceLink">
              {i18n.translate('agentTraces.evalsPage.openTraceShort', {
                defaultMessage: 'Open trace {id}',
                values: { id: shortId(t.traceId) },
              })}
            </EuiLink>
          </EuiFlexItem>
        </EuiFlexGroup>
      </li>
    ))}
  </ul>
);

interface Loadable<T> {
  loading: boolean;
  error?: string;
  value?: T;
}

export const ResultFlyout: React.FC<{
  result: EvalResult;
  onClose: () => void;
  onOpenResult: (r: EvalResult) => void;
}> = ({ result, onClose, onOpenResult }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  // Shown on the Evaluations page, where the dataset is already loaded.
  const index = useEvalsIndexPattern() ?? AGENT_EVALS_INDEX_PATTERN;
  const spansIndex = useSpansIndexPattern();
  const [target, setTarget] = useState<Loadable<JudgedTarget>>({ loading: true });
  const [others, setOthers] = useState<Loadable<EvalResult[]>>({ loading: true });

  useEffect(() => {
    const controller = new AbortController();
    const ppl = createEvalsPplService(services.data, undefined, controller.signal);
    setTarget({ loading: true });
    fetchJudgedTarget(ppl, result, spansIndex)
      .then((value) => !controller.signal.aborted && setTarget({ loading: false, value }))
      .catch(
        (e) => !controller.signal.aborted && setTarget({ loading: false, error: errorMessage(e) })
      );
    return () => controller.abort();
  }, [services.data, result, spansIndex]);

  // A session's other evaluations include those of its traces, known once the target loaded.
  const isSession = result.level === 'session';
  const sessionTraceIds = useMemo(
    () => (isSession ? (target.value?.traces ?? []).map((t) => t.traceId) : []),
    [isSession, target.value]
  );
  const waitForTraces = isSession && target.loading;
  useEffect(() => {
    if (waitForTraces) {
      setOthers({ loading: true });
      return;
    }
    const controller = new AbortController();
    const ppl = createEvalsPplService(services.data, undefined, controller.signal);
    setOthers({ loading: true });
    const query = buildSameTargetQuery(result, 500, index, sessionTraceIds);
    if (query) {
      const traceSet = new Set(sessionTraceIds);
      ppl
        .executeQuery(withoutTimeRange(evalsDataset(index)), query)
        .then((response) => {
          if (controller.signal.aborted) return;
          const list = pplResponseToRecords(response)
            .map(recordToEvalResult)
            .filter((r) => isRelated(r, result, traceSet));
          setOthers({ loading: false, value: failuresFirst(list) });
        })
        .catch(
          (e) => !controller.signal.aborted && setOthers({ loading: false, error: errorMessage(e) })
        );
    } else {
      setOthers({ loading: false, value: [] });
    }
    return () => controller.abort();
  }, [services.data, result, index, sessionTraceIds, waitForTraces]);

  const traceId =
    traceToOpen(result) ?? target.value?.traces?.[target.value.traces.length - 1]?.traceId;
  const aroundMs = target.value?.span?.startMs ?? parseEvalTime(result.time);
  const sessionId = sessionToOpen(result);
  const openTrace = (id: string, ms: number) =>
    openTraceInAgentTraces(services.application, id, ms);

  const evaluatorItems = useMemo(
    () =>
      details([
        [
          i18n.translate('agentTraces.evalsPage.evaluator', { defaultMessage: 'Evaluator' }),
          result.evaluator,
        ],
        [
          i18n.translate('agentTraces.evalsPage.evaluatorVersion', { defaultMessage: 'Version' }),
          result.evaluatorVersion,
        ],
        [
          i18n.translate('agentTraces.evalsPage.evaluatorType', { defaultMessage: 'Type' }),
          result.evaluatorType,
        ],
        [
          i18n.translate('agentTraces.evalsPage.scoreRange', { defaultMessage: 'Score range' }),
          result.scoreMin !== undefined || result.scoreMax !== undefined
            ? `${result.scoreMin ?? '?'} to ${result.scoreMax ?? '?'}`
            : undefined,
        ],
        [
          i18n.translate('agentTraces.evalsPage.direction', { defaultMessage: 'Direction' }),
          result.direction === 'minimize'
            ? i18n.translate('agentTraces.evalsPage.minimize', {
                defaultMessage: 'Lower is better',
              })
            : result.direction === 'maximize'
              ? i18n.translate('agentTraces.evalsPage.maximize', {
                  defaultMessage: 'Higher is better',
                })
              : undefined,
        ],
        [
          i18n.translate('agentTraces.evalsPage.ratingScale', { defaultMessage: 'Rating scale' }),
          result.ratingScale,
        ],
        [
          i18n.translate('agentTraces.evalsPage.onlineConfig', {
            defaultMessage: 'AgentCore online evaluation',
          }),
          result.onlineConfig,
        ],
        [
          i18n.translate('agentTraces.evalsPage.errorType', { defaultMessage: 'Evaluator error' }),
          result.errorType,
        ],
        [
          i18n.translate('agentTraces.evalsPage.judgeTrace', { defaultMessage: 'Judge trace' }),
          result.judgeTraceId ? (
            <EuiLink
              onClick={() => openTrace(result.judgeTraceId as string, parseEvalTime(result.time))}
              data-test-subj="agtEvlJudgeTraceLink"
            >
              {shortId(result.judgeTraceId)}
            </EuiLink>
          ) : undefined,
        ],
        [
          i18n.translate('agentTraces.evalsPage.suiteRun', { defaultMessage: 'Evaluation run' }),
          result.runId ? `${result.suiteName ?? ''} ${result.runId}`.trim() : undefined,
        ],
        [
          i18n.translate('agentTraces.evalsPage.testCase', { defaultMessage: 'Test case' }),
          result.caseId || result.caseName
            ? `${result.caseName ?? ''} ${result.caseId ?? ''}`.trim()
            : undefined,
        ],
        [
          i18n.translate('agentTraces.evalsPage.responseId', { defaultMessage: 'Response id' }),
          result.responseId,
        ],
        [
          i18n.translate('agentTraces.evalsPage.producer', { defaultMessage: 'Reported by' }),
          result.serviceName,
        ],
      ]),
    // openTrace only depends on services, stable for the flyout's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result]
  );

  return (
    <EuiFlyout
      onClose={onClose}
      size="m"
      ownFocus={false}
      aria-labelledby="agtEvlFlyoutTitle"
      data-test-subj="agtEvlResultFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id="agtEvlFlyoutTitle">{result.name}</h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" alignItems="center" wrap responsive={false}>
          <EuiFlexItem grow={false}>
            <OutcomeBadge result={result} />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <LevelBadge level={result.level} />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <SourceBadge source={result.source} />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {formatEvalTime(result.time, 'MMM D, YYYY HH:mm:ss.SSS')}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" responsive={false} wrap>
          {sessionId ? (
            <EuiFlexItem grow={false}>
              <EuiButton
                size="s"
                iconType="popout"
                onClick={() =>
                  openSessionInAgentTraces(
                    services.application,
                    sessionId,
                    parseEvalTime(result.time)
                  )
                }
                data-test-subj="agtEvlOpenSession"
              >
                {i18n.translate('agentTraces.evalsPage.openSession', {
                  defaultMessage: 'Open session',
                })}
              </EuiButton>
            </EuiFlexItem>
          ) : (
            traceId && (
              <EuiFlexItem grow={false}>
                <EuiButton
                  size="s"
                  iconType="popout"
                  onClick={() => openTrace(traceId, aroundMs)}
                  data-test-subj="agtEvlOpenTrace"
                >
                  {i18n.translate('agentTraces.evalsPage.openTrace', {
                    defaultMessage: 'Open trace in Agent Traces',
                  })}
                </EuiButton>
              </EuiFlexItem>
            )
          )}
        </EuiFlexGroup>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <Section
          title={i18n.translate('agentTraces.evalsPage.resultSection', {
            defaultMessage: 'Result',
          })}
          testSubj="agtEvlFlyoutResult"
        >
          <EuiDescriptionList
            compressed
            type="column"
            listItems={details([
              [
                i18n.translate('agentTraces.evalsPage.score', { defaultMessage: 'Score' }),
                result.value !== undefined ? String(result.value) : undefined,
              ],
              [
                i18n.translate('agentTraces.evalsPage.label', { defaultMessage: 'Label' }),
                result.label,
              ],
            ])}
          />
          <EuiSpacer size="s" />
          {result.explanation ? (
            <EuiText size="s" className="agtEvlExplanation" data-test-subj="agtEvlExplanation">
              <p>{result.explanation}</p>
            </EuiText>
          ) : (
            <EuiText size="s" color="subdued">
              <FormattedMessage
                id="agentTraces.evalsPage.noExplanation"
                defaultMessage="The evaluator gave no explanation."
              />
            </EuiText>
          )}
        </Section>

        <Section
          title={i18n.translate('agentTraces.evalsPage.evaluatorSection', {
            defaultMessage: 'Evaluator',
          })}
          testSubj="agtEvlFlyoutEvaluator"
        >
          <EuiDescriptionList compressed type="column" listItems={evaluatorItems} />
        </Section>

        <Section
          title={i18n.translate('agentTraces.evalsPage.targetSection', {
            defaultMessage: 'Judged {level}',
            values: { level: levelLabel(result.level).toLowerCase() },
          })}
          testSubj="agtEvlFlyoutTarget"
        >
          {target.loading && <EuiLoadingContent lines={4} />}
          {target.error && (
            <EuiCallOut size="s" color="danger" iconType="alert" title={target.error} />
          )}
          {target.value && !target.value.span && !target.value.traces?.length && (
            <EuiText size="s" color="subdued" data-test-subj="agtEvlTargetMissing">
              <FormattedMessage
                id="agentTraces.evalsPage.targetMissing"
                defaultMessage="The judged spans were not found in {index}. They may have aged out, or the agent's traces are stored elsewhere."
                values={{ index: <EuiCode>{spansIndex}</EuiCode> }}
              />
            </EuiText>
          )}
          {target.value?.span && <SpanDetails span={target.value.span} root={target.value.root} />}
          {target.value?.traces && target.value.traces.length > 0 && (
            <SessionTraces
              traces={target.value.traces}
              onOpenTrace={(t) => openTrace(t.traceId, t.startMs)}
            />
          )}
          {target.value?.partial && (
            <EuiText size="xs" color="subdued">
              <FormattedMessage
                id="agentTraces.evalsPage.targetPartial"
                defaultMessage="Large target: only part of its spans were read."
              />
            </EuiText>
          )}
        </Section>

        <EuiHorizontalRule margin="s" />
        <Section
          title={i18n.translate('agentTraces.evalsPage.othersSection', {
            defaultMessage: 'Other evaluations of this {level}',
            values: { level: levelLabel(result.level).toLowerCase() },
          })}
          testSubj="agtEvlFlyoutOthers"
        >
          {isSession && (
            <>
              <EuiText size="xs" color="subdued">
                <FormattedMessage
                  id="agentTraces.evalsPage.othersSessionHelp"
                  defaultMessage="Session results, and the trace and span results of the session's traces."
                />
              </EuiText>
              <EuiSpacer size="s" />
            </>
          )}
          {others.loading && <EuiLoadingContent lines={2} />}
          {others.error && (
            <EuiCallOut size="s" color="danger" iconType="alert" title={others.error} />
          )}
          {others.value && others.value.length === 0 && (
            <EuiText size="s" color="subdued">
              <FormattedMessage id="agentTraces.evalsPage.noOthers" defaultMessage="None." />
            </EuiText>
          )}
          {others.value && others.value.length > 0 && (
            <ul className="agtEvlOthers">
              {others.value.map((r) => (
                <li key={r.id} className="agtEvlOthers__item">
                  <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                    <EuiFlexItem grow={false}>
                      <OutcomeBadge result={r} />
                    </EuiFlexItem>
                    {isSession && (
                      <EuiFlexItem grow={false}>
                        <LevelBadge level={r.level} />
                      </EuiFlexItem>
                    )}
                    <EuiFlexItem grow={false}>
                      <ShowTracesMenu name={r.name} label={r.label} value={r.value} />
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiButtonEmpty
                        size="xs"
                        flush="left"
                        onClick={() => onOpenResult(r)}
                        data-test-subj="agtEvlOtherResult"
                      >
                        {r.name}
                      </EuiButtonEmpty>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiText size="xs" color="subdued">
                        {r.evaluator} · {formatEvalTime(r.time)}
                      </EuiText>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
