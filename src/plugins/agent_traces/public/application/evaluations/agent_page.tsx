/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingChart,
  EuiNotificationBadge,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  AgentEvaluations,
  EvalStat,
  EvaluationRow,
  SuiteRow,
  VersionStat,
  agentEvaluations,
  agentSuites,
  defaultVersionPair,
  evaluationRows,
  isLive,
  latestRunPerVersion,
  rateDelta,
  trendSeries,
  versionKey,
} from './eval_model';
import {
  NO_VERSION,
  buildAgentEvaluationsQuery,
  buildAgentSuitesQuery,
  buildAgentTrendQuery,
  trendStep,
} from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { AgentTab, EvalAppState, TimeSlice } from './eval_routes';
import { ResultsView } from './results_view';
import { PassRateChart } from './pass_rate_chart';
import {
  DASH,
  DeltaCell,
  LiveDot,
  MetaItem,
  PassRateCell,
  QueryErrorCallout,
  SourceFilter,
  VersionBadge,
  formatTime,
  pct,
  versionLabel,
} from './eval_components';

const TAB_LABEL: Record<AgentTab, string> = {
  evaluations: i18n.translate('agentTraces.evals.agent.tabEvaluations', {
    defaultMessage: 'Evaluations',
  }),
  suites: i18n.translate('agentTraces.evals.agent.tabSuites', { defaultMessage: 'Suites' }),
  results: i18n.translate('agentTraces.evals.agent.tabResults', { defaultMessage: 'Results' }),
};

const AgentMeta: React.FC<{ data: AgentEvaluations }> = ({ data: { summary } }) => {
  if (!summary) return null;
  const live = summary.versions.filter((v) => isLive(v));
  return (
    <div className="agtEvlMeta" data-test-subj="agtEvlAgentMeta">
      <MetaItem
        label={i18n.translate('agentTraces.evals.agent.versions', { defaultMessage: 'Versions' })}
      >
        {summary.versions.map((v) => (
          <EuiBadge key={v.version ?? ''} color="default">
            {isLive(v) && <LiveDot />}
            {versionLabel(v.version)}
          </EuiBadge>
        ))}
        {live.length > 1 && (
          <EuiBadge color="accent" data-test-subj="agtEvlRunningTogether">
            {i18n.translate('agentTraces.evals.agent.runningTogether', {
              defaultMessage: 'running together',
            })}
          </EuiBadge>
        )}
      </MetaItem>
      <MetaItem
        label={i18n.translate('agentTraces.evals.agent.results', { defaultMessage: 'Results' })}
      >
        <strong>{summary.n.toLocaleString()}</strong>
      </MetaItem>
      <MetaItem
        label={i18n.translate('agentTraces.evals.agent.lastResult', {
          defaultMessage: 'Last result',
        })}
      >
        {formatTime(summary.last)}
      </MetaItem>
    </div>
  );
};

/** A version's value for one evaluation: pass rate, else average score, else top label. */
const ScoreText: React.FC<{ stat?: EvalStat }> = ({ stat }) => {
  if (!stat) return <span className="agtEvlDim">{DASH}</span>;
  if (stat.hasPassRule) return <PassRateCell rate={stat.rate} />;
  if (stat.avg !== undefined)
    return (
      <EuiToolTip
        content={i18n.translate('agentTraces.evals.agent.avgTip', {
          defaultMessage: 'Average score of {n} results',
          values: { n: stat.nv.toLocaleString() },
        })}
      >
        <span>
          {i18n.translate('agentTraces.evals.agent.avg', { defaultMessage: 'avg' })}{' '}
          <strong>{stat.avg.toFixed(2)}</strong>
        </span>
      </EuiToolTip>
    );
  if (stat.top)
    return (
      <EuiToolTip
        content={i18n.translate('agentTraces.evals.agent.topLabelTip', {
          defaultMessage: 'Most common label',
        })}
      >
        <span>
          {stat.top.label} <strong>{pct(stat.top.share)}</strong>
        </span>
      </EuiToolTip>
    );
  return <span className="agtEvlDim">{DASH}</span>;
};

