/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  BaseRow,
  TraceRow,
  buildFullSpanTree,
  formatTimestamp,
  hitsToAgentSpans,
} from '../pages/traces/hooks/tree_utils';
import { readAttribute } from '../pages/traces/hooks/genai_message_preview';
import { transformPPLDataToTraceHits } from '../pages/traces/trace_details/traces/ppl_to_trace_hits';
import {
  EvalResult,
  PplRecord,
  caseStatusOf,
  num,
  recordsToResults,
  str,
  tallyOf,
} from './eval_model';
import { buildCaseResultsQuery, buildOneTraceSpansQuery } from './ppl_queries';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { useJudgedSpans, useSessionTurns } from './eval_spans';
import { useRunBefore } from './run_page';
import { JsonAccordion } from './json_viewer';
import { NewTabViewLink } from './view_links';
import { SpanIOView } from './span_io_view';
import { getEvalTimezone } from './eval_time';
import { CompareRunRef, SpanList, TraceCompareFlyout, flattenSpans } from './trace_compare_flyout';
import {
  CiLink,
  DASH,
  EXPECTED_LABEL,
  INPUT_LABEL,
  NO_AGENT_LABEL,
  OUTPUT_LABEL,
  QueryErrorCallout,
  VerdictBadge,
  VersionBadge,
  expectedNote,
  formatDuration,
  formatScore,
  formatTime,
  ScoreBricks,
  scoreOrLabel,
  scoreScale,
  shortId,
} from './eval_components';

export interface ResultLinks {
  /** View trace; absent where the trace is already open. */
  openTrace?: (traceId: string, aroundMs: number) => void;
  openSuite?: (suite: string) => void;
  openRun?: (runId: string) => void;
  /** View session (session-level results). */
  openSession?: (sessionId: string, aroundMs: number) => void;
}

/** Where the score sits on its declared scale (`opensearch.gen_ai.evaluation.score.min|max`). */
export const scalePosition = (r: Pick<EvalResult, 'value' | 'scoreMin' | 'scoreMax'>) =>
  r.value !== undefined &&
  r.scoreMin !== undefined &&
  r.scoreMax !== undefined &&
  r.scoreMax > r.scoreMin
    ? Math.min(1, Math.max(0, (r.value - r.scoreMin) / (r.scoreMax - r.scoreMin)))
    : undefined;

/** The same result in another list (ids carry the list position). */
const sameResult = (a: EvalResult, b: EvalResult) =>
  a.name === b.name && a.time === b.time && a.spanId === b.spanId && a.traceId === b.traceId;

const SectionLabel: React.FC = ({ children }) => (
  <EuiText size="s">
    <h4>{children}</h4>
  </EuiText>
);

/** The prompt template as `name@version` (either may be missing). */
export const promptLabel = (r: Pick<EvalResult, 'promptName' | 'promptVersion'>) =>
  r.promptName
    ? `${r.promptName}${r.promptVersion ? `@${r.promptVersion}` : ''}`
    : r.promptVersion
      ? `@${r.promptVersion}`
      : undefined;

/**
 * The judge's context, when the SDK recorded it: what the evaluator checks, the judge model,
 * the prompt template and (opt-in) the judge's system instructions, collapsed.
 */
