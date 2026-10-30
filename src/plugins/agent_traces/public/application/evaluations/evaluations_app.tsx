/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './evaluations.scss';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  EuiErrorBoundary,
  EuiFilterButton,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingContent,
  EuiNotificationBadge,
  EuiPage,
  EuiPageBody,
  EuiProgress,
  EuiSpacer,
  EuiSuperDatePicker,
  EuiTab,
  EuiTabs,
  OnRefreshChangeProps,
  OnTimeChangeProps,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { AppMountParameters } from '../../../../../core/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { createOsdUrlStateStorage } from '../../../../opensearch_dashboards_utils/public';
import { syncQueryStateWithUrl } from '../../../../data/public';
import { TimeRange } from '../../../../data/common';
import { AGENT_TRACES_NAV_ID } from '../../../common';
import { EvalResult } from './eval_data';
import { ShowTracesContext, TraceCondition, fetchConditionTraces } from './eval_trace_filter';
import { DEFAULT_RESULTS_SORT, RESULTS_PAGE_SIZES, ResultsSort } from './eval_ppl';
import { setEvalTraceFilter } from './eval_trace_filter_store';
import { TimeBoundsMs, mergeRunData, previousPeriod } from './eval_aggregations';
import {
  APP_STATE_KEY,
  DEFAULT_RUNS_TIME,
  EvalAppState,
  EvalTab,
  compactAppState,
  filtersOf,
  hasActiveFilters,
  normalizeAppState,
  runsTimeOf,
} from './eval_url_state';
import {
  useResultsPage,
  useEvalData,
  errorMessage,
  useEvaluationResults,
  useRunDetail,
  useRunResults,
  useRunsDetail,
} from './use_eval_data';
import { EvalFiltersBar } from './eval_filters_bar';
import { OverviewTab } from './overview_tab';
import { ResultsTab } from './results_tab';
import { RunsTab } from './runs_tab';
import { ResultFlyout } from './result_flyout';
import {
  NoEvalIndexPrompt,
  QueryErrorCallout,
  AggregateLimitNotice,
  PartialLoadNotice,
  formatEvalTime,
  shortId,
} from './eval_components';
import { OpenSessionContext, openSessionInAgentTraces, openTraceInAgentTraces } from './eval_links';
import { useEvalsDataset } from './eval_dataset';
import { EvalSettingsModal } from './eval_settings_modal';
import { EvalHeader, EvalSettingsButton } from './eval_header';
import { LAST_24H, LAST_7D, NoEvalsDatasetPrompt, NoResultsInRange } from './eval_empty_states';
import { RunDetailPage } from './run_detail';
import { ChartActions, ChartActionsContext, ChartPoint } from './eval_charts';
import { EvaluatorDrilldownFlyout } from './evaluator_drilldown';
import type { EvaluationsServices } from '.';

interface QuickRange {
  from: string;
  to: string;
  display: string;
}

const TAB_LABELS: Record<EvalTab, string> = {
  overview: i18n.translate('agentTraces.evalsPage.tabOverview', { defaultMessage: 'Overview' }),
  results: i18n.translate('agentTraces.evalsPage.tabResults', { defaultMessage: 'Results' }),
  runs: i18n.translate('agentTraces.evalsPage.tabRuns', { defaultMessage: 'Evaluation runs' }),
};

/** Quick ranges next to the runs time picker: offline runs are looked at by week or month. */
const RUNS_QUICK_RANGES = [
  {
    from: 'now-7d',
    label: i18n.translate('agentTraces.evalsPage.runs7d', { defaultMessage: '7 days' }),
  },
  {
    from: 'now-30d',
    label: i18n.translate('agentTraces.evalsPage.runs30d', { defaultMessage: '30 days' }),
  },
];

/** A trace precedes its grades (AgentCore: up to about 15 minutes): open an hour earlier. */
export const traceTimeOf = ({ from, to }: { from: number; to: number }) =>
  `(time:(from:'${new Date(from - 3600 * 1000).toISOString()}',to:'${new Date(to).toISOString()}'))`;