/** Change, B against A: pass rate points, average score (direction-aware) or top label share. */
const ChangeCell: React.FC<{ row: EvaluationRow; exact?: boolean }> = ({
  row: { a, b, hasPassRule },
  exact,
}) => {
  if (!a || !b) return <span className="agtEvlDim">{DASH}</span>;
  if (hasPassRule)
    return (
      <DeltaCell
        delta={rateDelta(a.rate, b.rate)}
        na={a.tally.pass + a.tally.fail}
        nb={b.tally.pass + b.tally.fail}
        exact={exact}
      />
    );
  if (a.avg !== undefined && b.avg !== undefined)
    return <DeltaCell delta={b.avg - a.avg} score={{ direction: b.direction ?? a.direction }} />;
  if (a.top && b.top && a.top.label === b.top.label) {
    const d = Math.round((b.top.share - a.top.share) * 100);
    return (
      <span className="agtEvlDelta agtEvlDelta--flat">
        {i18n.translate('agentTraces.evals.agent.labelChange', {
          defaultMessage: '{sign}{points} pts {label}',
          values: {
            sign: d > 0 ? '+' : d < 0 ? '-' : '±',
            points: Math.abs(d),
            label: b.top.label,
          },
        })}
      </span>
    );
  }
  return <span className="agtEvlDim">{DASH}</span>;
};

