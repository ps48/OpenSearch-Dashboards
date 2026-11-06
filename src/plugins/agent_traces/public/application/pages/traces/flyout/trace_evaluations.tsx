/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './trace_evaluations.scss';

import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiCallOut,
  EuiLink,
  EuiLoadingContent,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../../../opensearch_dashboards_react/public';
import type { AgentTracesServices } from '../../../../types';
import { EvalResult, Tally, Verdict, tallyOf } from '../../../evaluations/eval_model';
import {
  DASH,
  TallyCell,
  VerdictBadge,
  formatScore,
  scoreOrLabel,
} from '../../../evaluations/eval_components';
import { JudgeMark } from '../../../evaluations/judge_mark';
import { ResultFlyout } from '../../../evaluations/result_flyout';
import { EvalContext, defaultEvalContext } from '../../../evaluations/eval_context';
import {
  useEvalsDataSource,
  useEvalsIndexPattern,
  useSpansIndexPattern,
} from '../../../evaluations/eval_dataset';
import {
  openInEvaluations,
  openSessionInAgentTraces,
  targetHref,
  targetOf,
} from '../../../evaluations/eval_links';
import { TraceEvaluations } from './use_trace_evaluations';
import { TraceFlyoutContext } from './trace_flyout_state';
import { useEvalTimezone } from '../../../evaluations/eval_time';

/** A span's results in the trace tree: the judge mark and a small tally. */
export const SpanEvalMark: React.FC<{ results?: EvalResult[] }> = ({ results }) => {
  if (!results || results.length === 0) return null;
  return (
    <span className="agtEvlSpanMark" data-test-subj="agentTracesSpanEvalMark">
      <JudgeMark results={results} />
      <TallyCell tally={tallyOf(results)} />
    </span>
  );
};

/** The trace's tally in the flyout header; opens the Evaluations tab. */
export const EvalHeaderSummary: React.FC<{ results: EvalResult[]; onClick: () => void }> = ({
  results,
  onClick,
}) => (
  <EuiLink onClick={onClick} data-test-subj="agentTracesFlyoutEvalsSummary">
    <TallyCell tally={tallyOf(results)} />
  </EuiLink>
);

/**
 * A table cell's tally (Agent Traces Evaluations column); opens the trace's Evaluations.
 * `outsideRuns`: on an agent-run row of a trace listed as several runs, how many of the trace's
 * results count toward none of its runs (on the trace or its shared root), shown as a hint.
 */
export const EvalTallyCell: React.FC<{
  tally?: Tally;
  onOpen?: () => void;
  outsideRuns?: number;
}> = ({ tally, onOpen, outsideRuns }) => {
  const hint = outsideRuns ? (
    <EuiToolTip
      content={i18n.translate('agentTraces.evaluations.outsideRunsTooltip', {
        defaultMessage:
          "{count, plural, one {# result is} other {# results are}} on the whole trace or its shared root, not on one agent run. The trace's Evaluations tab lists {count, plural, one {it} other {them}}.",
        values: { count: outsideRuns },
      })}
    >
      <EuiText
        size="xs"
        color="subdued"
        className="agtEvlOutsideRuns"
        data-test-subj="agentTracesEvalOutsideRuns"
      >
        {i18n.translate('agentTraces.evaluations.outsideRuns', {
          defaultMessage: '+{count} on trace',
          values: { count: outsideRuns },
        })}
      </EuiText>
    </EuiToolTip>
  ) : null;
  const own = !tally || tally.n === 0 ? <>{DASH}</> : <TallyCell tally={tally} />;
  const body = hint ? (
    <span className="agtEvlTallyWithHint">
      {own}
      {hint}
    </span>
  ) : (
    own
  );
  if ((!tally || tally.n === 0) && !hint) return body;
  return onOpen ? (
    <EuiLink
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onOpen();
      }}
      data-test-subj="agentTracesEvalTally"
    >
      {body}
    </EuiLink>
  ) : (
    body
  );
};

/** Trace Map marks for a span's results: the judge mark, a red outline when one failed. */
export const flowEvalDecoration = (
  results: EvalResult[] | undefined
): { className?: string; badge?: React.ReactNode } | undefined => {
  if (!results || results.length === 0) return undefined;
  const failed = results.some((r) => r.verdict === 'fail');
  return {
    className: failed ? 'agtEvlFlowNode agtEvlFlowNode--fail' : 'agtEvlFlowNode',
    badge: (
      <span className="agtEvlFlowMark" data-test-subj="agentTracesFlowEvalMark">
        <JudgeMark results={results} />
        <TallyCell tally={tallyOf(results)} />
      </span>
    ),
  };
};

/** One result in the span detail panel. */
export const EvalResultItem: React.FC<{ result: EvalResult; onOpen?: () => void }> = ({
  result: r,
  onOpen,
}) => (
  <div className="agtEvlCaseResults__row agtEvlCaseResults__row--compact">
    {onOpen ? <EuiLink onClick={onOpen}>{r.name}</EuiLink> : <strong>{r.name}</strong>}
    <span>
      <VerdictBadge verdict={r.verdict} />
    </span>
    <span className="agtEvlDim">{r.explanation ?? r.errorType ?? formatScore(r.value)}</span>
  </div>
);