const PAGE_TITLE = i18n.translate('agentTraces.evalsPage.title', {
  defaultMessage: 'Agent Evaluations',
});

/** State update keeping the previous object for an equal range, so it does not refetch. */
const sameTime = (next: TimeRange) => (prev: TimeRange) =>
  prev.from === next.from && prev.to === next.to ? prev : next;

/** Page state synced with `_a` in the URL hash (replace, so filters do not flood history). */
const useAppState = (params: AppMountParameters, services: EvaluationsServices) => {
  const storage = useMemo(
    () =>
      createOsdUrlStateStorage({
        history: params.history,
        useHash: services.uiSettings.get('state:storeInSessionStorage', false),
      }),
    [params.history, services.uiSettings]
  );
  // The global `_g` state (time range, refresh interval) is shared with the other apps, as in
  // Explore and Agent Traces: the range carries over between apps, a link's `_g` wins, and
  // without either it is the `timepicker:timeDefaults` setting (the last 15 minutes). Start
  // syncing on the first render, so the range is read from the URL before the first fetch.
  const sync = useRef<{ stop: () => void }>();
  if (!sync.current) {
    sync.current = syncQueryStateWithUrl(services.data.query, storage);
  }
  const [state, setState] = useState<EvalAppState>(() =>
    normalizeAppState(storage.get(APP_STATE_KEY))
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!sync.current) sync.current = syncQueryStateWithUrl(services.data.query, storage);
    const subscription = storage.change$<unknown>(APP_STATE_KEY).subscribe((raw) => {
      const next = normalizeAppState(raw);
      if (!isEqual(next, stateRef.current)) setState(next);
    });
    return () => {
      subscription.unsubscribe();
      sync.current?.stop();
      sync.current = undefined;
    };
  }, [storage, services.data.query]);

  /** `push` adds a history entry (opening a run or a comparison), so Back returns. */
  const update = useCallback(
    (patch: Partial<EvalAppState>, options: { push?: boolean } = {}) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setState(next);
      storage.set(APP_STATE_KEY, compactAppState(next), { replace: !options.push });
    },
    [storage]
  );
  return [state, update] as const;
};

/** The global time range, its absolute bounds and a refresh counter. */
const useTimeRange = (services: EvaluationsServices) => {
  const timefilter = services.data.query.timefilter.timefilter;
  const [time, setTime] = useState(() => timefilter.getTime());
  const [refreshInterval, setRefreshInterval] = useState(() => timefilter.getRefreshInterval());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const subscriptions = [
      timefilter.getTimeUpdate$().subscribe(() => setTime(sameTime(timefilter.getTime()))),
      timefilter
        .getRefreshIntervalUpdate$()
        .subscribe(() => setRefreshInterval(timefilter.getRefreshInterval())),
      timefilter.getAutoRefreshFetch$().subscribe(() => setRefreshKey((k) => k + 1)),
    ];
    // The time may have changed before these subscriptions existed.
    setTime(sameTime(timefilter.getTime()));
    setRefreshInterval(timefilter.getRefreshInterval());
    return () => subscriptions.forEach((s) => s.unsubscribe());
  }, [timefilter]);

  // Relative ranges (now-24h) are resolved again on every refresh.
  const bounds = useMemo<TimeBoundsMs>(() => {
    const b = timefilter.calculateBounds(time);
    return {
      from: b.min?.valueOf() ?? Date.now() - 24 * 3600 * 1000,
      to: b.max?.valueOf() ?? Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, refreshKey, timefilter]);

  return {
    time,
    bounds,
    refreshKey,
    refreshInterval,
    onTimeChange: ({ start, end }: OnTimeChangeProps) =>
      timefilter.setTime({ from: start, to: end }),
    onRefresh: () => setRefreshKey((k) => k + 1),
    onRefreshChange: ({ isPaused, refreshInterval: value }: OnRefreshChangeProps) =>
      timefilter.setRefreshInterval({ pause: isPaused, value }),
  };
};

/**
 * The runs tab's own time range (in `_a`, default last 7 days): offline runs happen a few
 * times a day, so they need a longer window than online results.
 */
