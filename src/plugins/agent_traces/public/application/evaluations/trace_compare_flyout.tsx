/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiLoadingContent,
  EuiPanel,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { DataPublicPluginStart } from '../../../../data/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { transformPPLDataToTraceHits } from '../pages/traces/trace_details/traces/ppl_to_trace_hits';
import { TraceFlowView } from '../pages/traces/flow/trace_flow_view';
import { flowEvalDecoration } from '../pages/traces/flyout/trace_evaluations';
import { TimelineGantt, TimelineRowDecoration } from '../pages/traces/flyout/timeline_gantt';
import {
  TimelineSpan,
  TreeNode,
  buildTreeFromTraceRow,
  calculateTimelineRange,
  collectExpandableIds,
  flattenVisibleNodes,
} from '../pages/traces/flyout/tree_helpers';
import './trace_compare_flyout.scss';
import type { CategorizedSpan } from '../../services/span_categorization';
import {
  BaseRow,
  TraceRow,
  buildFullSpanTree,
  formatTimestamp,
  hitsToAgentSpans,
} from '../pages/traces/hooks/tree_utils';
import { EvalResult, isSpanResult, parseTime, recordsToResults, tallyOf } from './eval_model';
import { buildTraceResultsQuery, buildTraceSpansQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { errorMessage, runPpl } from './use_ppl_rows';
import { JudgeMark } from './judge_mark';
import { SpanIOView } from './span_io_view';
import { getEvalTimezone } from './eval_time';
import {
  DASH,
  OUTPUT_LABEL,
  QueryErrorCallout,
  RUN_A,
  RUN_B,
  ResultRows,
  TallyCell,
  VersionBadge,
  formatDuration,
  shortId,
} from './eval_components';

export interface FlatSpan {
  spanId: string;
  name: string;
  kind: string;
  depth: number;
  startMs: number;
  durationMs: number;
}

/** The span tree, depth first, as rows. */
export const flattenSpans = (roots: BaseRow[]): FlatSpan[] => {
  const out: FlatSpan[] = [];
  const walk = (rows: BaseRow[], depth: number) =>
    rows.forEach((r) => {
      out.push({
        spanId: r.spanId,
        name: r.name,
        kind: r.kind,
        depth,
        startMs: parseTime(r.rawDocument?.startTime),
        durationMs: (r.durationNanos ?? 0) / 1e6,
      });
      if (r.children?.length) walk(r.children, depth + 1);
    });
  walk(roots, 0);
  return out;
};

/** Span names of one trace that the other does not have. */
export const onlyIn = (spans: FlatSpan[], other: FlatSpan[]): Set<string> => {
  const names = new Set(other.map((s) => s.name));
  return new Set(spans.filter((s) => !names.has(s.name)).map((s) => s.spanId));
};

/** Results of a span: its own, plus the trace-level results on the root. */
export const resultsOfSpan = (results: EvalResult[], span: FlatSpan, isRoot: boolean) =>
  results.filter((r) => (isSpanResult(r) ? r.spanId === span.spanId : isRoot));

export interface Side {
  traceId: string;
  spans: FlatSpan[];
  /** The span tree as the trace flyout builds it (for the Trace map). */
  tree?: TraceRow[];
  /** The root span's raw output (GenAI messages). */
  output?: unknown;
  results: EvalResult[];
}

type CompareView = 'spans' | 'map';

const ONLY_HERE = i18n.translate('agentTraces.evals.compareTraces.onlyHere', {
  defaultMessage: 'Only in this trace',
});

/** The Agent Traces span nodes of one side, as the trace flyout's Timeline builds them. */
const ganttNodes = (side: Side): TreeNode[] => (side.tree ?? []).map(buildTreeFromTraceRow);

/** The longest of the two traces: both Gantts share it, so equal bar widths are equal times. */
export const sharedDurationMs = (sides: Side[]): number =>
  Math.max(0, ...sides.map((s) => calculateTimelineRange(ganttNodes(s)).durationMs));

/**
 * One side's Timeline: the Agent Traces Gantt (the trace flyout's Timeline tab), on a time
 * scale shared with the other side. Spans only in this trace are highlighted; judged spans
 * carry their judge mark and tally.
 */
export const SpanList: React.FC<{ side: Side; only: Set<string>; durationMs?: number }> = ({
  side,
  only,
  durationMs,
}) => {
  const nodes = useMemo(() => ganttNodes(side), [side]);
  const [expanded, setExpanded] = useState<Set<string>>(() => collectExpandableIds(nodes));
  const [selected, setSelected] = useState<string | undefined>();
  const visible = useMemo(() => flattenVisibleNodes(nodes, expanded), [nodes, expanded]);
  const range = useMemo(() => {
    const own = calculateTimelineRange(nodes);
    const total = Math.max(own.durationMs, durationMs ?? 0);
    return { minMs: own.minMs, maxMs: own.minMs + total, durationMs: total };
  }, [nodes, durationMs]);
  const rootId = side.spans[0]?.spanId;
  const byId = useMemo(() => new Map(side.spans.map((s) => [s.spanId, s])), [side.spans]);
  const decorateRow = useCallback(
    (span: TimelineSpan): TimelineRowDecoration => {
      const spanId = span.node.traceRow?.spanId ?? span.node.id;
      const flat = byId.get(spanId);
      const marks = flat ? resultsOfSpan(side.results, flat, spanId === rootId) : [];
      const isOnly = only.has(spanId);
      return {
        className: isOnly ? 'agtEvlGanttRow--only' : undefined,
        title: isOnly ? `${span.node.label} (${ONLY_HERE})` : undefined,
        'data-test-subj': isOnly ? 'agtEvlSpanOnly' : 'agtEvlSpan',
        before: marks.length > 0 ? <JudgeMark results={marks} /> : undefined,
        after: marks.length > 0 ? <TallyCell tally={tallyOf(marks)} /> : undefined,
      };
    },
    [byId, side.results, rootId, only]
  );
  const toggle = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  return (
    <EuiPanel
      hasBorder
      hasShadow={false}
      paddingSize="none"
      className="agtEvlGanttPanel"
      data-test-subj={`agtEvlSpans-${side.traceId}`}
    >
      <TimelineGantt
        timelineVisibleSpans={visible}
        timelineRange={range}
        selectedNodeId={selected}
        expandedNodes={expanded}
        onSelectNode={setSelected}
        onToggleExpanded={toggle}
        decorateRow={decorateRow}
      />
    </EuiPanel>
  );
};

/** One side's Trace map: the Agent Traces node map, judged nodes marked, extra spans outlined. */
const TraceMapSide: React.FC<{ side: Side; only: Set<string> }> = ({ side, only }) => {
  const rootId = side.spans[0]?.spanId;
  const decorate = useCallback(
    (span: CategorizedSpan) => {
      const flat = side.spans.find((x) => x.spanId === span.spanId);
      const marks = flat ? resultsOfSpan(side.results, flat, span.spanId === rootId) : [];
      const base = flowEvalDecoration(marks);
      if (!only.has(span.spanId ?? '')) return base;
      return {
        ...base,
        className: `${base?.className ?? ''} agtEvlGraphNode--only`.trim(),
      };
    },
    [side, only, rootId]
  );
  return (
    <EuiPanel
      hasBorder
      hasShadow={false}
      paddingSize="none"
      className="agtEvlGraphPanel"
      data-test-subj={`agtEvlTraceMap-${side.traceId}`}
    >
      <TraceFlowView
        spanTree={side.tree ?? []}
        totalDuration={side.spans[0]?.durationMs ?? 0}
        selectedSpan={null}
        onSelectSpan={() => undefined}
        decorateNode={decorate}
        showMinimap={false}
      />
    </EuiPanel>
  );
};

/**
 * Two traces of the same case (Run A and Run B) side by side: spans with durations (spans
 * only in one trace highlighted), the output and the results of each.
 */
export const TraceCompareFlyout: React.FC<{
  caseId: string;
  traceA: string;
  traceB: string;
  versionA?: string;
  versionB?: string;
  onClose: () => void;
}> = ({ caseId, traceA, traceB, versionA, versionB, onClose }) => {
  const { services } = useOpenSearchDashboards<{ data: DataPublicPluginStart }>();
  // Both traces' results: the browse range, which holds the run before (where its trace was
  // found), not only the current run's window.
  const { dataset, spans, index, browseRange, openResult } = useEvalContext();
  const [state, setState] = useState<{ loading: boolean; error?: string; sides?: Side[] }>({
    loading: true,
  });
  const [view, setView] = useState<CompareView>('spans');

  useEffect(() => {
    const controller = new AbortController();
    const ids = [traceA, traceB];
    const timezone = getEvalTimezone();
    setState({ loading: true });
    Promise.all([
      new PPLService(services.data, { signal: controller.signal }).executeQuery(
        spans,
        buildTraceSpansQuery(spans.title, ids)
      ),
      runPpl(
        services.data,
        dataset,
        buildTraceResultsQuery(index, ids),
        browseRange,
        controller.signal
      ),
    ])
      .then(([spanResponse, resultRows]) => {
        if (controller.signal.aborted) return;
        const hits = transformPPLDataToTraceHits(spanResponse);
        const results = recordsToResults(resultRows);
        const sides = ids.map((traceId) => {
          const tree = buildFullSpanTree(
            hitsToAgentSpans(hits.filter((h) => h.traceId === traceId)),
            (ts) => formatTimestamp(ts, timezone)
          );
          const output = tree[0]?.output;
          return {
            traceId,
            spans: flattenSpans(tree),
            tree: tree as TraceRow[],
            output: output && output !== DASH ? output : undefined,
            results: results.filter((r) => r.traceId === traceId),
          };
        });
        setState({ loading: false, sides });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ loading: false, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [services.data, spans, dataset, index, browseRange, traceA, traceB]);

  const shared = useMemo(() => (state.sides ? sharedDurationMs(state.sides) : 0), [state.sides]);

  const column = (side: Side, other: Side, label: string, version?: string) => (
    <EuiFlexItem key={label} className="agtEvlTraceCol">
      <EuiTitle size="xxs">
        <h4>
          {label} <VersionBadge version={version} />{' '}
          <span className="agtEvlMono agtEvlDim">{shortId(side.traceId)}</span>
        </h4>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        <p>
          {formatDuration(side.spans[0]?.durationMs ?? NaN)} ·{' '}
          {i18n.translate('agentTraces.evals.compareTraces.spans', {
            defaultMessage: '{n} spans',
            values: { n: side.spans.length },
          })}
        </p>
      </EuiText>
      {!side.spans.length ? (
        <EuiText size="xs" color="subdued">
          <p>
            {i18n.translate('agentTraces.evals.compareTraces.noSpans', {
              defaultMessage: 'Trace not found in the span index.',
            })}
          </p>
        </EuiText>
      ) : view === 'spans' ? (
        <SpanList side={side} only={onlyIn(side.spans, other.spans)} durationMs={shared} />
      ) : (
        <TraceMapSide side={side} only={onlyIn(side.spans, other.spans)} />
      )}
      <EuiSpacer size="s" />
      <SpanIOView
        idPrefix={`agtEvlTraceCompare-${side.traceId}`}
        testId={`agtEvlTraceCompareOutput-${side.traceId}`}
        sections={[{ key: 'output', label: OUTPUT_LABEL, value: side.output }]}
      />
      <EuiSpacer size="s" />
      <EuiTitle size="xxs">
        <span>
          {i18n.translate('agentTraces.evals.compareTraces.results', { defaultMessage: 'Results' })}
        </span>
      </EuiTitle>
      <ResultRows results={side.results} onOpen={openResult} />
    </EuiFlexItem>
  );

  return (
    <EuiFlyout
      onClose={onClose}
      size="l"
      ownFocus={false}
      aria-labelledby="agtEvlTraceCompareTitle"
      data-test-subj="agtEvlTraceCompareFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id="agtEvlTraceCompareTitle">
            {i18n.translate('agentTraces.evals.compareTraces.title', {
              defaultMessage: 'Compare traces',
            })}{' '}
            <span className="agtEvlDim agtEvlSmall">
              {i18n.translate('agentTraces.evals.compareTraces.case', {
                defaultMessage: 'case {id}',
                values: { id: caseId },
              })}
            </span>
          </h2>
        </EuiTitle>
        <EuiText size="xs" color="subdued">
          <p>
            {i18n.translate('agentTraces.evals.compareTraces.sub', {
              defaultMessage: 'Highlighted spans appear in one trace only.',
            })}
          </p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {state.error ? (
          <QueryErrorCallout message={state.error} />
        ) : state.loading || !state.sides ? (
          <EuiLoadingContent lines={8} />
        ) : (
          <>
            <EuiTabs size="s">
              {(
                [
                  [
                    'spans',
                    i18n.translate('agentTraces.evals.compareTraces.tabTimeline', {
                      defaultMessage: 'Timeline',
                    }),
                  ],
                  [
                    'map',
                    i18n.translate('agentTraces.evals.compareTraces.tabMap', {
                      defaultMessage: 'Trace map',
                    }),
                  ],
                ] as Array<[CompareView, string]>
              ).map(([id, label]) => (
                <EuiTab
                  key={id}
                  isSelected={view === id}
                  onClick={() => setView(id)}
                  data-test-subj={`agtEvlTraceCompareTab-${id}`}
                >
                  {label}
                </EuiTab>
              ))}
            </EuiTabs>
            <EuiSpacer size="s" />
            {view === 'spans' && shared > 0 && (
              <EuiText size="xs" color="subdued" data-test-subj="agtEvlTraceCompareScale">
                <p>
                  {i18n.translate('agentTraces.evals.compareTraces.sharedScale', {
                    defaultMessage:
                      'Both timelines share one time scale, 0 to {total}, from the start of each trace.',
                    values: { total: formatDuration(shared) },
                  })}
                </p>
              </EuiText>
            )}
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="l" responsive={false}>
              {column(state.sides[0], state.sides[1], RUN_A, versionA)}
              {column(state.sides[1], state.sides[0], RUN_B, versionB)}
            </EuiFlexGroup>
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
