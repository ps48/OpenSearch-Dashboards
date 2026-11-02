/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import moment from 'moment-timezone';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiLink,
  EuiLoadingContent,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { DataPublicPluginStart } from '../../../../data/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import { transformPPLDataToTraceHits } from '../pages/traces/trace_details/traces/ppl_to_trace_hits';
import {
  BaseRow,
  buildFullSpanTree,
  formatTimestamp,
  hitsToAgentSpans,
} from '../pages/traces/hooks/tree_utils';
import { EvalResult, isSpanResult, parseTime, recordsToResults, tallyOf } from './eval_model';
import { buildTraceResultsQuery, buildTraceSpansQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { errorMessage, runPpl } from './use_ppl_rows';
import { JudgeMark } from './judge_mark';
import {
  DASH,
  QueryErrorCallout,
  RUN_A,
  RUN_B,
  TallyCell,
  VerdictBadge,
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

interface Side {
  traceId: string;
  spans: FlatSpan[];
  output?: string;
  results: EvalResult[];
}

const SpanList: React.FC<{ side: Side; only: Set<string> }> = ({ side, only }) => {
  const root = side.spans[0];
  const t0 = root?.startMs ?? 0;
  const total = Math.max(1, root?.durationMs ?? 1);
  return (
    <div className="agtEvlSpans" data-test-subj={`agtEvlSpans-${side.traceId}`}>
      {side.spans.map((s, i) => {
        const marks = resultsOfSpan(side.results, s, i === 0);
        const offset = Number.isFinite(s.startMs - t0) ? Math.max(0, s.startMs - t0) : 0;
        const isOnly = only.has(s.spanId);
        const row = (
          <div
            className={`agtEvlSpans__row${isOnly ? ' agtEvlSpans__row--only' : ''}`}
            key={s.spanId}
            data-test-subj={isOnly ? 'agtEvlSpanOnly' : 'agtEvlSpan'}
          >
            <span className="agtEvlSpans__name" style={{ paddingLeft: s.depth * 12 }}>
              {marks.length > 0 && <JudgeMark results={marks} />}
              <span className="agtEvlDim agtEvlSmall">{s.kind}</span> {s.name}
              {marks.length > 0 && <TallyCell tally={tallyOf(marks)} />}
            </span>
            <span className="agtEvlSpans__bar">
              <span
                className="agtEvlSpans__fill"
                style={{
                  left: `${Math.min(100, (offset / total) * 100)}%`,
                  width: `${Math.max(1.5, (s.durationMs / total) * 100)}%`,
                }}
              />
            </span>
            <span className="agtEvlDim agtEvlSmall agtEvlSpans__dur">
              {formatDuration(s.durationMs)}
            </span>
          </div>
        );
        return isOnly ? (
          <EuiToolTip
            key={s.spanId}
            content={i18n.translate('agentTraces.evals.compareTraces.onlyHere', {
              defaultMessage: 'Only in this trace',
            })}
          >
            {row}
          </EuiToolTip>
        ) : (
          row
        );
      })}
    </div>
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
  const { dataset, spans, index, timeRange, openResult } = useEvalContext();
  const [state, setState] = useState<{ loading: boolean; error?: string; sides?: Side[] }>({
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    const ids = [traceA, traceB];
    const timezone = moment.tz.guess();
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
        timeRange,
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
  }, [services.data, spans, dataset, index, timeRange, traceA, traceB]);

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
      {side.spans.length ? (
        <SpanList side={side} only={onlyIn(side.spans, other.spans)} />
      ) : (
        <EuiText size="xs" color="subdued">
          <p>
            {i18n.translate('agentTraces.evals.compareTraces.noSpans', {
              defaultMessage: 'Trace not found in the span index.',
            })}
          </p>
        </EuiText>
      )}
      <EuiText size="xs">
        <h5>
          {i18n.translate('agentTraces.evals.compareTraces.output', { defaultMessage: 'Output' })}
        </h5>
        <p className="agtEvlProse agtEvlBox">{side.output ?? DASH}</p>
        <h5>
          {i18n.translate('agentTraces.evals.compareTraces.results', { defaultMessage: 'Results' })}
        </h5>
      </EuiText>
      {side.results.map((r) => (
        <div className="agtEvlCaseResults__row agtEvlCaseResults__row--compact" key={r.id}>
          <EuiLink onClick={() => openResult(r)}>{r.name}</EuiLink>
          <span>
            <VerdictBadge verdict={r.verdict} />
          </span>
          <span className="agtEvlDim">{r.explanation ?? r.errorType ?? DASH}</span>
        </div>
      ))}
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
          <EuiFlexGroup gutterSize="l" responsive={false}>
            {column(state.sides[0], state.sides[1], RUN_A, versionA)}
            {column(state.sides[1], state.sides[0], RUN_B, versionB)}
          </EuiFlexGroup>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
