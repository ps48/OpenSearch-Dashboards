/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiBasicTableColumn,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFlexGrid,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { pplResponseToRecords } from '../pages/sessions/session_utils';
import { EvalResult, createEvalsPplService } from './eval_data';
import { TimeBoundsMs, aggregateEvaluator, parseEvalTime, pickInterval } from './eval_aggregations';
import { spansDataset } from './eval_target';
import { useSpansIndexPattern } from './eval_dataset';
import {
  BreakdownDimension,
  BreakdownEntry,
  Concentration,
  JoinedFailure,
  SPAN_LOOKUP_LIMIT,
  SpanFacts,
  breakdownFailures,
  buildFailureSpansQuery,
  joinFailures,
  latestFailures,
  recordToSpanFacts,
  spanLookupBatches,
  topConcentration,
} from './eval_drilldown';
import { OutcomeHistogram, ScoreDistributionChart, ScoreTrendChart } from './eval_charts';
import {
  LevelBadge,
  OUTCOME_CHART_COLOR,
  OutcomeBadge,
  QueryErrorCallout,
  SourceBadge,
  formatCount,
  formatEvalTime,
  formatPercent,
  formatValue,
  shortId,
} from './eval_components';
import { sessionToOpen, traceToOpen, useOpenSession } from './eval_links';
import { errorMessage } from './use_eval_data';
import type { EvaluationsServices } from '.';

interface SpansState {
  loading: boolean;
  error?: string;
  spans: SpanFacts[];
}

/** Span facts of the failing results' traces, in batches of trace ids. */
export const useFailureSpans = (failures: EvalResult[]): SpansState => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const spansIndex = useSpansIndexPattern();
  const [state, setState] = useState<SpansState>({ loading: false, spans: [] });
  const key = failures.map((r) => r.id).join('|');
  useEffect(() => {
    const batches = spanLookupBatches(failures);
    if (batches.length === 0) {
      setState({ loading: false, spans: [] });
      return;
    }
    const controller = new AbortController();
    setState({ loading: true, spans: [] });
    const ppl = createEvalsPplService(services.data, undefined, controller.signal);
    Promise.all(
      batches.map((b) =>
        ppl.executeQuery(
          spansDataset(spansIndex),
          buildFailureSpansQuery(b.traceIds, b.spanIds, SPAN_LOOKUP_LIMIT, spansIndex)
        )
      )
    )
      .then((responses) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          spans: responses.flatMap((r) => pplResponseToRecords(r).map(recordToSpanFacts)),
        });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, spans: [], error: errorMessage(e) });
        }
      });
    return () => controller.abort();
    // `key` identifies the failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.data, key, spansIndex]);
  return state;
};

const DIMENSION_TITLE: Record<BreakdownDimension, string> = {
  tool: i18n.translate('agentTraces.evalsPage.byTool', { defaultMessage: 'By tool called' }),
  operation: i18n.translate('agentTraces.evalsPage.byOperation', {
    defaultMessage: 'By judged operation',
  }),
  agent: i18n.translate('agentTraces.evalsPage.byAgent', { defaultMessage: 'By agent or service' }),
  label: i18n.translate('agentTraces.evalsPage.byLabel', { defaultMessage: 'By label' }),
  run: i18n.translate('agentTraces.evalsPage.byRun', { defaultMessage: 'By evaluation run' }),
};

/** One sentence for the strongest concentration of failures. */
export const concentrationText = (name: string, c: Concentration): string => {
  const values = { share: formatPercent(c.share), name, key: c.key, count: c.count };
  switch (c.dimension) {
    case 'tool':
      return i18n.translate('agentTraces.evalsPage.concentrationTool', {
        defaultMessage: '{share} of {name} failures ({count}) are on traces that called {key}.',
        values: { share: values.share, name: values.name, key: values.key, count: values.count },
      });
    case 'run':
      return i18n.translate('agentTraces.evalsPage.concentrationRun', {
        defaultMessage: '{share} of {name} failures ({count}) come from run {key}.',
        values: { share: values.share, name: values.name, key: values.key, count: values.count },
      });
    case 'agent':
      return i18n.translate('agentTraces.evalsPage.concentrationAgent', {
        defaultMessage: '{share} of {name} failures ({count}) come from {key}.',
        values: { share: values.share, name: values.name, key: values.key, count: values.count },
      });
    case 'operation':
      return i18n.translate('agentTraces.evalsPage.concentrationOperation', {
        defaultMessage: '{share} of {name} failures ({count}) judged {key} spans.',
        values: { share: values.share, name: values.name, key: values.key, count: values.count },
      });
    default:
      return i18n.translate('agentTraces.evalsPage.concentrationLabel', {
        defaultMessage: '{share} of {name} failures ({count}) are labeled {key}.',
        values: { share: values.share, name: values.name, key: values.key, count: values.count },
      });
  }
};

