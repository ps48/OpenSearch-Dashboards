/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import moment from 'moment-timezone';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButtonGroup,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiIcon,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { DataPublicPluginStart } from '../../../../data/public';
import { PplRecord, pplResponseToRecords, withoutTimeRange } from '../pages/sessions/session_utils';
import {
  EvalResult,
  buildTraceEvalsQuery,
  createEvalsPplService,
  evalsDataset,
  recordToEvalResult,
} from './eval_data';
import { TRACE_SPANS_LIMIT, buildTraceSpansQuery, spansDataset } from './eval_target';
import {
  AlignedStep,
  StepDiff,
  StepMark,
  TraceStep,
  TraceTotals,
  alignSteps,
  spansToSteps,
  stepMarks,
  summarizeDiff,
  traceTotals,
} from './trace_compare';
import { TraceFlowView, NodeDecoration } from '../pages/traces/flow/trace_flow_view';
import {
  TraceRow,
  buildFullSpanTree,
  formatTimestamp,
  hitsToAgentSpans,
} from '../pages/traces/hooks/tree_utils';
import { transformPPLDataToTraceHits } from '../pages/traces/trace_details/traces/ppl_to_trace_hits';
import type { CategorizedSpan } from '../../services/span_categorization';
import {
  OutcomeBadge,
  QueryErrorCallout,
  formatCount,
  formatDuration,
  formatTokens,
  shortId,
} from './eval_components';
import { useEvalsIndexPattern, useSpansIndexPattern } from './eval_dataset';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { errorMessage } from './use_eval_data';
import type { EvaluationsServices } from '.';

export interface TraceCompareSide {
  /** Display label, e.g. the run id. */
  label: string;
  traceId: string;
  /** Time to center the trace deep link on. */
  aroundMs: number;
}

interface SideData {
  rows: PplRecord[];
  /** The span tree, as the trace flyout builds it (for the graph view). */
  tree: TraceRow[];
  steps: TraceStep[];
  totals: TraceTotals;
  grades: EvalResult[];
}

interface CompareState {
  loading: boolean;
  error?: string;
  baseline?: SideData;
  candidate?: SideData;
}

const fetchSide = async (
  data: DataPublicPluginStart,
  index: string,
  spansIndex: string,
  traceId: string,
  signal: AbortSignal
): Promise<SideData> => {
  const ppl = createEvalsPplService(data, undefined, signal);
  const [spans, grades] = await Promise.all([
    ppl.executeQuery(
      spansDataset(spansIndex),
      buildTraceSpansQuery(traceId, TRACE_SPANS_LIMIT, spansIndex)
    ),
    // Grades are optional: a missing evaluation index leaves the grades empty.
    ppl
      .executeQuery(
        withoutTimeRange(evalsDataset(index)),
        buildTraceEvalsQuery(traceId, undefined, 200, index)
      )
      .catch(() => undefined),
  ]);
  const rows = pplResponseToRecords(spans);
  const steps = spansToSteps(rows);
  const timezone = moment.tz.guess();
  return {
    rows,
    tree: buildFullSpanTree(hitsToAgentSpans(transformPPLDataToTraceHits(spans)), (ts) =>
      formatTimestamp(ts, timezone)
    ) as TraceRow[],
    steps,
    totals: traceTotals(steps, rows),
    grades: grades ? pplResponseToRecords(grades).map(recordToEvalResult) : [],
  };
};

/** Spans and grades of both traces, fetched once per pair. */
export const useTraceCompare = (baselineTraceId: string, candidateTraceId: string) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  // Shown on the Evaluations page, where the dataset is already loaded.
  const index = useEvalsIndexPattern() ?? AGENT_EVALS_INDEX_PATTERN;
  // Spans from the config's traces dataset, else the default span index.
  const spansIndex = useSpansIndexPattern();
  const [state, setState] = useState<CompareState>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    Promise.all([
      fetchSide(services.data, index, spansIndex, baselineTraceId, controller.signal),
      fetchSide(services.data, index, spansIndex, candidateTraceId, controller.signal),
    ])
      .then(([baseline, candidate]) => {
        if (!controller.signal.aborted) setState({ loading: false, baseline, candidate });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ loading: false, error: errorMessage(e) });
      });
    return () => controller.abort();
  }, [services.data, index, spansIndex, baselineTraceId, candidateTraceId]);
  return state;
};