export const JudgeContext: React.FC<{ r: EvalResult }> = ({ r }) => {
  const prompt = promptLabel(r);
  const items = [
    r.evaluatorDescription && {
      title: i18n.translate('agentTraces.evals.flyout.whatItChecks', {
        defaultMessage: 'What it checks',
      }),
      description: (
        <span className="agtEvlProse" data-test-subj="agtEvlFlyoutEvaluatorDescription">
          {r.evaluatorDescription}
        </span>
      ),
    },
    r.judgeModel && {
      title: i18n.translate('agentTraces.evals.flyout.judgeModel', {
        defaultMessage: 'Judge model',
      }),
      description: (
        <code data-test-subj="agtEvlFlyoutJudgeModel" title="gen_ai.request.model">
          {r.judgeModel}
        </code>
      ),
    },
    prompt && {
      title: i18n.translate('agentTraces.evals.flyout.judgePrompt', {
        defaultMessage: 'Judge prompt',
      }),
      description: (
        <code data-test-subj="agtEvlFlyoutJudgePrompt" title="gen_ai.prompt.name / version">
          {prompt}
        </code>
      ),
    },
  ].filter(Boolean) as Array<{ title: string; description: React.ReactNode }>;
  if (!items.length && !r.systemInstructions) return null;
  return (
    <div data-test-subj="agtEvlJudgeContext">
      {items.length > 0 && <EuiDescriptionList type="column" compressed listItems={items} />}
      {r.systemInstructions && (
        <>
          <EuiSpacer size="s" />
          <JsonAccordion
            id={`agtEvlJudgeInstructions-${r.id}`}
            label={
              <span>
                {i18n.translate('agentTraces.evals.flyout.judgeInstructions', {
                  defaultMessage: 'Judge system instructions',
                })}
                {r.systemInstructionsTruncated && (
                  <span
                    className="agtEvlDim agtEvlSmall"
                    data-test-subj="agtEvlJudgeInstructionsTruncated"
                  >
                    {' '}
                    {i18n.translate('agentTraces.evals.flyout.judgeInstructionsTruncated', {
                      defaultMessage: '(truncated)',
                    })}
                  </span>
                )}
              </span>
            }
            value={r.systemInstructions}
            testId="agtEvlJudgeInstructions"
          />
        </>
      )}
    </div>
  );
};

/** The judged session, trace or span in Agent Traces, in a new tab: an icon after its link. */
const NewTabLink: React.FC<{ r: EvalResult }> = ({ r }) => {
  const { hrefOf } = useEvalContext();
  const href = hrefOf?.(r);
  if (!href) return null;
  const label = i18n.translate('agentTraces.evals.flyout.newTab', {
    defaultMessage: 'Open in a new tab',
  });
  return (
    <EuiButtonIcon
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      iconType="popout"
      iconSize="s"
      size="xs"
      aria-label={label}
      title={label}
      data-test-subj="agtEvlFlyoutNewTab"
    />
  );
};

/**
 * What a session-level judge saw: the conversation (`gen_ai.conversation.id`), its first
 * input and last output from its turns' root spans (one query, when the flyout opens).
 */