const BreakdownPanel: React.FC<{
  dimension: BreakdownDimension;
  entries: BreakdownEntry[];
  limit?: number;
}> = ({ dimension, entries, limit = 5 }) => {
  const shown = entries.slice(0, limit);
  const rest = entries.length - shown.length;
  return (
    <EuiPanel
      hasBorder
      paddingSize="s"
      className="agtEvlBreakdown"
      data-test-subj={`agtEvlBreakdown-${dimension}`}
    >
      <EuiText size="xs">
        <strong>{DIMENSION_TITLE[dimension]}</strong>
      </EuiText>
      <EuiSpacer size="xs" />
      {shown.length === 0 ? (
        <EuiText size="xs" color="subdued">
          {i18n.translate('agentTraces.evalsPage.breakdownEmpty', { defaultMessage: 'No data' })}
        </EuiText>
      ) : (
        shown.map((e) => (
          <div key={e.key} className="agtEvlBreakdown__row">
            <EuiFlexGroup gutterSize="s" responsive={false} alignItems="center">
              <EuiFlexItem style={{ minWidth: 0 }}>
                <EuiText size="xs" className="eui-textTruncate">
                  <span title={e.key}>{dimension === 'run' ? shortId(e.key, 28) : e.key}</span>
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText size="xs" color="subdued">
                  {formatCount(e.count)} · {formatPercent(e.share)}
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
            <div className="agtEvlBreakdown__track" aria-hidden>
              <span
                className="agtEvlBreakdown__bar"
                style={{
                  width: `${Math.max(2, e.share * 100)}%`,
                  background: OUTCOME_CHART_COLOR.fail,
                }}
              />
            </div>
          </div>
        ))
      )}
      {rest > 0 && (
        <EuiText size="xs" color="subdued">
          {i18n.translate('agentTraces.evalsPage.breakdownMore', {
            defaultMessage: '{count} more',
            values: { count: rest },
          })}
        </EuiText>
      )}
    </EuiPanel>
  );
};

const Stat: React.FC<{ title: string; value: string; testSubj: string; color?: string }> = ({
  title,
  value,
  testSubj,
  color,
}) => (
  <EuiFlexItem grow={false} style={{ minWidth: 96 }}>
    <EuiText size="xs" color="subdued">
      {title}
    </EuiText>
    <EuiTitle size="s">
      <p data-test-subj={testSubj} style={color ? { color } : undefined}>
        {value}
      </p>
    </EuiTitle>
  </EuiFlexItem>
);

/**
 * One evaluation in focus: pass rate and score trend, where its failures concentrate (agent,
 * judged operation, tools of the trace, label, run) and its failing results with the judge's
 * explanation, the judged span and a link to the trace.
 */