const useRunsTimeRange = (
  services: EvaluationsServices,
  time: TimeRange,
  onChange: (time: TimeRange) => void
) => {
  const timefilter = services.data.query.timefilter.timefilter;
  const [refreshKey, setRefreshKey] = useState(0);
  const bounds = useMemo<TimeBoundsMs>(() => {
    const b = timefilter.calculateBounds(time);
    return {
      from: b.min?.valueOf() ?? Date.now() - 7 * 24 * 3600 * 1000,
      to: b.max?.valueOf() ?? Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time.from, time.to, refreshKey, timefilter]);
  return {
    time,
    bounds,
    refreshKey,
    onTimeChange: ({ start, end }: OnTimeChangeProps) => {
      onChange({ from: start, to: end });
      setRefreshKey((k) => k + 1);
    },
    onRefresh: () => setRefreshKey((k) => k + 1),
  };
};

const formatScope = (bounds: TimeBoundsMs) =>
  i18n.translate('agentTraces.evalsPage.scopeRange', {
    defaultMessage: '{from} to {to}',
    values: {
      from: formatEvalTime(bounds.from, 'MMM D, HH:mm'),
      to: formatEvalTime(bounds.to, 'MMM D, HH:mm'),
    },
  });

type AppStateUpdate = (patch: Partial<EvalAppState>, options?: { push?: boolean }) => void;

/**
 * The tabs, the filter bar and everything that queries the evaluations dataset: mounted once
 * the dataset is known, so no query runs against a guessed index.
 */
const EvaluationsBody: React.FC<{
  index: string;
  state: EvalAppState;
  setState: AppStateUpdate;
  time: ReturnType<typeof useTimeRange>;
  runsTime: ReturnType<typeof useRunsTimeRange>;
  onLoadingChange: (loading: boolean) => void;
}> = ({ index, state, setState, time, runsTime, onLoadingChange }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const filters = useMemo(() => filtersOf(state), [state]);
  const data = useEvalData(
    services.data,
    time.bounds,
    filters,
    time.refreshKey,
    index,
    state.tab === 'results' ? 'results' : 'overview'
  );
  // Results table: sorted and paged in the query; a new range or filter starts on page 1.
  const [resultsSort, setResultsSort] = useState<ResultsSort>(DEFAULT_RESULTS_SORT);
  const [resultsPageAt, setResultsPageAt] = useState({
    index: 0,
    size: RESULTS_PAGE_SIZES[0],
  });
  const filtersKey = JSON.stringify([filters, time.bounds]);
  useEffect(() => setResultsPageAt((p) => (p.index === 0 ? p : { ...p, index: 0 })), [filtersKey]);
  const resultsPage = useResultsPage(
    services.data,
    time.bounds,
    filters,
    time.refreshKey,
    index,
    resultsSort,
    resultsPageAt.index,
    resultsPageAt.size,
    state.tab === 'results'
  );
  const showTraces = useCallback(
    (condition: TraceCondition) => {
      fetchConditionTraces(
        services.data,
        condition,
        {
          from: new Date(time.bounds.from).toISOString(),
          to: new Date(time.bounds.to).toISOString(),
        },
        index
      )
        .then((filter) => {
          setEvalTraceFilter(filter);
          services.application.navigateToApp(AGENT_TRACES_NAV_ID, {
            path: `#/?_a=(ui:(activeTabId:traces,showHistogram:!t))${
              condition.timeRange ? `&_g=${traceTimeOf(condition.timeRange)}` : ''
            }`,
          });
        })
        .catch((error) =>
          services.notifications.toasts.addDanger({
            title: i18n.translate('agentTraces.evalsPage.showTracesError', {
              defaultMessage: 'Could not list the traces',
            }),
            text: errorMessage(error),
          })
        );
    },
    [services, time.bounds, index]
  );
  // A chart bar or point: the Results tab or Agent Traces for its bucket, evaluation, verdict.
  const chartActions = useMemo<ChartActions>(
    () => ({
      showResults: (p: ChartPoint) => {
        services.data.query.timefilter.timefilter.setTime({
          from: new Date(p.from).toISOString(),
          to: new Date(p.to).toISOString(),
        });
        setState(
          {
            tab: 'results',
            names: p.name ? [p.name] : [],
            verdicts: p.outcome ? [p.outcome] : [],
            failing: false,
            runIds: p.runId ? [p.runId] : [],
            evaluation: undefined,
            run: undefined,
            compare: undefined,
          },
          { push: true }
        );
      },
      showTraces: (p: ChartPoint) =>
        showTraces({
          kind: 'results',
          name: p.name,
          outcome: p.outcome,
          runId: p.runId,
          timeRange: { from: p.from, to: p.to },
        }),
    }),
    [services.data.query.timefilter.timefilter, setState, showTraces]
  );
  const runsActive = state.tab === 'runs';
  // "Needs attention" names the most regressed run in the Overview's range.
  const overviewRuns = useRunResults(
    services.data,
    time.bounds,
    filters,
    time.refreshKey,
    state.tab === 'overview',
    index
  );
  const runs = useRunResults(
    services.data,
    runsTime.bounds,
    filters,
    runsTime.refreshKey,
    runsActive,
    index
  );
  const runDetail = useRunDetail(
    services.data,
    runsActive ? state.run : undefined,
    runsTime.refreshKey,
    index
  );
  // The run page compares cases with the previous run of the suite: read that run too.
  const previousRunId = state.run
    ? runs.runs.find((r) => r.runId === state.run)?.previousRunId
    : undefined;
  const previousDetail = useRunsDetail(
    services.data,
    runsActive && state.run && !state.compare && previousRunId ? [previousRunId] : undefined,
    runsTime.refreshKey,
    index
  );
  const runData = useMemo(
    () => mergeRunData(previousDetail, state.run ? runDetail : undefined),
    [previousDetail, runDetail, state.run]
  );
  const drilldownName = state.tab === 'overview' ? state.evaluation : undefined;
  const drilldown = useEvaluationResults(
    services.data,
    drilldownName,
    time.bounds,
    filters,
    time.refreshKey,
    index
  );
  const compareData = useRunsDetail(
    services.data,
    runsActive ? state.compare : undefined,
    runsTime.refreshKey,
    index
  );
  const runPageOpen = runsActive && !!state.run && !state.compare;
  const [flyoutResult, setFlyoutResult] = useState<EvalResult | undefined>();

  // A shared link may name a result: open it once it is loaded.
  useEffect(() => {
    if (!state.result) {
      setFlyoutResult(undefined);
      return;
    }
    if (flyoutResult?.id === state.result) return;
    const found =
      data.results.find((r) => r.id === state.result) ??
      resultsPage.rows.find((r) => r.id === state.result) ??
      runs.results.find((r) => r.id === state.result);
    if (found) setFlyoutResult(found);
  }, [state.result, data.results, resultsPage.rows, runs.results, flyoutResult]);

  const openResult = useCallback(
    (r: EvalResult) => {
      setFlyoutResult(r);
      setState({ result: r.id });
    },
    [setState]
  );

  const counts: Partial<Record<EvalTab, number>> = {
    results: data.total,
  };

  const openTrace = useCallback(
    (traceId: string, aroundMs: number) =>
      openTraceInAgentTraces(services.application, traceId, aroundMs),
    [services.application]
  );
  const openSession = useCallback(
    (sessionId: string, aroundMs: number) =>
      openSessionInAgentTraces(services.application, sessionId, aroundMs),
    [services.application]
  );

  // Empty states: one click to a wider range, or to no filters.
  const selectRange = useCallback(
    (from: string) => services.data.query.timefilter.timefilter.setTime({ from, to: 'now' }),
    [services.data.query.timefilter.timefilter]
  );
  const filtersActive = hasActiveFilters(state);
  const clearFilters = useCallback(
    () =>
      setState({
        names: [],
        levels: [],
        sources: [],
        failing: false,
        verdicts: [],
        runIds: [],
        q: '',
      }),
    [setState]
  );

  const renderTab = () => {
    if (state.tab === 'runs') {
      if (runs.indexMissing) return <NoEvalIndexPrompt index={index} />;
      if (runPageOpen && state.run) {
        return (
          <RunDetailPage
            runId={state.run}
            results={runData.results}
            events={runData.events}
            runs={runs.runs}
            loading={runDetail.loading || runs.loading}
            error={runDetail.error}
            onBack={() => setState({ run: undefined }, { push: true })}
            onOpenRun={(run) => setState({ run }, { push: true })}
            onCompare={(compare) => setState({ compare, baseline: undefined }, { push: true })}
            onOpenTrace={openTrace}
          />
        );
      }
      if (runs.error) return <QueryErrorCallout message={runs.error} />;
      if (runs.loading && runs.runs.length === 0) return <EuiLoadingContent lines={6} />;
      return (
        <>
          <PartialLoadNotice warnings={runs.warnings} />
          {runs.truncated && (
            <>
              <AggregateLimitNotice />
              <EuiSpacer size="s" />
            </>
          )}
          <RunsTab
            runs={runs.runs}
            compare={state.compare}
            baseline={state.baseline}
            compareData={compareData}
            onCompareChange={(compare, baseline) =>
              setState({ compare, baseline: compare ? baseline : undefined }, { push: true })
            }
            onOpenTrace={openTrace}
            onOpenRun={(run) => setState({ run, compare: undefined }, { push: true })}
            onSelectRange={(from) =>
              runsTime.onTimeChange({ start: from, end: 'now' } as OnTimeChangeProps)
            }
            backLabel={
              state.run
                ? i18n.translate('agentTraces.evalsPage.backToRun', {
                    defaultMessage: 'Run {runId}',
                    values: { runId: state.run },
                  })
                : undefined
            }
          />
        </>
      );
    }
    if (data.indexMissing) return <NoEvalIndexPrompt index={index} />;
    if (data.error) return <QueryErrorCallout message={data.error} />;
    if (data.loading && !data.current) return <EuiLoadingContent lines={8} />;
    const partial = (
      <>
        <PartialLoadNotice warnings={data.warnings} />
        {data.current?.truncated ? (
          <>
            <AggregateLimitNotice />
            <EuiSpacer size="s" />
          </>
        ) : null}
      </>
    );
    if (state.tab === 'results') {
      if (data.total === 0 && !data.loading) {
        return (
          <>
            <NoResultsInRange
              ranges={[LAST_24H, LAST_7D]}
              onSelectRange={selectRange}
              onClearFilters={filtersActive ? clearFilters : undefined}
            />
          </>
        );
      }
      return (
        <>
          <PartialLoadNotice warnings={data.warnings} />
          <ResultsTab
            results={resultsPage.rows}
            total={data.total}
            loading={resultsPage.loading}
            error={resultsPage.error}
            sort={resultsSort}
            pageIndex={resultsPageAt.index}
            pageSize={resultsPageAt.size}
            onTableChange={({ sort, pageIndex, pageSize }) => {
              setResultsSort(sort);
              setResultsPageAt({ index: pageIndex, size: pageSize });
            }}
            onOpenResult={openResult}
          />
        </>
      );
    }
    if (!data.current) return null;
    return (
      <>
        {partial}
        <OverviewTab
          current={data.current}
          previous={data.previous}
          failures={data.results}
          bounds={time.bounds}
          interval={data.interval}
          onSelectEvaluation={(name) => setState({ evaluation: name })}
          onOpenResult={openResult}
          runs={overviewRuns.runs}
          onOpenRun={(run) => setState({ tab: 'runs', run, compare: undefined }, { push: true })}
          onShowPrevious={(name) => {
            const before = previousPeriod(time.bounds);
            services.data.query.timefilter.timefilter.setTime({
              from: new Date(before.from).toISOString(),
              to: new Date(before.to).toISOString(),
            });
            setState({ evaluation: name });
          }}
          onSelectRange={selectRange}
          onClearFilters={filtersActive ? clearFilters : undefined}
        />
      </>
    );
  };

  const loading =
    state.tab === 'runs'
      ? runs.loading || runDetail.loading || compareData.loading || previousDetail.loading
      : data.loading;
  useEffect(() => onLoadingChange(loading), [loading, onLoadingChange]);

  return (
    <ShowTracesContext.Provider value={showTraces}>
      <ChartActionsContext.Provider value={chartActions}>
        <OpenSessionContext.Provider value={openSession}>
          {!runPageOpen && (
            <>
              <EvalFiltersBar state={state} facets={data.facets} onChange={setState} />
              <EuiSpacer size="m" />
            </>
          )}
          <EuiTabs size="s">
            {(Object.keys(TAB_LABELS) as EvalTab[]).map((tab) => (
              <EuiTab
                key={tab}
                isSelected={state.tab === tab}
                onClick={() =>
                  setState(
                    tab === state.tab && tab === 'runs'
                      ? { run: undefined, compare: undefined, baseline: undefined }
                      : { tab }
                  )
                }
                data-test-subj={`agtEvlTab-${tab}`}
              >
                {TAB_LABELS[tab]}
                {counts[tab] !== undefined && !data.loading && (
                  <>
                    {' '}
                    <EuiNotificationBadge color="subdued">{counts[tab]}</EuiNotificationBadge>
                  </>
                )}
              </EuiTab>
            ))}
          </EuiTabs>
          <div className="agtEvlPage__tabBody">
            {loading && <EuiProgress size="xs" color="accent" position="absolute" />}
            <EuiSpacer size="m" />
            {renderTab()}
          </div>
          {drilldownName && !flyoutResult && (
            <EvaluatorDrilldownFlyout
              name={drilldownName}
              results={drilldown.results}
              loading={drilldown.loading}
              error={drilldown.error}
              scope={formatScope(time.bounds)}
              bounds={time.bounds}
              onClose={() => setState({ evaluation: undefined })}
              onOpenResult={openResult}
              onOpenTrace={openTrace}
              onViewAllResults={() =>
                setState({ names: [drilldownName], tab: 'results', evaluation: undefined })
              }
            />
          )}
          {flyoutResult && (
            <ResultFlyout
              result={flyoutResult}
              onClose={() => {
                setFlyoutResult(undefined);
                setState({ result: undefined });
              }}
              onOpenResult={openResult}
            />
          )}
        </OpenSessionContext.Provider>
      </ChartActionsContext.Provider>
    </ShowTracesContext.Provider>
  );
};

const DESCRIPTION = (
  <FormattedMessage
    id="agentTraces.evalsPage.description"
    defaultMessage="Scores and judgments on your agents' spans, traces and sessions, from online evaluators and offline evaluation runs."
  />
);

export const EvaluationsApp: React.FC<{ params: AppMountParameters }> = ({ params }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const [state, setState] = useAppState(params, services);
  const time = useTimeRange(services);
  const runsTimeValue = runsTimeOf(state);
  const runsTime = useRunsTimeRange(services, runsTimeValue, (next) =>
    setState({
      runsTime:
        next.from === DEFAULT_RUNS_TIME.from && next.to === DEFAULT_RUNS_TIME.to ? undefined : next,
    })
  );
  // The evaluations dataset from the workspace's config, read again on every visit to the page.
  const dataset = useEvalsDataset({ force: true });
  const datasetLoading =
    !dataset.unavailable && (dataset.status === 'idle' || dataset.status === 'loading');
  const config = dataset.config;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const runsActive = state.tab === 'runs';

  useEffect(() => {
    services.chrome.docTitle.change(PAGE_TITLE);
    const runCrumb =
      runsActive && (state.run || state.compare)
        ? [
            {
              text: state.compare
                ? i18n.translate('agentTraces.evalsPage.crumbCompare', {
                    defaultMessage: 'Compare runs',
                  })
                : i18n.translate('agentTraces.evalsPage.crumbRun', {
                    defaultMessage: 'Run {runId}',
                    values: { runId: shortId(state.run ?? '', 16) },
                  }),
            },
          ]
        : [];
    services.chrome.setBreadcrumbs([
      {
        text: PAGE_TITLE,
        ...(runCrumb.length
          ? {
              onClick: (e: React.MouseEvent) => {
                e.preventDefault();
                setState(
                  { tab: 'runs', run: undefined, compare: undefined, baseline: undefined },
                  { push: true }
                );
              },
              href: '#',
            }
          : {}),
      },
      ...runCrumb,
    ]);
  }, [services.chrome, runsActive, state.run, state.compare, setState]);

  // A json setting: no default override (it would be JSON-parsed).
  const quickRanges = useMemo(
    () =>
      (services.uiSettings.get('timepicker:quickRanges') as QuickRange[] | undefined)?.map(
        ({ from, to, display }) => ({ start: from, end: to, label: display })
      ) ?? [],
    [services.uiSettings]
  );

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const settingsButton = <EvalSettingsButton key="settings" onClick={openSettings} />;
  // On the Runs tab the header holds the runs' own range (7 / 30 days and a picker), else
  // the global range shared with Explore and Agent Traces.
  const datePicker = runsActive ? (
    <EuiFlexGroup
      key="runsTime"
      gutterSize="s"
      alignItems="center"
      responsive={false}
      data-test-subj="agtEvlRunsTimePicker"
    >
      <EuiFlexItem grow={false}>
        <EuiFilterGroup>
          {RUNS_QUICK_RANGES.map((r) => (
            <EuiFilterButton
              key={r.from}
              hasActiveFilters={runsTime.time.from === r.from && runsTime.time.to === 'now'}
              onClick={() =>
                runsTime.onTimeChange({ start: r.from, end: 'now' } as OnTimeChangeProps)
              }
              data-test-subj={`agtEvlRunsRange-${r.from}`}
            >
              {r.label}
            </EuiFilterButton>
          ))}
        </EuiFilterGroup>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiSuperDatePicker
          compressed
          start={runsTime.time.from}
          end={runsTime.time.to}
          onTimeChange={runsTime.onTimeChange}
          onRefresh={runsTime.onRefresh}
          isLoading={loading}
          dateFormat={services.uiSettings.get('dateFormat')}
          commonlyUsedRanges={quickRanges}
          data-test-subj="agtEvlRunsDatePicker"
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  ) : (
    <EuiSuperDatePicker
      key="time"
      compressed
      start={time.time.from}
      end={time.time.to}
      isPaused={time.refreshInterval.pause}
      refreshInterval={time.refreshInterval.value}
      onTimeChange={time.onTimeChange}
      onRefresh={time.onRefresh}
      onRefreshChange={time.onRefreshChange}
      isLoading={loading}
      dateFormat={services.uiSettings.get('dateFormat')}
      commonlyUsedRanges={quickRanges}
      data-test-subj="agtEvlDatePicker"
    />
  );
  // Without a dataset there is nothing to pick a range for: Settings only.
  const controls = config ? [datePicker, settingsButton] : [settingsButton];

  const renderContent = () => {
    if (datasetLoading && !config) return <EuiLoadingContent lines={6} />;
    if (!config) {
      return <NoEvalsDatasetPrompt onGetStarted={openSettings} error={dataset.error} />;
    }
    return (
      <EvaluationsBody
        index={config.index}
        state={state}
        setState={setState}
        time={time}
        runsTime={runsTime}
        onLoadingChange={setLoading}
      />
    );
  };

  return (
    <EuiErrorBoundary>
      <EuiPage paddingSize="m" className="agtEvlPage" data-test-subj="agtEvlPage">
        <EuiPageBody>
          <EvalHeader title={PAGE_TITLE} description={DESCRIPTION} controls={controls} />
          {!services.chrome.navGroup?.getNavGroupEnabled() && <EuiSpacer size="m" />}
          {renderContent()}
        </EuiPageBody>
      </EuiPage>
      {settingsOpen && (
        <EvalSettingsModal
          config={config}
          configId={dataset.configId}
          workspaceId={dataset.workspaceId}
          onClose={(saved) => {
            setSettingsOpen(false);
            if (saved) dataset.refresh();
          }}
        />
      )}
    </EuiErrorBoundary>
  );
};