const SessionJudgedSection: React.FC<{
  r: EvalResult;
  openSession?: (sessionId: string, aroundMs: number) => void;
}> = ({ r, openSession }) => {
  const { hrefOf } = useEvalContext();
  const session = useSessionTurns(r.conversationId);
  const first = session.turns[0];
  const last = session.turns[session.turns.length - 1];
  return (
    <div data-test-subj="agtEvlJudgeSawSession">
      <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false}>
        <EuiFlexItem grow={false}>
          <SectionLabel>
            {i18n.translate('agentTraces.evals.flyout.judgeSaw', {
              defaultMessage: 'What the judge saw',
            })}
          </SectionLabel>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="xs" color="subdued" data-test-subj="agtEvlFlyoutJudged">
            {r.conversationId
              ? i18n.translate('agentTraces.evals.flyout.wholeSession', {
                  defaultMessage:
                    'the whole session {id} ({n} {n, plural, one {turn} other {turns}})',
                  values: { id: shortId(r.conversationId), n: session.turns.length },
                })
              : i18n.translate('agentTraces.evals.flyout.sessionNoId', {
                  defaultMessage: 'a session (the result has no gen_ai.conversation.id)',
                })}
          </EuiText>
        </EuiFlexItem>
        {r.conversationId && openSession && (
          <EuiFlexItem grow={false}>
            <EuiText size="xs">
              <NewTabViewLink
                href={hrefOf?.(r)}
                onOpen={() => r.conversationId && openSession(r.conversationId, r.time)}
                label={i18n.translate('agentTraces.evals.flyout.viewSession', {
                  defaultMessage: 'View session',
                })}
                testId="agtEvlFlyoutViewSession"
              />
            </EuiText>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
      {session.error ? (
        <QueryErrorCallout message={session.error} />
      ) : session.loading && !first ? (
        <EuiLoadingContent lines={2} />
      ) : r.conversationId && session.loaded && !first ? (
        <EuiText size="xs" color="subdued" data-test-subj="agtEvlJudgedMissing">
          <p className="agtEvlBox">
            {i18n.translate('agentTraces.evals.flyout.sessionMissing', {
              defaultMessage: 'The session has no traces in the span index (or outside retention).',
            })}
          </p>
        </EuiText>
      ) : (
        first && (
          <SpanIOView
            idPrefix={`agtEvlJudgedSession-${r.id}`}
            testId="agtEvlJudgedIO"
            sections={[
              {
                key: 'input',
                label: i18n.translate('agentTraces.evals.flyout.firstInput', {
                  defaultMessage: 'First input',
                }),
                value: first.rawInput ?? first.input,
              },
              {
                key: 'output',
                label: i18n.translate('agentTraces.evals.flyout.lastOutput', {
                  defaultMessage: 'Last output',
                }),
                value: last?.rawOutput ?? last?.output,
              },
            ]}
          />
        )
      )}
    </div>
  );
};

/**
 * What the judge saw: the judged span's input and output (the root span for trace-level
 * results; one lazy span query) and, offline, the case's expected output.
 */
const JudgedSection: React.FC<{
  r: EvalResult;
  openTrace?: (traceId: string, aroundMs: number) => void;
  onJudgeTrace: () => void;
}> = ({ r, openTrace, onJudgeTrace }) => {
  const { hrefOf } = useEvalContext();
  const spanLevel = r.level === 'span' && !!r.spanId;
  // The span the result points to (any level), else its trace's AI root.
  const judged = useJudgedSpans([{ traceId: r.traceId, spanId: r.spanId }]);
  const io = r.traceId ? judged.byTrace.get(r.traceId) : undefined;
  const { loading, loaded, error } = judged;
  return (
    <div data-test-subj="agtEvlJudgeSaw">
      <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false}>
        <EuiFlexItem grow={false}>
          <SectionLabel>
            {i18n.translate('agentTraces.evals.flyout.judgeSaw', {
              defaultMessage: 'What the judge saw',
            })}
          </SectionLabel>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="xs" color="subdued" data-test-subj="agtEvlFlyoutJudged">
            {spanLevel ? (
              <span>
                {i18n.translate('agentTraces.evals.flyout.judgedSpan', {
                  defaultMessage: 'span',
                })}{' '}
                <strong>{io?.name ?? r.spanId}</strong>
              </span>
            ) : (
              i18n.translate('agentTraces.evals.flyout.wholeTraceAt', {
                defaultMessage: 'the whole trace ({span})',
                values: {
                  span:
                    io?.name ??
                    i18n.translate('agentTraces.evals.flyout.agentSpan', {
                      defaultMessage: 'agent span',
                    }),
                },
              })
            )}
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs">
            {r.traceId && openTrace && (
              <NewTabViewLink
                href={hrefOf?.(r)}
                onOpen={() => r.traceId && openTrace(r.traceId, r.time)}
                label={i18n.translate('agentTraces.evals.flyout.viewTrace', {
                  defaultMessage: 'View trace',
                })}
                testId="agtEvlFlyoutViewTrace"
              />
            )}
            {/* The trace is already open (in Agent Traces): its id, and a new tab icon. */}
            {r.traceId && !openTrace && (
              <>
                <span className="agtEvlMono agtEvlDim">{shortId(r.traceId)}</span>
                <NewTabLink r={r} />
              </>
            )}
            {r.judgeTraceId && (
              <>
                {' · '}
                <EuiLink onClick={onJudgeTrace} data-test-subj="agtEvlFlyoutJudgeTrace">
                  {i18n.translate('agentTraces.evals.flyout.viewJudgeTrace', {
                    defaultMessage: 'View judge trace',
                  })}
                </EuiLink>
              </>
            )}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
      {error ? (
        <QueryErrorCallout message={error} />
      ) : loading && !io ? (
        <EuiLoadingContent lines={2} />
      ) : loaded && !io ? (
        <EuiText size="xs" color="subdued" data-test-subj="agtEvlJudgedMissing">
          <p className="agtEvlBox">
            {i18n.translate('agentTraces.evals.flyout.judgedMissing', {
              defaultMessage:
                'The judged trace is not in the span index (another producer, or outside retention).',
            })}
          </p>
        </EuiText>
      ) : (
        <SpanIOView
          idPrefix={`agtEvlJudged-${r.id}`}
          testId="agtEvlJudgedIO"
          sections={[
            { key: 'input', label: INPUT_LABEL, value: io?.rawInput ?? io?.input },
            { key: 'output', label: OUTPUT_LABEL, value: io?.rawOutput ?? io?.output },
            ...(r.runId
              ? [
                  {
                    key: 'expected',
                    label: EXPECTED_LABEL,
                    note: expectedNote(r.expectedTruncated),
                    value: r.expected,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
};

/**
 * Offline: the case's other results in this run, and the same case in the run before (one
 * lookup of the runs in range, one query for the case's results in both runs).
 */
const CaseSection: React.FC<{
  r: EvalResult;
  openRun?: (runId: string) => void;
  openResult?: (r: EvalResult) => void;
  onCompareTraces: (
    traceA: string,
    traceB: string,
    versionA?: string,
    runA?: CompareRunRef
  ) => void;
}> = ({ r, openRun, openResult, onCompareTraces }) => {
  const { dataset, index, browseRange, refreshKey } = useEvalContext();
  const { runId, caseId } = r;
  const lookup = useRunBefore(runId, r.suiteName ?? null);
  const beforeId = lookup.before?.runId;
  const query =
    runId && caseId && lookup.loaded
      ? buildCaseResultsQuery(index, beforeId ? [runId, beforeId] : runId, caseId)
      : undefined;
  const { rows, loading, error } = usePplRows(dataset, query, browseRange, refreshKey);
  const results = useMemo(() => recordsToResults(rows), [rows]);
  if (error || lookup.error) return <QueryErrorCallout message={error ?? lookup.error ?? ''} />;
  if ((loading || !lookup.loaded) && !results.length) return <EuiLoadingContent lines={2} />;
  const siblings = results.filter((x) => x.runId === runId && !sameResult(x, r));
  const prev = beforeId ? results.filter((x) => x.runId === beforeId) : [];
  const status = caseStatusOf(tallyOf([r, ...siblings]));
  const prevStatus = prev.length ? caseStatusOf(tallyOf(prev)) : undefined;
  const prevTrace = prev.find((x) => x.traceId)?.traceId;
  return (
    <EuiPanel paddingSize="s" hasShadow={false} hasBorder data-test-subj="agtEvlFlyoutCase">
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem>
          <EuiTitle size="xxs">
            <h4>
              {i18n.translate('agentTraces.evals.flyout.caseTitle', { defaultMessage: 'Case' })}{' '}
              <span className="agtEvlDim">
                {r.caseName ?? caseId} · <span className="agtEvlMono">{caseId}</span>
              </span>
            </h4>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <VerdictBadge verdict={status} />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="xs" />
      {siblings.length ? (
        siblings.map((x) => (
          <div className="agtEvlCaseResults__row agtEvlCaseResults__row--compact" key={x.id}>
            {openResult ? (
              <EuiLink onClick={() => openResult(x)}>{x.name}</EuiLink>
            ) : (
              <strong>{x.name}</strong>
            )}
            <span>
              <VerdictBadge verdict={x.verdict} />
            </span>
            <span className="agtEvlDim">{x.explanation ?? x.errorType ?? scoreOrLabel(x)}</span>
          </div>
        ))
      ) : (
        <EuiText size="xs" color="subdued">
          {i18n.translate('agentTraces.evals.flyout.noSiblings', {
            defaultMessage: 'No other results for this case.',
          })}
        </EuiText>
      )}
      {beforeId && (
        <EuiText size="xs" data-test-subj="agtEvlFlyoutRunBefore">
          <p>
            {i18n.translate('agentTraces.evals.flyout.runBefore', {
              defaultMessage: 'In the run before',
            })}{' '}
            (
            {openRun ? (
              <EuiLink className="agtEvlMono" onClick={() => openRun(beforeId)}>
                {shortId(beforeId)}
              </EuiLink>
            ) : (
              <span className="agtEvlMono">{shortId(beforeId)}</span>
            )}
            {prev[0]?.agentVersion ? `, ${prev[0].agentVersion}` : ''}):{' '}
            {prevStatus ? (
              <>
                <VerdictBadge verdict={prevStatus} /> → <VerdictBadge verdict={status} />
              </>
            ) : (
              <span className="agtEvlDim">
                {i18n.translate('agentTraces.evals.flyout.notInRunBefore', {
                  defaultMessage: 'not in that run',
                })}
              </span>
            )}
            {prevTrace && r.traceId && (
              <>
                {' · '}
                <EuiLink
                  onClick={() =>
                    r.traceId &&
                    onCompareTraces(prevTrace, r.traceId, prev[0]?.agentVersion, {
                      runId: beforeId,
                      name: prev[0]?.runName,
                      description: prev[0]?.runDescription,
                    })
                  }
                  data-test-subj="agtEvlFlyoutCompareTraces"
                >
                  {i18n.translate('agentTraces.evals.flyout.compareTraces', {
                    defaultMessage: 'Compare traces',
                  })}
                </EuiLink>
              </>
            )}
          </p>
        </EuiText>
      )}
    </EuiPanel>
  );
};

/** PPL records (column per field) as trace hits. */
const recordsToHits = (records: PplRecord[]) => {
  const names = [...new Set(records.flatMap((r) => Object.keys(r)))];
  return transformPPLDataToTraceHits({
    schema: names.map((name) => ({ name, type: '', values: [] })),
    datarows: records.map((r) => names.map((n) => r[n])),
  });
};

/** The judge's own trace: spans, prompt and response. One query (head 200), when opened. */
export const JudgeTraceView: React.FC<{ traceId: string; result: EvalResult }> = ({
  traceId,
  result,
}) => {
  const { spans, refreshKey } = useEvalContext();
  const { rows, loading, loaded, error } = usePplRows(
    spans,
    buildOneTraceSpansQuery(spans.title, traceId),
    undefined,
    refreshKey
  );
  const view = useMemo(() => {
    const timezone = getEvalTimezone();
    const tree = buildFullSpanTree(hitsToAgentSpans(recordsToHits(rows)), (ts) =>
      formatTimestamp(ts, timezone)
    );
    const flat = flattenSpans(tree);
    const all: BaseRow[] = [];
    const walk = (list: BaseRow[]) =>
      list.forEach((x) => {
        all.push(x);
        if (x.children?.length) walk(x.children);
      });
    walk(tree);
    const raw = (x: BaseRow) => x.rawDocument as Record<string, unknown> | undefined;
    const llm =
      all.find((x) => str(readAttribute(raw(x), 'gen_ai.operation.name')) === 'chat') ??
      all.find((x) => readAttribute(raw(x), 'gen_ai.input.messages') !== undefined) ??
      all[0];
    const tokens = all.reduce(
      (sum, x) =>
        sum +
        (num(readAttribute(raw(x), 'gen_ai.usage.input_tokens')) ?? 0) +
        (num(readAttribute(raw(x), 'gen_ai.usage.output_tokens')) ?? 0),
      0
    );
    return {
      flat,
      tree: tree as TraceRow[],
      model: llm ? str(readAttribute(raw(llm), 'gen_ai.request.model')) : undefined,
      tokens,
      prompt: llm ? readAttribute(raw(llm), 'gen_ai.input.messages') : undefined,
      response: llm ? readAttribute(raw(llm), 'gen_ai.output.messages') : undefined,
    };
  }, [rows]);
  if (error) return <QueryErrorCallout message={error} />;
  if (loading || !loaded) return <EuiLoadingContent lines={6} />;
  if (!view.flat.length)
    return (
      <EuiText size="s" color="subdued" data-test-subj="agtEvlJudgeTraceMissing">
        <p>
          {i18n.translate('agentTraces.evals.judge.missing', {
            defaultMessage: 'The judge trace is not in the span index.',
          })}
        </p>
      </EuiText>
    );
  return (
    <div data-test-subj="agtEvlJudgeTrace">
      <EuiText size="xs" color="subdued">
        <p>
          {i18n.translate('agentTraces.evals.judge.sub', {
            defaultMessage: "The evaluator's own LLM call for {name}",
            values: { name: result.name },
          })}
          {view.model ? ` · ${view.model}` : ''} · {formatDuration(view.flat[0].durationMs)}
          {view.tokens
            ? ` · ${i18n.translate('agentTraces.evals.judge.tokens', {
                defaultMessage: '{n} tokens',
                values: { n: view.tokens.toLocaleString() },
              })}`
            : ''}
        </p>
      </EuiText>
      <SpanList
        side={{ traceId, spans: view.flat, tree: view.tree, results: [] }}
        only={new Set()}
      />
      <EuiSpacer size="s" />
      <SpanIOView
        idPrefix={`agtEvlJudge-${traceId}`}
        testId="agtEvlJudgeIO"
        sections={[
          {
            key: 'prompt',
            label: i18n.translate('agentTraces.evals.judge.prompt', {
              defaultMessage: 'Prompt sent to the judge',
            }),
            value: view.prompt,
          },
          {
            key: 'response',
            label: i18n.translate('agentTraces.evals.judge.response', {
              defaultMessage: 'Judge response',
            }),
            value: view.response,
          },
        ]}
      />
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued">
        <p>
          {i18n.translate('agentTraces.evals.judge.note', {
            defaultMessage:
              "Linked by opensearch.gen_ai.evaluation.judge.trace_id on the result. The judge's spans are ordinary spans in the span index; this view reads them only when opened.",
          })}
        </p>
      </EuiText>
    </div>
  );
};

/**
 * One result. The row that listed it holds the event; the flyout reads the judged span (one
 * query), offline the case's results in this run and the run before, and the judge trace only
 * when clicked.
 */
export const ResultFlyout: React.FC<{
  result: EvalResult;
  onClose: () => void;
  links?: ResultLinks;
  onOpenResult?: (r: EvalResult) => void;
}> = ({ result: r, onClose, links = {}, onOpenResult }) => {
  const [judge, setJudge] = useState(false);
  const [compare, setCompare] = useState<{
    a: string;
    b: string;
    versionA?: string;
    runA?: CompareRunRef;
  }>();
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
    online
      ? {
          title: i18n.translate('agentTraces.evals.flyout.source', { defaultMessage: 'Source' }),
          description: i18n.translate('agentTraces.evals.flyout.onlineSource', {
            defaultMessage: 'Online (live traffic)',
          }),
        }
      : {
          title: i18n.translate('agentTraces.evals.flyout.suiteRun', {
            defaultMessage: 'Test suite run',
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
                  className={r.runName ? undefined : 'agtEvlMono'}
                  title={r.runId}
                  onClick={() => r.runId && links.openRun?.(r.runId)}
                >
                  {r.runName ?? shortId(r.runId)}
                </EuiLink>
              ) : (
                <span className={r.runName ? undefined : 'agtEvlMono'} title={r.runId}>
                  {r.runName ?? shortId(r.runId)}
                </span>
              )}
            </span>
          ),
        },
    // This result's own CI run (`cicd.pipeline.run.url.full`), offline results that carry one.
    ...(!online && r.ciUrl
      ? [
          {
            title: i18n.translate('agentTraces.evals.flyout.ci', { defaultMessage: 'CI run' }),
            description: (
              <span data-test-subj="agtEvlFlyoutCi">
                <CiLink url={r.ciUrl} />
              </span>
            ),
          },
        ]
      : []),
  ];

  const header = judge ? (
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>
        <EuiButtonEmpty
          size="xs"
          iconType="arrowLeft"
          onClick={() => setJudge(false)}
          data-test-subj="agtEvlJudgeBack"
        >
          {i18n.translate('agentTraces.evals.flyout.back', { defaultMessage: 'Back' })}
        </EuiButtonEmpty>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiTitle size="s">
          <h2 id="agtEvlResultFlyoutTitle">
            {i18n.translate('agentTraces.evals.judge.title', { defaultMessage: 'Judge trace' })}{' '}
            <span className="agtEvlMono agtEvlDim agtEvlSmall">{shortId(r.judgeTraceId)}</span>
          </h2>
        </EuiTitle>
      </EuiFlexItem>
    </EuiFlexGroup>
  ) : (
    <>
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
    </>
  );

  return (
    <>
      <EuiFlyout
        onClose={onClose}
        size="m"
        ownFocus={false}
        maxWidth={720}
        aria-labelledby="agtEvlResultFlyoutTitle"
        data-test-subj="agtEvlResultFlyout"
      >
        <EuiFlyoutHeader hasBorder>{header}</EuiFlyoutHeader>
        <EuiFlyoutBody>
          {judge && r.judgeTraceId ? (
            <JudgeTraceView traceId={r.judgeTraceId} result={r} />
          ) : (
            <>
              <EuiPanel paddingSize="s" hasShadow={false} hasBorder className="agtEvlScore">
                <EuiTitle size="m">
                  <span data-test-subj="agtEvlFlyoutScore">
                    {r.value !== undefined ? formatScore(r.value) : scoreOrLabel(r)}
                    {r.scoreMax !== undefined && at !== undefined && (
                      <span className="agtEvlDim agtEvlSmall"> / {r.scoreMax}</span>
                    )}
                  </span>
                </EuiTitle>
                <EuiText size="xs" color="subdued">
                  <span>
                    {r.value !== undefined
                      ? i18n.translate('agentTraces.evals.flyout.score', {
                          defaultMessage: 'Score',
                        })
                      : i18n.translate('agentTraces.evals.flyout.labelTitle', {
                          defaultMessage: 'Label',
                        })}
                    {r.label && r.value !== undefined && (
                      <>
                        {' · '}
                        {i18n.translate('agentTraces.evals.flyout.label', {
                          defaultMessage: 'label',
                        })}{' '}
                        <code>{r.label}</code>
                      </>
                    )}
                    {r.judgeLabel && (
                      <span data-test-subj="agtEvlFlyoutJudgeLabel">
                        {' · '}
                        {i18n.translate('agentTraces.evals.flyout.judgeLabel', {
                          defaultMessage: 'Judge label',
                        })}{' '}
                        <code>{r.judgeLabel}</code>
                      </span>
                    )}
                    {r.errorType && (
                      <>
                        {' · '}
                        <code>{r.errorType}</code>
                      </>
                    )}
                  </span>
                </EuiText>
                {scoreScale(r) && (
                  <div className="agtEvlScoreBricksL" data-test-subj="agtEvlFlyoutScale">
                    <ScoreBricks r={r} showValue={false} />
                  </div>
                )}
              </EuiPanel>
              <EuiSpacer size="m" />
              {(r.evaluatorDescription ||
                r.judgeModel ||
                r.promptName ||
                r.promptVersion ||
                r.systemInstructions) && (
                <>
                  <JudgeContext r={r} />
                  <EuiSpacer size="m" />
                </>
              )}
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
              {r.level === 'session' ? (
                <SessionJudgedSection r={r} openSession={links.openSession} />
              ) : (
                <JudgedSection
                  r={r}
                  openTrace={links.openTrace}
                  onJudgeTrace={() => setJudge(true)}
                />
              )}
              <EuiSpacer size="m" />
              {r.runId && r.caseId && (
                <>
                  <CaseSection
                    r={r}
                    openRun={links.openRun}
                    openResult={onOpenResult}
                    onCompareTraces={(a, b, versionA, runA) => setCompare({ a, b, versionA, runA })}
                  />
                  <EuiSpacer size="m" />
                </>
              )}
              <EuiDescriptionList type="column" compressed listItems={items} />
              <EuiSpacer size="m" />
              {/* Built and highlighted only once open. */}
              <JsonAccordion
                id="agtEvlRawEvent"
                label={i18n.translate('agentTraces.evals.flyout.rawEvent', {
                  defaultMessage: 'Raw event',
                })}
                read={() => r.raw}
                overflowHeight={480}
                testId="agtEvlRawEvent"
              />
            </>
          )}
        </EuiFlyoutBody>
      </EuiFlyout>
      {compare && r.caseId && (
        <TraceCompareFlyout
          caseId={r.caseId}
          traceA={compare.a}
          traceB={compare.b}
          versionA={compare.versionA}
          versionB={r.agentVersion}
          runA={compare.runA}
          runB={{ runId: r.runId, name: r.runName, description: r.runDescription }}
          onClose={() => setCompare(undefined)}
        />
      )}
    </>
  );
};