/** "Compare <B> with <A>": any two versions of the agent. */
const VersionPicker: React.FC<{
  versions: VersionStat[];
  b?: string;
  a?: string;
  onChange: (pick: { b?: string; a?: string }) => void;
}> = ({ versions, b, a, onChange }) => {
  const options = versions.map((v) => ({ value: versionKey(v), text: versionLabel(v.version) }));
  return (
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>
        <EuiText size="xs" color="subdued">
          {i18n.translate('agentTraces.evals.agent.compare', { defaultMessage: 'Compare' })}
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiSelect
          compressed
          options={options}
          value={b ?? ''}
          onChange={(e) => onChange({ b: e.target.value, a: a === e.target.value ? undefined : a })}
          aria-label={i18n.translate('agentTraces.evals.agent.versionB', {
            defaultMessage: 'Version B',
          })}
          data-test-subj="agtEvlVersionB"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiText size="xs" color="subdued">
          {i18n.translate('agentTraces.evals.agent.with', { defaultMessage: 'with' })}
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiSelect
          compressed
          options={options.filter((o) => o.value !== b)}
          value={a ?? ''}
          hasNoInitialSelection={a === undefined}
          disabled={options.length < 2}
          onChange={(e) => onChange({ b, a: e.target.value })}
          aria-label={i18n.translate('agentTraces.evals.agent.versionA', {
            defaultMessage: 'Version A',
          })}
          data-test-subj="agtEvlVersionA"
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

const SectionTitle: React.FC<{ title: string; count?: number; sub?: string }> = ({
  title,
  count,
  sub,
}) => (
  <>
    <EuiTitle size="xs">
      <h3>
        {title}{' '}
        {count !== undefined && (
          <EuiNotificationBadge color="subdued">{count}</EuiNotificationBadge>
        )}
      </h3>
    </EuiTitle>
    {sub && (
      <EuiText size="xs" color="subdued">
        <p>{sub}</p>
      </EuiText>
    )}
    <EuiSpacer size="s" />
  </>
);

const EvaluationsTab: React.FC<{ agent: string }> = ({ agent }) => {
  const { dataset, index, timeRange, refreshKey, rangeMs, state, setState, navigate } =
    useEvalContext();
  const source = state.agentSource;
  const table = usePplRows(
    dataset,
    buildAgentEvaluationsQuery(index, agent, source),
    timeRange,
    refreshKey
  );
  const { step, ms: stepMs } = trendStep(rangeMs);
  const trend = usePplRows(
    dataset,
    buildAgentTrendQuery(index, agent, source, step),
    timeRange,
    refreshKey
  );
  const offline = source === 'offline';
  const data = useMemo(
    () => agentEvaluations(agent, offline ? latestRunPerVersion(table.rows) : table.rows),
    [agent, table.rows, offline]
  );
  const series = useMemo(() => trendSeries(trend.rows), [trend.rows]);
  const picked = state.versionPick?.[agent];
  const { b, a } = defaultVersionPair(data.versions, picked);
  const rows = useMemo(() => evaluationRows(data.versions, b, a), [data.versions, b, a]);
  const vb = data.versions.find((v) => versionKey(v) === b);
  const va = data.versions.find((v) => versionKey(v) === a);
  const labelB = vb ? versionLabel(vb.version) : DASH;
  const labelA = va ? versionLabel(va.version) : DASH;
  // With one version there is nothing to compare: show its values only.
  const single = data.versions.length < 2;

  const pick = (next: { b?: string; a?: string }) =>
    setState({ versionPick: { ...state.versionPick, [agent]: next } });

  // Results open on the same source as this tab (offline: suite runs only).
  const resultsPatch = (patch: Partial<EvalAppState['results']>, slice?: TimeSlice) => ({
    results: { ...state.results, names: [], versions: [], verdicts: [], source, ...patch },
    slice,
  });

  const allColumns: Array<EuiBasicTableColumn<EvaluationRow>> = [
    {
      field: 'name',
      name: i18n.translate('agentTraces.evals.agent.evaluation', { defaultMessage: 'Evaluation' }),
      sortable: true,
      render: (name: string, r: EvaluationRow) => (
        <span>
          <EuiLink>
            <strong>{name}</strong>
          </EuiLink>
          {(r.b?.tally.error ?? 0) > 0 && (
            <>
              {' '}
              <EuiBadge
                color="warning"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  navigate(
                    { page: 'agent', agent, tab: 'results' },
                    resultsPatch({
                      names: [r.name],
                      versions: b === undefined ? [] : [b || NO_VERSION],
                      verdicts: ['error'],
                    })
                  );
                }}
                onClickAriaLabel={i18n.translate('agentTraces.evals.agent.errorsAria', {
                  defaultMessage: 'Show the evaluator errors',
                })}
                data-test-subj={`agtEvlEvalErrors-${r.name}`}
              >
                {i18n.translate('agentTraces.evals.agent.errors', {
                  defaultMessage: '{n} {n, plural, one {error} other {errors}}',
                  values: { n: r.b?.tally.error ?? 0 },
                })}
              </EuiBadge>
            </>
          )}
          {!r.hasPassRule && (
            <>
              {' '}
              <EuiToolTip
                content={i18n.translate('agentTraces.evals.agent.noPassRuleTip', {
                  defaultMessage:
                    'The producer sets no pass rule: the table shows the average score or the most common label.',
                })}
              >
                <EuiBadge color="hollow" data-test-subj="agtEvlNoPassRule">
                  {(r.b ?? r.a)?.top && (r.b ?? r.a)?.avg === undefined
                    ? i18n.translate('agentTraces.evals.agent.labelOnly', {
                        defaultMessage: 'Label',
                      })
                    : i18n.translate('agentTraces.evals.agent.scoreOnly', {
                        defaultMessage: 'Score only',
                      })}
                </EuiBadge>
              </EuiToolTip>
            </>
          )}
        </span>
      ),
    },
    {
      field: 'b',
      name: single
        ? i18n.translate('agentTraces.evals.agent.passRate', { defaultMessage: 'Pass rate' })
        : labelB,
      align: 'right',
      sortable: (r: EvaluationRow) => (r.hasPassRule ? r.b?.rate : r.b?.avg) ?? -1,
      render: (_: unknown, r: EvaluationRow) => <ScoreText stat={r.b} />,
    },
    {
      field: 'a',
      name: labelA,
      align: 'right',
      sortable: (r: EvaluationRow) => (r.hasPassRule ? r.a?.rate : r.a?.avg) ?? -1,
      render: (_: unknown, r: EvaluationRow) => <ScoreText stat={r.a} />,
    },
    {
      field: 'delta',
      name: i18n.translate('agentTraces.evals.agent.change', { defaultMessage: 'Change' }),
      align: 'right',
      sortable: (r: EvaluationRow) => r.delta ?? Number.POSITIVE_INFINITY,
      render: (_: unknown, r: EvaluationRow) => <ChangeCell row={r} exact={offline} />,
    },
    {
      field: 'n',
      name: i18n.translate('agentTraces.evals.agent.resultsB', {
        defaultMessage: 'Results · {version}',
        values: { version: labelB },
      }),
      align: 'right',
      sortable: (r: EvaluationRow) => r.b?.tally.n ?? 0,
      render: (_: unknown, r: EvaluationRow) => (r.b?.tally.n ?? 0).toLocaleString(),
    },
  ];
  const columns = single
    ? allColumns.filter((c) => !['a', 'delta'].includes((c as { field?: string }).field ?? ''))
    : allColumns;

  const sourceWord =
    source === 'online'
      ? i18n.translate('agentTraces.evals.agent.online', { defaultMessage: 'Online' })
      : source === 'offline'
        ? i18n.translate('agentTraces.evals.agent.offline', { defaultMessage: 'Offline' })
        : i18n.translate('agentTraces.evals.agent.all', { defaultMessage: 'All' });

  const onPoint = (t: number) =>
    navigate(
      { page: 'agent', agent, tab: 'results' },
      resultsPatch({}, { from: t, to: t + stepMs })
    );

  return (
    <>
      <AgentMeta data={data} />
      <SourceFilter value={source} onChange={(agentSource) => setState({ agentSource })} />
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <SectionTitle
          title={i18n.translate('agentTraces.evals.agent.trendTitle', {
            defaultMessage: 'Pass rate over time',
          })}
          sub={i18n.translate('agentTraces.evals.agent.trendSub', {
            defaultMessage:
              '{source} results with a pass rule, one line per version (top 5), per {step}. Click a point to see the results of that slice.',
            values: { source: sourceWord, step },
          })}
        />
        {trend.error ? (
          <QueryErrorCallout message={trend.error} />
        ) : trend.loading && !series.length ? (
          <EuiLoadingChart size="l" />
        ) : series.length ? (
          <PassRateChart
            id="agentTrend"
            series={series.map((s) => ({
              id: s.version ?? NO_VERSION,
              name: versionLabel(s.version),
              points: s.points,
            }))}
            onPointClick={onPoint}
          />
        ) : (
          <EuiText size="s" color="subdued">
            <p>
              {i18n.translate('agentTraces.evals.agent.trendEmpty', {
                defaultMessage: 'No results with a pass rule in the range.',
              })}
            </p>
          </EuiText>
        )}
      </EuiPanel>
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <EuiFlexGroup alignItems="flexStart" responsive={false}>
          <EuiFlexItem>
            <SectionTitle
              title={TAB_LABEL.evaluations}
              count={rows.length}
              sub={
                single
                  ? i18n.translate('agentTraces.evals.agent.evalsSubSingle', {
                      defaultMessage:
                        'Click an evaluation to see its results. Evaluations without a pass rule show their average score or most common label.',
                    })
                  : offline
                    ? i18n.translate('agentTraces.evals.agent.evalsSubOffline', {
                        defaultMessage:
                          'Offline: each version at its latest suite run. Sorted by change, worst first. Click an evaluation to see its results for {version}.',
                        values: { version: labelB },
                      })
                    : i18n.translate('agentTraces.evals.agent.evalsSub', {
                        defaultMessage:
                          'Sorted by change, worst first. Click an evaluation to see its results for {version}. Evaluations without a pass rule show their average score or most common label.',
                        values: { version: labelB },
                      })
              }
            />
          </EuiFlexItem>
          {!single && (
            <EuiFlexItem grow={false}>
              <VersionPicker versions={data.versions} b={b} a={a} onChange={pick} />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
        {table.error ? (
          <QueryErrorCallout message={table.error} />
        ) : (
          <EuiInMemoryTable<EvaluationRow>
            items={rows}
            itemId="name"
            columns={columns}
            loading={table.loading}
            sorting={{ sort: { field: single ? 'name' : 'delta', direction: 'asc' } }}
            pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
            rowProps={(r: EvaluationRow) => ({
              className: 'agtEvlClickRow',
              onClick: () =>
                navigate(
                  { page: 'agent', agent, tab: 'results' },
                  resultsPatch({
                    names: [r.name],
                    versions: b === undefined ? [] : [b || NO_VERSION],
                    verdicts: [],
                  })
                ),
              'data-test-subj': `agtEvlEvalRow-${r.name}`,
            })}
            message={
              table.loaded && !table.loading
                ? i18n.translate('agentTraces.evals.agent.evalsEmpty', {
                    defaultMessage: 'No results for this agent in the range.',
                  })
                : undefined
            }
            data-test-subj="agtEvlEvaluationsTable"
          />
        )}
      </EuiPanel>
    </>
  );
};

const SuitesTab: React.FC<{ agent: string; onCount: (n: number) => void }> = ({
  agent,
  onCount,
}) => {
  const { dataset, index, timeRange, refreshKey, navigate } = useEvalContext();
  const { rows, loading, loaded, error } = usePplRows(
    dataset,
    buildAgentSuitesQuery(index, agent),
    timeRange,
    refreshKey
  );
  const suites = useMemo(() => agentSuites(rows), [rows]);
  React.useEffect(() => {
    if (loaded) onCount(suites.length);
  }, [loaded, suites.length, onCount]);

  const columns: Array<EuiBasicTableColumn<SuiteRow>> = [
    {
      field: 'suite',
      name: i18n.translate('agentTraces.evals.suites.suite', { defaultMessage: 'Suite' }),
      sortable: true,
      render: (s: string) => (
        <EuiLink>
          <strong>{s}</strong>
        </EuiLink>
      ),
    },
    {
      field: 'runs',
      name: i18n.translate('agentTraces.evals.suites.runs', { defaultMessage: 'Runs' }),
      align: 'right',
      sortable: true,
    },
    {
      field: 'last',
      name: i18n.translate('agentTraces.evals.suites.lastRun', { defaultMessage: 'Last run' }),
      sortable: (s: SuiteRow) => s.last.started,
      render: (_: unknown, s: SuiteRow) => (
        <span className="agtEvlDim">{formatTime(s.last.started)}</span>
      ),
    },
    {
      field: 'version',
      name: i18n.translate('agentTraces.evals.suites.agentVersion', {
        defaultMessage: 'Agent version',
      }),
      sortable: (s: SuiteRow) => s.last.version ?? '',
      render: (_: unknown, s: SuiteRow) => <VersionBadge version={s.last.version} />,
    },
    {
      field: 'rate',
      name: i18n.translate('agentTraces.evals.suites.lastRate', {
        defaultMessage: 'Pass rate · last run',
      }),
      align: 'right',
      sortable: (s: SuiteRow) => s.last.rate ?? -1,
      render: (_: unknown, s: SuiteRow) => <PassRateCell rate={s.last.rate} />,
    },
    {
      field: 'delta',
      name: i18n.translate('agentTraces.evals.suites.vsRunBefore', {
        defaultMessage: 'vs run before',
      }),
      align: 'right',
      sortable: (s: SuiteRow) => s.delta ?? Number.POSITIVE_INFINITY,
      render: (delta?: number) => <DeltaCell delta={delta} />,
    },
  ];

  return (
    <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
      <SectionTitle
        title={TAB_LABEL.suites}
        count={suites.length}
        sub={i18n.translate('agentTraces.evals.suites.sub', {
          defaultMessage:
            'Suites with a run in the range. Click a suite to see its runs and compare two of them.',
        })}
      />
      {error ? (
        <QueryErrorCallout message={error} />
      ) : (
        <EuiInMemoryTable<SuiteRow>
          items={suites}
          itemId="suite"
          columns={columns}
          loading={loading}
          sorting={{ sort: { field: 'last', direction: 'desc' } }}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          rowProps={(s: SuiteRow) => ({
            className: 'agtEvlClickRow',
            onClick: () => navigate({ page: 'suite', suite: s.suite }),
            'data-test-subj': `agtEvlSuiteRow-${s.suite}`,
          })}
          message={
            loaded && !loading
              ? i18n.translate('agentTraces.evals.suites.empty', {
                  defaultMessage: 'No suite runs in the range.',
                })
              : undefined
          }
          data-test-subj="agtEvlSuitesTable"
        />
      )}
    </EuiPanel>
  );
};

/** One agent: Evaluations, Suites and Results tabs; each tab queries only while shown. */
export const AgentPage: React.FC<{ agent: string; tab: AgentTab }> = ({ agent, tab }) => {
  const { navigate } = useEvalContext();
  const [suiteCount, setSuiteCount] = React.useState<number>();
  return (
    <>
      <EuiTabs size="s">
        {(['evaluations', 'suites', 'results'] as AgentTab[]).map((t) => (
          <EuiTab
            key={t}
            isSelected={tab === t}
            onClick={() => navigate({ page: 'agent', agent, tab: t }, { slice: undefined })}
            data-test-subj={`agtEvlAgentTab-${t}`}
          >
            {TAB_LABEL[t]}
            {t === 'suites' && suiteCount !== undefined && (
              <>
                {' '}
                <EuiNotificationBadge color="subdued">{suiteCount}</EuiNotificationBadge>
              </>
            )}
          </EuiTab>
        ))}
      </EuiTabs>
      <EuiSpacer size="m" />
      {tab === 'evaluations' && <EvaluationsTab agent={agent} />}
      {tab === 'suites' && <SuitesTab agent={agent} onCount={setSuiteCount} />}
      {tab === 'results' && <ResultsView lockAgent={agent} />}
    </>
  );
};