export const EvaluatorDrilldownFlyout: React.FC<{
  name: string;
  /** Every result of the evaluation in scope (time range, or one run). */
  results: EvalResult[];
  loading?: boolean;
  error?: string;
  /** What the results cover, e.g. the time range or the run. */
  scope: string;
  /** Time bounds of the scope: shows the trend over time; without, the score distribution. */
  bounds?: TimeBoundsMs;
  /** The run the results belong to (run page): a histogram bar shows that run's results. */
  runId?: string;
  onClose: () => void;
  onOpenResult?: (r: EvalResult) => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
  onViewAllResults?: () => void;
}> = ({
  name,
  results,
  loading,
  error,
  scope,
  bounds,
  runId,
  onClose,
  onOpenResult,
  onOpenTrace,
  onViewAllResults,
}) => {
  const aggregate = useMemo(() => aggregateEvaluator(name, results), [name, results]);
  const openSession = useOpenSession();
  const failures = useMemo(() => latestFailures(results), [results]);
  const spans = useFailureSpans(failures);
  const joined = useMemo(() => joinFailures(failures, spans.spans), [failures, spans.spans]);
  const breakdown = useMemo(() => breakdownFailures(joined), [joined]);
  const concentration = useMemo(() => topConcentration(breakdown, results), [breakdown, results]);
  const levels = useMemo(() => Array.from(new Set(results.map((r) => r.level))), [results]);
  const sources = useMemo(() => Array.from(new Set(results.map((r) => r.source))), [results]);
  const failCount = results.filter((r) => r.outcome === 'fail').length;
  const dimensions: BreakdownDimension[] = [
    'tool',
    'operation',
    'agent',
    'label',
    ...(breakdown.dimensions.run.length > 0 ? (['run'] as BreakdownDimension[]) : []),
  ];

  const columns: Array<EuiBasicTableColumn<JoinedFailure>> = [
    {
      name: i18n.translate('agentTraces.evalsPage.colResult', { defaultMessage: 'Result' }),
      width: '150px',
      render: (j: JoinedFailure) => <OutcomeBadge result={j.result} />,
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colExplanation', {
        defaultMessage: 'Explanation',
      }),
      render: (j: JoinedFailure) => (
        <EuiText size="xs" className="agtEvlExplanation">
          {j.result.explanation ?? (
            <EuiText size="xs" color="subdued">
              -
            </EuiText>
          )}
        </EuiText>
      ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colJudged', { defaultMessage: 'Judged span' }),
      width: '24%',
      render: (j: JoinedFailure) => (
        <div data-test-subj="agtEvlDrilldownSpan">
          <EuiText size="xs">
            <strong>{j.agent ?? '-'}</strong>
          </EuiText>
          <EuiText size="xs" color="subdued">
            {[j.operation, j.tools.slice(0, 3).join(', ') + (j.tools.length > 3 ? ', ...' : '')]
              .filter(Boolean)
              .join(' · ')}
          </EuiText>
        </div>
      ),
    },
    {
      name: i18n.translate('agentTraces.evalsPage.colWhen', { defaultMessage: 'When' }),
      width: '110px',
      render: (j: JoinedFailure) => {
        const traceId = traceToOpen(j.result);
        const sessionId = openSession ? sessionToOpen(j.result) : undefined;
        return (
          <div>
            <EuiText size="xs" color="subdued">
              {formatEvalTime(j.result.time, 'MMM D, HH:mm')}
            </EuiText>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              {onOpenResult && (
                <EuiFlexItem grow={false}>
                  <EuiLink
                    onClick={() => onOpenResult(j.result)}
                    data-test-subj="agtEvlDrilldownOpenResult"
                  >
                    <EuiText size="xs">
                      {i18n.translate('agentTraces.evalsPage.details', {
                        defaultMessage: 'Details',
                      })}
                    </EuiText>
                  </EuiLink>
                </EuiFlexItem>
              )}
              {sessionId && openSession ? (
                <EuiFlexItem grow={false}>
                  <EuiLink
                    onClick={() => openSession(sessionId, parseEvalTime(j.result.time))}
                    data-test-subj="agtEvlDrilldownOpenSession"
                  >
                    <EuiText size="xs">
                      {i18n.translate('agentTraces.evalsPage.session', {
                        defaultMessage: 'Session',
                      })}
                    </EuiText>
                  </EuiLink>
                </EuiFlexItem>
              ) : (
                traceId && (
                  <EuiFlexItem grow={false}>
                    <EuiLink
                      onClick={() => onOpenTrace(traceId, parseEvalTime(j.result.time))}
                      data-test-subj="agtEvlDrilldownOpenTrace"
                    >
                      <EuiText size="xs">
                        {i18n.translate('agentTraces.evalsPage.trace', {
                          defaultMessage: 'Trace',
                        })}
                      </EuiText>
                    </EuiLink>
                  </EuiFlexItem>
                )
              )}
            </EuiFlexGroup>
          </div>
        );
      },
    },
  ];

  const body = () => {
    if (loading) return <EuiLoadingContent lines={8} />;
    if (error) return <QueryErrorCallout message={error} />;
    return (
      <>
        <EuiFlexGroup gutterSize="l" responsive={false} wrap>
          <Stat
            title={i18n.translate('agentTraces.evalsPage.cardPassRate', {
              defaultMessage: 'Pass rate',
            })}
            value={formatPercent(aggregate.passRate)}
            testSubj="agtEvlDrilldownPassRate"
          />
          {aggregate.mean !== undefined && (
            <Stat
              title={
                aggregate.direction === 'minimize'
                  ? i18n.translate('agentTraces.evalsPage.meanLower', {
                      defaultMessage: 'Mean (lower is better)',
                    })
                  : i18n.translate('agentTraces.evalsPage.meanHigher', {
                      defaultMessage: 'Mean (higher is better)',
                    })
              }
              value={formatValue(aggregate.mean)}
              testSubj="agtEvlDrilldownMean"
            />
          )}
          <Stat
            title={i18n.translate('agentTraces.evalsPage.cardCount', { defaultMessage: 'Results' })}
            value={formatCount(results.length)}
            testSubj="agtEvlDrilldownCount"
          />
          <Stat
            title={i18n.translate('agentTraces.evalsPage.failing', { defaultMessage: 'Failing' })}
            value={formatCount(failCount)}
            testSubj="agtEvlDrilldownFailing"
            color={failCount > 0 ? OUTCOME_CHART_COLOR.fail : undefined}
          />
        </EuiFlexGroup>
        <EuiSpacer size="m" />
        {bounds ? (
          <EuiFlexGroup gutterSize="m">
            <EuiFlexItem grow={3}>
              <ScoreTrendChart
                results={results}
                bounds={bounds}
                interval={pickInterval(bounds)}
                height={180}
              />
            </EuiFlexItem>
            <EuiFlexItem grow={2}>
              <OutcomeHistogram
                results={results}
                bounds={bounds}
                interval={pickInterval(bounds)}
                height={180}
                name={name}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
        ) : (
          <ScoreDistributionChart results={results} name={name} runId={runId} />
        )}
        <EuiSpacer size="l" />
        <EuiTitle size="xs">
          <h3>
            {i18n.translate('agentTraces.evalsPage.whereFailures', {
              defaultMessage: 'Where failures concentrate',
            })}
          </h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        {failures.length === 0 ? (
          <EuiText size="s" color="subdued" data-test-subj="agtEvlDrilldownNoFailures">
            {i18n.translate('agentTraces.evalsPage.drilldownNoFailures', {
              defaultMessage: 'No failing results in this scope.',
            })}
          </EuiText>
        ) : (
          <>
            {spans.error && (
              <>
                <EuiCallOut
                  size="s"
                  color="warning"
                  iconType="alert"
                  title={i18n.translate('agentTraces.evalsPage.drilldownSpansError', {
                    defaultMessage: 'Could not read the judged spans: {error}',
                    values: { error: spans.error },
                  })}
                />
                <EuiSpacer size="s" />
              </>
            )}
            {concentration && !spans.loading && (
              <>
                <EuiCallOut
                  size="s"
                  iconType="search"
                  data-test-subj="agtEvlConcentration"
                  title={concentrationText(name, concentration)}
                />
                <EuiSpacer size="s" />
              </>
            )}
            {spans.loading ? (
              <EuiLoadingContent lines={4} />
            ) : (
              <EuiFlexGrid columns={dimensions.length > 4 ? 3 : 2} gutterSize="s">
                {dimensions.map((d) => (
                  <EuiFlexItem key={d}>
                    <BreakdownPanel dimension={d} entries={breakdown.dimensions[d]} />
                  </EuiFlexItem>
                ))}
              </EuiFlexGrid>
            )}
            <EuiSpacer size="xs" />
            <EuiText size="xs" color="subdued">
              {i18n.translate('agentTraces.evalsPage.drilldownBasis', {
                defaultMessage:
                  'Based on the latest {count, plural, one {# failing result} other {# failing results}}. A failure counts once under every tool its trace called.',
                values: { count: failures.length },
              })}
            </EuiText>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('agentTraces.evalsPage.failingResults', {
                  defaultMessage: 'Failing results',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiInMemoryTable<JoinedFailure>
              compressed
              className="agtEvlDenseTable"
              items={joined}
              columns={columns}
              pagination={{ initialPageSize: 10, pageSizeOptions: [10, 25, 50] }}
              data-test-subj="agtEvlDrilldownFailures"
            />
          </>
        )}
      </>
    );
  };

  return (
    <EuiFlyout
      onClose={onClose}
      size="l"
      ownFocus={false}
      aria-labelledby="agtEvlDrilldownTitle"
      data-test-subj="agtEvlDrilldown"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
          <EuiFlexItem grow={false}>
            <EuiTitle size="s">
              <h2 id="agtEvlDrilldownTitle">{name}</h2>
            </EuiTitle>
          </EuiFlexItem>
          {levels.map((l) => (
            <EuiFlexItem grow={false} key={l}>
              <LevelBadge level={l} />
            </EuiFlexItem>
          ))}
          {sources.map((s) => (
            <EuiFlexItem grow={false} key={s}>
              <SourceBadge source={s} />
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {scope}
            </EuiText>
          </EuiFlexItem>
          {onViewAllResults && (
            <EuiFlexItem grow={false}>
              <EuiToolTip
                content={i18n.translate('agentTraces.evalsPage.viewAllTip', {
                  defaultMessage: 'Results tab, filtered to this evaluation',
                })}
              >
                <EuiButtonEmpty
                  size="xs"
                  iconType="list"
                  onClick={onViewAllResults}
                  data-test-subj="agtEvlDrilldownViewAll"
                >
                  {i18n.translate('agentTraces.evalsPage.viewAll', {
                    defaultMessage: 'All results',
                  })}
                </EuiButtonEmpty>
              </EuiToolTip>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>{body()}</EuiFlyoutBody>
    </EuiFlyout>
  );
};