const DIFF_TEXT: Record<StepDiff, string> = {
  same: i18n.translate('agentTraces.evalsPage.diffSame', { defaultMessage: 'Same' }),
  args: i18n.translate('agentTraces.evalsPage.diffArgs', { defaultMessage: 'Other arguments' }),
  changed: i18n.translate('agentTraces.evalsPage.diffChanged', { defaultMessage: 'Other step' }),
  error: i18n.translate('agentTraces.evalsPage.diffError', { defaultMessage: 'Error' }),
  baseline_only: i18n.translate('agentTraces.evalsPage.diffBaselineOnly', {
    defaultMessage: 'Only in baseline',
  }),
  candidate_only: i18n.translate('agentTraces.evalsPage.diffCandidateOnly', {
    defaultMessage: 'Only in candidate',
  }),
};

const DIFF_COLOR: Record<StepDiff, string> = {
  same: 'hollow',
  args: 'warning',
  changed: 'warning',
  error: 'danger',
  baseline_only: 'default',
  candidate_only: 'primary',
};

const KIND_ICON: Record<TraceStep['kind'], string> = {
  agent: 'user',
  llm: 'compute',
  tool: 'wrench',
  other: 'dot',
};

const KIND_TEXT: Record<TraceStep['kind'], string> = {
  agent: i18n.translate('agentTraces.evalsPage.stepAgent', { defaultMessage: 'Agent' }),
  llm: i18n.translate('agentTraces.evalsPage.stepLlm', { defaultMessage: 'Model call' }),
  tool: i18n.translate('agentTraces.evalsPage.stepTool', { defaultMessage: 'Tool call' }),
  other: i18n.translate('agentTraces.evalsPage.stepOther', { defaultMessage: 'Span' }),
};

const Preview: React.FC<{ label: string; text?: string; testSubj: string }> = ({
  label,
  text,
  testSubj,
}) =>
  text ? (
    <EuiText size="xs" className="agtEvlStep__preview" data-test-subj={testSubj}>
      <span className="agtEvlStep__previewLabel">{label}</span>{' '}
      <span className="agtEvlMono" title={text}>
        {text.length > 160 ? `${text.slice(0, 157)}...` : text}
      </span>
    </EuiText>
  ) : null;