/** The result flyout over the trace flyout, with links into Agent Evaluations. */
export const TraceResultFlyout: React.FC<{ result: EvalResult; onClose: () => void }> = ({
  result,
  onClose,
}) => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const application = services.application;
  const index = useEvalsIndexPattern();
  const spansIndex = useSpansIndexPattern();
  const dataSource = useEvalsDataSource();
  useEvalTimezone(services.uiSettings);
  const traceFlyout = useContext(TraceFlyoutContext);
  const [shown, setShown] = useState(result);
  useEffect(() => setShown(result), [result]);
  // The flyout's lazy reads (judged span, case, judge trace) use the evaluations and span
  // indices of Agent Traces, from the start of the range to now (results land after traces).
  const context = useMemo(() => {
    const ctx = defaultEvalContext(index ?? 'otel-v1-genai-evaluation-*', spansIndex, dataSource);
    const timefilter = services.data?.query.timefilter.timefilter;
    const from = timefilter?.calculateBounds(timefilter.getTime()).min?.toISOString();
    const hrefOf = (r: EvalResult) => {
      const target = targetOf(r);
      return target && application?.getUrlForApp
        ? targetHref(application, target, r.time)
        : undefined;
    };
    if (!from) return { ...ctx, hrefOf };
    const range = { from, to: new Date().toISOString() };
    return { ...ctx, timeRange: range, browseRange: range, hrefOf };
  }, [index, spansIndex, services.data, application, dataSource]);
  return (
    <EvalContext.Provider value={context}>
      <ResultFlyout
        key={shown.id}
        result={shown}
        onClose={onClose}
        onOpenResult={setShown}
        links={{
          openSuite: (suite) => openInEvaluations(application, { page: 'suite', suite }),
          openRun: (runId) => openInEvaluations(application, { page: 'run', runId }),
          // Inside Agent Traces the session opens in its flyout; elsewhere through a link.
          openSession: (sessionId, aroundMs) => {
            if (traceFlyout) {
              onClose();
              traceFlyout.openSession(sessionId);
            } else openSessionInAgentTraces(application, sessionId, aroundMs);
          },
        }}
      />
    </EvalContext.Provider>
  );
};

/** The trace flyout's Evaluations tab: every result of the trace; one opens its flyout. */
export const TraceEvaluationsTab: React.FC<{
  evals: TraceEvaluations;
  spanLabelOf?: (spanId: string) => string | undefined;
}> = ({ evals, spanLabelOf }) => {
  const [open, setOpen] = useState<EvalResult>();
  if (evals.isLoading) return <EuiLoadingContent lines={4} />;
  if (evals.error) {
    return (
      <EuiCallOut color="danger" size="s" iconType="alert" title={evals.error}>
        {null}
      </EuiCallOut>
    );
  }
  if (evals.results.length === 0) {
    return (
      <EuiText size="s" color="subdued" className="agtEvlTraceEvals">
        <p>
          {i18n.translate('agentTraces.flyout.noEvaluations', {
            defaultMessage: 'No evaluations for this trace.',
          })}
        </p>
      </EuiText>
    );
  }
  const columns: Array<EuiBasicTableColumn<EvalResult>> = [
    {
      field: 'name',
      name: i18n.translate('agentTraces.flyout.evalEvaluation', { defaultMessage: 'Evaluation' }),
      render: (n: string) => <strong>{n}</strong>,
    },
    {
      field: 'level',
      name: i18n.translate('agentTraces.flyout.evalJudged', { defaultMessage: 'Judged' }),
      render: (_: unknown, r: EvalResult) =>
        r.level === 'span' && r.spanId ? (
          <span className="agtEvlDim">{spanLabelOf?.(r.spanId) ?? r.level}</span>
        ) : (
          <span className="agtEvlDim">{r.level}</span>
        ),
    },
    {
      field: 'verdict',
      name: i18n.translate('agentTraces.flyout.evalVerdict', { defaultMessage: 'Verdict' }),
      render: (v: Verdict) => <VerdictBadge verdict={v} />,
    },
    {
      field: 'value',
      name: i18n.translate('agentTraces.flyout.evalScore', { defaultMessage: 'Score' }),
      align: 'right',
      render: (_: unknown, r: EvalResult) => <span className="agtEvlMono">{scoreOrLabel(r)}</span>,
    },
    {
      field: 'explanation',
      name: i18n.translate('agentTraces.flyout.evalExplanation', {
        defaultMessage: 'Explanation',
      }),
      render: (e?: string) => (
        <span className="agtEvlDim agtEvlTrunc" title={e}>
          {e ?? DASH}
        </span>
      ),
    },
  ];
  return (
    <div className="agtEvlTraceEvals" data-test-subj="agentTracesEvaluationsTab">
      <EuiBasicTable<EvalResult>
        items={evals.results}
        itemId="id"
        columns={columns}
        rowProps={(r: EvalResult) => ({
          className: 'agtEvlClickRow',
          onClick: () => setOpen(r),
          'data-test-subj': `agentTracesEvalRow-${r.name}`,
        })}
      />
      {open && <TraceResultFlyout result={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
};