const StepCell: React.FC<{ step?: TraceStep; side: 'baseline' | 'candidate' }> = ({
  step,
  side,
}) => {
  if (!step) {
    return (
      <div className="agtEvlStep__cell agtEvlStep__cell--empty">
        <EuiText size="xs" color="subdued">
          {i18n.translate('agentTraces.evalsPage.stepMissing', { defaultMessage: 'No step' })}
        </EuiText>
      </div>
    );
  }
  const tokens =
    step.inputTokens !== undefined || step.outputTokens !== undefined
      ? i18n.translate('agentTraces.evalsPage.stepTokens', {
          defaultMessage: '{input} in, {output} out',
          values: {
            input: formatTokens(step.inputTokens),
            output: formatTokens(step.outputTokens),
          },
        })
      : undefined;
  return (
    <div className="agtEvlStep__cell" data-test-subj={`agtEvlStep-${side}`}>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiToolTip content={KIND_TEXT[step.kind]}>
            <EuiIcon type={KIND_ICON[step.kind]} size="s" aria-label={KIND_TEXT[step.kind]} />
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem grow={false} style={{ minWidth: 0 }}>
          <EuiText size="xs" className="eui-textTruncate">
            <strong title={step.name}>{step.name}</strong>
          </EuiText>
        </EuiFlexItem>
        {step.error && (
          <EuiFlexItem grow={false}>
            <EuiBadge color="danger" iconType="alert">
              {step.error}
            </EuiBadge>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
      <EuiText size="xs" color="subdued">
        {[step.kind === 'agent' ? step.model : undefined, tokens, formatDuration(step.durationMs)]
          .filter((v) => v && v !== '-')
          .join(' · ')}
      </EuiText>
      <Preview
        label={i18n.translate('agentTraces.evalsPage.stepArgs', { defaultMessage: 'args' })}
        text={step.args}
        testSubj={`agtEvlStepArgs-${side}`}
      />
      <Preview
        label={i18n.translate('agentTraces.evalsPage.stepResult', { defaultMessage: 'result' })}
        text={step.result}
        testSubj={`agtEvlStepResult-${side}`}
      />
    </div>
  );
};

interface TotalsRow {
  metric: string;
  baseline: string;
  candidate: string;
  delta?: string;
  worse?: boolean;
}

const deltaOf = (
  a: number | undefined,
  b: number | undefined,
  format: (n: number) => string,
  lowerIsBetter = true
): Pick<TotalsRow, 'delta' | 'worse'> => {
  if (a === undefined || b === undefined || a === b) return {};
  const d = b - a;
  return {
    delta: `${d > 0 ? '+' : '-'}${format(Math.abs(d))}`,
    worse: lowerIsBetter ? d > 0 : d < 0,
  };
};

const totalsRows = (a: TraceTotals, b: TraceTotals): TotalsRow[] => [
  {
    metric: i18n.translate('agentTraces.evalsPage.totalSteps', { defaultMessage: 'Steps' }),
    baseline: formatCount(a.steps),
    candidate: formatCount(b.steps),
    ...deltaOf(a.steps, b.steps, formatCount),
  },
  {
    metric: i18n.translate('agentTraces.evalsPage.totalLlm', { defaultMessage: 'Model calls' }),
    baseline: formatCount(a.llmCalls),
    candidate: formatCount(b.llmCalls),
    ...deltaOf(a.llmCalls, b.llmCalls, formatCount),
  },
  {
    metric: i18n.translate('agentTraces.evalsPage.totalTools', { defaultMessage: 'Tool calls' }),
    baseline: formatCount(a.toolCalls),
    candidate: formatCount(b.toolCalls),
    ...deltaOf(a.toolCalls, b.toolCalls, formatCount),
  },
  {
    metric: i18n.translate('agentTraces.evalsPage.totalTokens', { defaultMessage: 'Tokens' }),
    baseline: formatTokens(a.tokens),
    candidate: formatTokens(b.tokens),
    ...deltaOf(a.tokens, b.tokens, formatTokens),
  },
  {
    metric: i18n.translate('agentTraces.evalsPage.totalLatency', { defaultMessage: 'Latency' }),
    baseline: formatDuration(a.latencyMs),
    candidate: formatDuration(b.latencyMs),
    ...deltaOf(a.latencyMs, b.latencyMs, formatDuration),
  },
  {
    metric: i18n.translate('agentTraces.evalsPage.totalErrors', { defaultMessage: 'Errors' }),
    baseline: formatCount(a.errors),
    candidate: formatCount(b.errors),
    ...deltaOf(a.errors, b.errors, formatCount),
  },
];

interface GradeRow {
  name: string;
  baseline?: EvalResult;
  candidate?: EvalResult;
}

/** The latest grade per evaluation name on each side, aligned by name. */
export const alignGrades = (baseline: EvalResult[], candidate: EvalResult[]): GradeRow[] => {
  const latest = (list: EvalResult[]) => {
    const byName = new Map<string, EvalResult>();
    list.forEach((r) => {
      const seen = byName.get(r.name);
      if (!seen || r.time > seen.time) byName.set(r.name, r);
    });
    return byName;
  };
  const a = latest(baseline);
  const b = latest(candidate);
  return Array.from(new Set([...a.keys(), ...b.keys()]))
    .sort()
    .map((name) => ({ name, baseline: a.get(name), candidate: b.get(name) }));
};

const GradeCell: React.FC<{ result?: EvalResult }> = ({ result }) =>
  result ? (
    <div>
      <OutcomeBadge result={result} />
      {result.explanation && (
        <EuiText size="xs" color="subdued" className="agtEvlExplanation">
          {result.explanation}
        </EuiText>
      )}
    </div>
  ) : (
    <EuiText size="xs" color="subdued">
      -
    </EuiText>
  );

const SideHeader: React.FC<{
  title: string;
  side: TraceCompareSide;
  testSubj: string;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}> = ({ title, side, testSubj, onOpenTrace }) => (
  <EuiPanel hasBorder paddingSize="s">
    <EuiText size="xs" color="subdued">
      {title}
    </EuiText>
    <EuiText size="s" className="eui-textTruncate">
      <strong title={side.label}>{side.label}</strong>
    </EuiText>
    <EuiLink onClick={() => onOpenTrace(side.traceId, side.aroundMs)} data-test-subj={testSubj}>
      <EuiText size="xs">
        {i18n.translate('agentTraces.evalsPage.openAgentTrace', {
          defaultMessage: 'Open trace {id}',
          values: { id: shortId(side.traceId) },
        })}
      </EuiText>
    </EuiLink>
  </EuiPanel>
);

/** The aligned steps of both traces, with differences highlighted. */
export const StepsComparison: React.FC<{
  aligned: AlignedStep[];
  onlyDifferences: boolean;
  /** Position of the first row (a single step shown from the graph). */
  firstPosition?: number;
}> = ({ aligned, onlyDifferences, firstPosition = 1 }) => {
  const rows = aligned
    .map((row, i) => ({ row, position: i + firstPosition }))
    .filter(({ row }) => !onlyDifferences || row.diff !== 'same');
  if (rows.length === 0) {
    return (
      <EuiText size="s" color="subdued" data-test-subj="agtEvlStepsNoDiff">
        {i18n.translate('agentTraces.evalsPage.stepsNoDiff', {
          defaultMessage: 'Both traces ran the same steps.',
        })}
      </EuiText>
    );
  }
  return (
    <div className="agtEvlSteps" data-test-subj="agtEvlStepsComparison" role="table">
      {rows.map(({ row, position }) => (
        <div
          key={position}
          className={`agtEvlSteps__row agtEvlSteps__row--${row.diff}`}
          data-test-subj={`agtEvlStepRow-${row.diff}`}
          role="row"
        >
          <EuiText size="xs" color="subdued" className="agtEvlSteps__pos">
            {position}
          </EuiText>
          <StepCell step={row.baseline} side="baseline" />
          <div className="agtEvlSteps__diff">
            {row.diff !== 'same' && (
              <EuiBadge color={DIFF_COLOR[row.diff]}>{DIFF_TEXT[row.diff]}</EuiBadge>
            )}
          </div>
          <StepCell step={row.candidate} side="candidate" />
        </div>
      ))}
    </div>
  );
};

type CompareView = 'steps' | 'graph';
const VIEW_KEY = 'agentTraces:traceCompareView';

/** Steps or Graph, kept for the browser session (Steps by default). */
export const useCompareView = (): [CompareView, (view: CompareView) => void] => {
  const [view, setView] = useState<CompareView>(() => {
    try {
      return window.sessionStorage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'steps';
    } catch {
      return 'steps';
    }
  });
  const set = useCallback((next: CompareView) => {
    try {
      window.sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // storage unavailable: keep it for this flyout only
    }
    setView(next);
  }, []);
  return [view, set];
};

const MARK_TEXT: Partial<Record<StepDiff, string>> = {
  baseline_only: i18n.translate('agentTraces.evalsPage.markOnlyHere', {
    defaultMessage: 'Only here',
  }),
  candidate_only: i18n.translate('agentTraces.evalsPage.markOnlyHere', {
    defaultMessage: 'Only here',
  }),
  changed: i18n.translate('agentTraces.evalsPage.markChanged', { defaultMessage: 'Changed' }),
  args: i18n.translate('agentTraces.evalsPage.markArgs', { defaultMessage: 'Other arguments' }),
  error: i18n.translate('agentTraces.evalsPage.markError', { defaultMessage: 'Error' }),
};

/** Mark hues: accents that carry no verdict (not success, danger or warning). */
const ONLY_COLOR = '#9170B8';
const CHANGED_COLOR = '#6092C0';

const markClass = (diff: StepDiff) =>
  diff === 'baseline_only' || diff === 'candidate_only'
    ? 'agtEvlGraphNode--only'
    : diff === 'same'
      ? ''
      : 'agtEvlGraphNode--changed';

/** How a step's node is marked on its side's map: its difference, and the selection. */
export const decorationOf = (
  mark: StepMark | undefined,
  selected: number | undefined
): NodeDecoration | undefined => {
  if (!mark) return undefined;
  const isSelected = mark.index === selected;
  const text = MARK_TEXT[mark.diff];
  if (!text && !isSelected) return undefined;
  return {
    className: `agtEvlGraphNode ${markClass(mark.diff)} ${
      isSelected ? 'agtEvlGraphNode--selected' : ''
    }`,
    badge: text ? (
      <EuiBadge
        color={mark.diff.endsWith('_only') ? ONLY_COLOR : CHANGED_COLOR}
        data-test-subj={`agtEvlGraphMark-${mark.diff}`}
      >
        {text}
      </EuiBadge>
    ) : undefined,
  };
};

/**
 * Both traces as the node map Agent Traces draws, side by side, with steps that are only on
 * one side or differ marked. Selecting a step selects its match on the other side and shows
 * the aligned pair below.
 */
export const GraphComparison: React.FC<{
  baseline: TraceRow[];
  candidate: TraceRow[];
  aligned: AlignedStep[];
  baselineTitle: string;
  candidateTitle: string;
}> = ({ baseline, candidate, aligned, baselineTitle, candidateTitle }) => {
  const marks = useMemo(() => stepMarks(aligned), [aligned]);
  const [selected, setSelected] = useState<number | undefined>();
  const decorateBaseline = useCallback(
    (span: CategorizedSpan) => decorationOf(marks.baseline.get(span.spanId), selected),
    [marks, selected]
  );
  const decorateCandidate = useCallback(
    (span: CategorizedSpan) => decorationOf(marks.candidate.get(span.spanId), selected),
    [marks, selected]
  );
  const selectBaseline = useCallback(
    (span: TraceRow | null) => {
      // The map also reports a click on its background as null (it reaches the pane
      // around the nodes): keep the selection, like the trace flyout does.
      const mark = span ? marks.baseline.get(span.spanId) : undefined;
      if (mark) setSelected(mark.index);
    },
    [marks]
  );
  const selectCandidate = useCallback(
    (span: TraceRow | null) => {
      // The map also reports a click on its background as null (it reaches the pane
      // around the nodes): keep the selection, like the trace flyout does.
      const mark = span ? marks.candidate.get(span.spanId) : undefined;
      if (mark) setSelected(mark.index);
    },
    [marks]
  );
  const row = selected !== undefined ? aligned[selected] : undefined;
  return (
    <div data-test-subj="agtEvlGraphComparison">
      <EuiFlexGroup gutterSize="s" responsive={false} wrap data-test-subj="agtEvlGraphLegend">
        <EuiFlexItem grow={false}>
          <EuiBadge color={ONLY_COLOR}>{MARK_TEXT.baseline_only}</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.legendOnly', {
              defaultMessage: 'a step the other trace does not have',
            })}
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiBadge color={CHANGED_COLOR}>{MARK_TEXT.changed}</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.legendChanged', {
              defaultMessage: 'another step, other arguments or an error at the same position',
            })}
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <span className="agtEvlGraphLegend__selected" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('agentTraces.evalsPage.legendSelected', {
              defaultMessage: 'the selected step and its match',
            })}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiFlexGroup gutterSize="s" responsive={false}>
        {[
          {
            id: 'baseline',
            title: baselineTitle,
            tree: baseline,
            decorate: decorateBaseline,
            onSelect: selectBaseline,
          },
          {
            id: 'candidate',
            title: candidateTitle,
            tree: candidate,
            decorate: decorateCandidate,
            onSelect: selectCandidate,
          },
        ].map((side) => (
          <EuiFlexItem key={side.id} style={{ minWidth: 0 }}>
            <EuiText size="xs">
              <strong>{side.title}</strong>
            </EuiText>
            <EuiSpacer size="xs" />
            <EuiPanel
              hasBorder
              paddingSize="none"
              className="agtEvlGraphPanel"
              data-test-subj={`agtEvlGraph-${side.id}`}
            >
              <TraceFlowView
                spanTree={side.tree}
                totalDuration={0}
                selectedSpan={null}
                onSelectSpan={side.onSelect}
                decorateNode={side.decorate}
                showMinimap={false}
              />
            </EuiPanel>
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {row && selected !== undefined ? (
        <StepsComparison aligned={[row]} onlyDifferences={false} firstPosition={selected + 1} />
      ) : (
        <EuiText size="xs" color="subdued" data-test-subj="agtEvlGraphHint">
          {i18n.translate('agentTraces.evalsPage.graphHint', {
            defaultMessage: 'Select a step on either map to see it next to its match.',
          })}
        </EuiText>
      )}
    </div>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EuiTitle size="xxs">
    <h3>{children}</h3>
  </EuiTitle>
);

/**
 * The same test case's agent trace in two runs, side by side: steps aligned in order with
 * differences highlighted (another tool, other arguments, extra or missing steps, errors),
 * totals, and each run's grades with their explanations. Read-only.
 */
export const TraceCompareFlyout: React.FC<{
  caseName?: string;
  baseline: TraceCompareSide;
  candidate: TraceCompareSide;
  onClose: () => void;
  /** Back to the view that opened it (the test case flyout). */
  onBack?: () => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}> = ({ caseName, baseline, candidate, onClose, onBack, onOpenTrace }) => {
  const state = useTraceCompare(baseline.traceId, candidate.traceId);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [view, setView] = useCompareView();
  const aligned = useMemo(
    () =>
      state.baseline && state.candidate
        ? alignSteps(state.baseline.steps, state.candidate.steps)
        : [],
    [state.baseline, state.candidate]
  );
  const summary = useMemo(
    () =>
      state.baseline && state.candidate
        ? summarizeDiff(aligned, state.baseline.steps, state.candidate.steps)
        : undefined,
    [aligned, state.baseline, state.candidate]
  );
  const grades = useMemo(
    () => alignGrades(state.baseline?.grades ?? [], state.candidate?.grades ?? []),
    [state.baseline, state.candidate]
  );
  const baselineTitle = i18n.translate('agentTraces.evalsPage.baseline', {
    defaultMessage: 'Baseline',
  });
  const candidateTitle = i18n.translate('agentTraces.evalsPage.candidate', {
    defaultMessage: 'Candidate',
  });
  const differing = summary
    ? summary.counts.args +
      summary.counts.changed +
      summary.counts.error +
      summary.counts.baseline_only +
      summary.counts.candidate_only
    : 0;

  const body = () => {
    if (state.loading) return <EuiLoadingContent lines={8} />;
    if (state.error) {
      return (
        <QueryErrorCallout
          message={state.error}
          title={i18n.translate('agentTraces.evalsPage.traceCompareError', {
            defaultMessage: 'Could not load the traces',
          })}
        />
      );
    }
    if (!state.baseline || !state.candidate || !summary) return null;
    if (state.baseline.rows.length === 0 || state.candidate.rows.length === 0) {
      return (
        <EuiCallOut
          size="s"
          color="warning"
          iconType="alert"
          data-test-subj="agtEvlTraceCompareMissing"
          title={i18n.translate('agentTraces.evalsPage.traceCompareMissing', {
            defaultMessage: 'No spans found for {which} trace. The spans may have expired.',
            values: {
              which: state.baseline.rows.length === 0 ? baselineTitle : candidateTitle,
            },
          })}
        />
      );
    }
    return (
      <>
        <EuiFlexGroup
          gutterSize="s"
          wrap
          responsive={false}
          data-test-subj="agtEvlTraceDiffSummary"
        >
          <EuiFlexItem grow={false}>
            <EuiBadge color={differing ? 'warning' : 'hollow'}>
              {i18n.translate('agentTraces.evalsPage.stepsDiffer', {
                defaultMessage:
                  '{count, plural, =0 {Same steps} one {# step differs} other {# steps differ}}',
                values: { count: differing },
              })}
            </EuiBadge>
          </EuiFlexItem>
          {summary.toolsOnlyInBaseline.map((tool) => (
            <EuiFlexItem grow={false} key={`b-${tool}`}>
              <EuiBadge color="default" data-test-subj="agtEvlToolOnlyBaseline">
                {i18n.translate('agentTraces.evalsPage.toolOnlyBaseline', {
                  defaultMessage: '{tool} only in baseline',
                  values: { tool },
                })}
              </EuiBadge>
            </EuiFlexItem>
          ))}
          {summary.toolsOnlyInCandidate.map((tool) => (
            <EuiFlexItem grow={false} key={`c-${tool}`}>
              <EuiBadge color="primary" data-test-subj="agtEvlToolOnlyCandidate">
                {i18n.translate('agentTraces.evalsPage.toolOnlyCandidate', {
                  defaultMessage: '{tool} only in candidate',
                  values: { tool },
                })}
              </EuiBadge>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
        <EuiSpacer size="m" />
        <EuiFlexGroup gutterSize="m">
          <EuiFlexItem grow={2}>
            <SectionTitle>
              {i18n.translate('agentTraces.evalsPage.totals', { defaultMessage: 'Totals' })}
            </SectionTitle>
            <EuiSpacer size="xs" />
            <EuiBasicTable<TotalsRow>
              compressed
              items={totalsRows(state.baseline.totals, state.candidate.totals)}
              data-test-subj="agtEvlTraceTotals"
              columns={[
                { field: 'metric', name: '', width: '110px' },
                { field: 'baseline', name: baselineTitle },
                { field: 'candidate', name: candidateTitle },
                {
                  field: 'delta',
                  name: i18n.translate('agentTraces.evalsPage.change', {
                    defaultMessage: 'Change',
                  }),
                  render: (delta: string | undefined, row: TotalsRow) =>
                    delta ? (
                      <EuiText size="xs" color={row.worse ? 'danger' : 'success'}>
                        {delta}
                      </EuiText>
                    ) : (
                      <EuiText size="xs" color="subdued">
                        -
                      </EuiText>
                    ),
                },
              ]}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={3}>
            <SectionTitle>
              {i18n.translate('agentTraces.evalsPage.grades', { defaultMessage: 'Grades' })}
            </SectionTitle>
            <EuiSpacer size="xs" />
            {grades.length === 0 ? (
              <EuiText size="xs" color="subdued">
                {i18n.translate('agentTraces.evalsPage.noGrades', {
                  defaultMessage: 'No grades on these traces.',
                })}
              </EuiText>
            ) : (
              <EuiBasicTable<GradeRow>
                compressed
                items={grades}
                data-test-subj="agtEvlTraceGrades"
                columns={[
                  {
                    field: 'name',
                    name: i18n.translate('agentTraces.evalsPage.caseScoreName', {
                      defaultMessage: 'Evaluation',
                    }),
                    width: '25%',
                  },
                  {
                    field: 'baseline',
                    name: baselineTitle,
                    render: (r?: EvalResult) => <GradeCell result={r} />,
                  },
                  {
                    field: 'candidate',
                    name: candidateTitle,
                    render: (r?: EvalResult) => <GradeCell result={r} />,
                  },
                ]}
              />
            )}
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="l" />
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiButtonGroup
              legend={i18n.translate('agentTraces.evalsPage.compareViewLegend', {
                defaultMessage: 'Show the steps as a list or as a graph',
              })}
              buttonSize="compressed"
              options={[
                {
                  id: 'steps',
                  label: i18n.translate('agentTraces.evalsPage.steps', { defaultMessage: 'Steps' }),
                  'data-test-subj': 'agtEvlCompareViewSteps',
                },
                {
                  id: 'graph',
                  label: i18n.translate('agentTraces.evalsPage.graph', { defaultMessage: 'Graph' }),
                  'data-test-subj': 'agtEvlCompareViewGraph',
                },
              ]}
              idSelected={view}
              onChange={(id) => setView(id as 'steps' | 'graph')}
              data-test-subj="agtEvlCompareView"
            />
          </EuiFlexItem>
          {view === 'steps' && (
            <EuiFlexItem grow={false}>
              <EuiSwitch
                compressed
                label={i18n.translate('agentTraces.evalsPage.onlyDifferences', {
                  defaultMessage: 'Only differences',
                })}
                checked={onlyDifferences}
                onChange={(e) => setOnlyDifferences(e.target.checked)}
                data-test-subj="agtEvlOnlyDifferences"
              />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        {view === 'steps' ? (
          <StepsComparison aligned={aligned} onlyDifferences={onlyDifferences} />
        ) : (
          <GraphComparison
            baseline={state.baseline.tree}
            candidate={state.candidate.tree}
            aligned={aligned}
            baselineTitle={baselineTitle}
            candidateTitle={candidateTitle}
          />
        )}
      </>
    );
  };

  return (
    <EuiFlyout
      onClose={onClose}
      size="l"
      ownFocus={false}
      aria-labelledby="agtEvlTraceCompareTitle"
      data-test-subj="agtEvlTraceCompare"
    >
      <EuiFlyoutHeader hasBorder>
        {onBack && (
          <EuiButtonEmpty
            size="xs"
            flush="left"
            iconType="arrowLeft"
            onClick={onBack}
            data-test-subj="agtEvlTraceCompareBack"
          >
            {i18n.translate('agentTraces.evalsPage.backToCase', {
              defaultMessage: 'Test case',
            })}
          </EuiButtonEmpty>
        )}
        <EuiTitle size="s">
          <h2 id="agtEvlTraceCompareTitle">
            <FormattedMessage
              id="agentTraces.evalsPage.traceCompareTitle"
              defaultMessage="Compare agent traces"
            />
          </h2>
        </EuiTitle>
        {caseName && (
          <EuiText size="s" color="subdued">
            {caseName}
          </EuiText>
        )}
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" responsive={false}>
          <EuiFlexItem>
            <SideHeader
              title={baselineTitle}
              side={baseline}
              testSubj="agtEvlTraceCompareOpenBaseline"
              onOpenTrace={onOpenTrace}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <SideHeader
              title={candidateTitle}
              side={candidate}
              testSubj="agtEvlTraceCompareOpenCandidate"
              onOpenTrace={onOpenTrace}
            />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>{body()}</EuiFlyoutBody>
    </EuiFlyout>
  );
};
