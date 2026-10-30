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
import {
  createOsdUrlStateStorage,
  setStateToOsdUrl,
} from '../../../../opensearch_dashboards_utils/public';
import { syncQueryStateWithUrl } from '../../../../data/public';
import { TimeRange } from '../../../../data/common';
import { AGENT_TRACES_NAV_ID } from '../../../common';
import { EvalResult } from './eval_data';
import { ShowTracesContext, TraceCondition, fetchConditionTraces } from './eval_trace_filter';
import { DEFAULT_RESULTS_SORT, RESULTS_PAGE_SIZES, ResultsSort } from './eval_ppl';
import { setEvalTraceFilter } from './eval_trace_filter_store';
import { TimeBoundsMs, previousPeriod } from './eval_aggregations';
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
  useRunResults,
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
import { ComparePage, RunPage } from './eval_run_pages';
import {
  EvalRoute,
  TABS_ROUTE,
  hashWithRoute,
  legacyRouteOf,
  routeOfHash,
  stateForRoute,
} from './eval_routes';
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
  runs: i18n.translate('agentTraces.evalsPage.tabRuns', { defaultMessage: 'Test suites' }),
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
  /** Opens a page (`#/`, `#/runs/<id>`, `#/compare`) with the state patched, `_g` kept. */
  const navigate = useCallback<Navigate>(
    (route, patch = {}, options = {}) => {
      const next = stateForRoute(route, { ...stateRef.current, ...patch });
      stateRef.current = next;
      setState(next);
      const { history } = params;
      const hash = hashWithRoute(history.location.hash, route);
      const url = setStateToOsdUrl(
        APP_STATE_KEY,
        compactAppState(next),
        { useHash: services.uiSettings.get('state:storeInSessionStorage', false) },
        `${window.location.origin}${window.location.pathname}${hash}`
      );
      const location = {
        pathname: history.location.pathname,
        search: history.location.search,
        hash: url.slice(url.indexOf('#')),
      };
      if (options.push) history.push(location);
      else history.replace(location);
    },
    [params, services.uiSettings]
  );
  return [state, update, navigate] as const;
};

type Navigate = (
  route: EvalRoute,
  patch?: Partial<EvalAppState>,
  options?: { push?: boolean }
) => void;

/** The page the URL hash opens, followed as the hash changes. */
const useEvalRoute = (history: AppMountParameters['history']): EvalRoute => {
  const [route, setRoute] = useState<EvalRoute>(() => routeOfHash(history.location.hash));
  useEffect(() => {
    setRoute((prev) => {
      const now = routeOfHash(history.location.hash);
      return isEqual(prev, now) ? prev : now;
    });
    return history.listen((location) =>
      setRoute((prev) => {
        const next = routeOfHash(location.hash);
        return isEqual(prev, next) ? prev : next;
      })
    );
  }, [history]);
  return route;
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
 * What evaluation views do on a click, on every page: show the traces where an evaluation
 * fails (Agent Traces), a chart point's results (the Results tab) or traces, open a session.
 */
const EvalActionsProvider: React.FC<{
  index: string;
  /** The range "Show traces" reads (the global one). */
  bounds: TimeBoundsMs;
  onNavigate: Navigate;
}> = ({ index, bounds, onNavigate, children }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const showTraces = useCallback(
    (condition: TraceCondition) => {
      fetchConditionTraces(
        services.data,
        condition,
        {
          from: new Date(bounds.from).toISOString(),
          to: new Date(bounds.to).toISOString(),
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
    [services, bounds, index]
  );
  // A chart bar or point: the Results tab or Agent Traces for its bucket, evaluation, verdict.
  const chartActions = useMemo<ChartActions>(
    () => ({
      showResults: (p: ChartPoint) => {
        services.data.query.timefilter.timefilter.setTime({
          from: new Date(p.from).toISOString(),
          to: new Date(p.to).toISOString(),
        });
        onNavigate(
          TABS_ROUTE,
          {
            tab: 'results',
            names: p.name ? [p.name] : [],
            verdicts: p.outcome ? [p.outcome] : [],
            failing: false,
            runIds: p.runId ? [p.runId] : [],
            evaluation: undefined,
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
    [services.data.query.timefilter.timefilter, onNavigate, showTraces]
  );
  const openSession = useCallback(
    (sessionId: string, aroundMs: number) =>
      openSessionInAgentTraces(services.application, sessionId, aroundMs),
    [services.application]
  );
  return (
    <ShowTracesContext.Provider value={showTraces}>
      <ChartActionsContext.Provider value={chartActions}>
        <OpenSessionContext.Provider value={openSession}>{children}</OpenSessionContext.Provider>
      </ChartActionsContext.Provider>
    </ShowTracesContext.Provider>
  );
};

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
  onNavigate: Navigate;
  onLoadingChange: (loading: boolean) => void;
}> = ({ index, state, setState, time, runsTime, onNavigate, onLoadingChange }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const filters = useMemo(() => filtersOf(state), [state]);
  // Each tab loads its own data the first time it is opened, and keeps it until the range,
  // a filter or Refresh changes.
  const overviewData = useEvalData(
    services.data,
    time.bounds,
    filters,
    time.refreshKey,
    index,
    'overview',
    state.tab === 'overview'
  );
  const resultsData = useEvalData(
    services.data,
    time.bounds,
    filters,
    time.refreshKey,
    index,
    'results',
    state.tab === 'results'
  );
  const data = state.tab === 'results' ? resultsData : overviewData;
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
  const drilldownName = state.tab === 'overview' ? state.evaluation : undefined;
  const drilldown = useEvaluationResults(
    services.data,
    drilldownName,
    time.bounds,
    filters,
    time.refreshKey,
    index
  );
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
            onCompareChange={(compare, baseline) =>
              compare
                ? onNavigate({ page: 'compare' }, { compare, baseline }, { push: true })
                : undefined
            }
            onOpenTrace={openTrace}
            onOpenRun={(runId) => onNavigate({ page: 'run', runId }, {}, { push: true })}
            onSelectRange={(from) =>
              runsTime.onTimeChange({ start: from, end: 'now' } as OnTimeChangeProps)
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
            selectedId={state.result}
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
          onOpenRun={(runId) => onNavigate({ page: 'run', runId }, {}, { push: true })}
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
          filters={filters}
          index={index}
        />
      </>
    );
  };

  const loading = state.tab === 'runs' ? runs.loading : data.loading;
  useEffect(() => onLoadingChange(loading), [loading, onLoadingChange]);

  return (
    <>
      <EvalFiltersBar state={state} facets={data.facets} onChange={setState} />
      <EuiSpacer size="m" />
      <EuiTabs size="s">
        {(Object.keys(TAB_LABELS) as EvalTab[]).map((tab) => (
          <EuiTab
            key={tab}
            isSelected={state.tab === tab}
            onClick={() => setState({ tab })}
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
          siblings={state.tab === 'results' ? resultsPage.rows : undefined}
        />
      )}
    </>
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
  const [state, setState, navigate] = useAppState(params, services);
  const route = useEvalRoute(params.history);
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
  const runsActive = route.page === 'tabs' && state.tab === 'runs';
  // The run page's title: its suite, once the run is read.
  const [runTitle, setRunTitle] = useState<string>();

  // Links from before the run and compare pages (`_a=(tab:runs,run:'<id>')`, CI jobs and the
  // GitHub Action build them) open those pages; a comparison without runs opens the list.
  useEffect(() => {
    const legacy = legacyRouteOf(route, state);
    if (legacy) navigate(legacy);
    else if (route.page === 'compare' && !state.compare) navigate(TABS_ROUTE, { tab: 'runs' });
  }, [route, state, navigate]);

  const openRunsList = useCallback(
    () => navigate(TABS_ROUTE, { tab: 'runs' }, { push: true }),
    [navigate]
  );

  useEffect(() => {
    const crumbLink = (onOpen: () => void) => ({
      href: '#/',
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        onOpen();
      },
    });
    if (route.page === 'tabs') {
      services.chrome.docTitle.change(PAGE_TITLE);
      services.chrome.setBreadcrumbs([{ text: PAGE_TITLE }]);
      return;
    }
    const last =
      route.page === 'compare'
        ? i18n.translate('agentTraces.evalsPage.crumbCompare', { defaultMessage: 'Compare runs' })
        : (runTitle ?? shortId(route.runId, 24));
    services.chrome.docTitle.change([last, PAGE_TITLE]);
    services.chrome.setBreadcrumbs([
      {
        text: PAGE_TITLE,
        ...crumbLink(() => navigate(TABS_ROUTE, { tab: 'overview' }, { push: true })),
      },
      {
        text: i18n.translate('agentTraces.evalsPage.crumbRuns', {
          defaultMessage: 'Test suites',
        }),
        ...crumbLink(openRunsList),
      },
      { text: last },
    ]);
  }, [services.chrome, route, runTitle, navigate, openRunsList]);

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
      onTimeChange={time.onTimeChange}
      onRefresh={time.onRefresh}
      isLoading={loading}
      dateFormat={services.uiSettings.get('dateFormat')}
      commonlyUsedRanges={quickRanges}
      data-test-subj="agtEvlDatePicker"
    />
  );
  // Without a dataset there is nothing to pick a range for: Settings only.
  // The run and compare pages read their runs by id: no time picker there.
  const controls =
    config && route.page === 'tabs' ? [datePicker, settingsButton] : [settingsButton];
  const openTrace = useCallback(
    (traceId: string, aroundMs: number) =>
      openTraceInAgentTraces(services.application, traceId, aroundMs),
    [services.application]
  );

  const renderPage = (index: string) => {
    if (route.page === 'run') {
      return (
        <RunPage
          key={route.runId}
          index={index}
          runId={route.runId}
          refreshKey={runsTime.refreshKey}
          onBack={openRunsList}
          onOpenRun={(runId) => navigate({ page: 'run', runId }, {}, { push: true })}
          onCompare={(compare) =>
            navigate({ page: 'compare' }, { compare, baseline: undefined }, { push: true })
          }
          onOpenTrace={openTrace}
          onTitle={setRunTitle}
          onLoadingChange={setLoading}
        />
      );
    }
    if (route.page === 'compare') {
      if (!state.compare) return <EuiLoadingContent lines={6} />;
      return (
        <ComparePage
          index={index}
          runIds={state.compare}
          baseline={state.baseline}
          refreshKey={runsTime.refreshKey}
          onChange={(compare, baseline) => setState({ compare, baseline }, { push: true })}
          onBack={openRunsList}
          onOpenTrace={openTrace}
          onLoadingChange={setLoading}
        />
      );
    }
    return (
      <EvaluationsBody
        index={index}
        state={state}
        setState={setState}
        time={time}
        runsTime={runsTime}
        onNavigate={navigate}
        onLoadingChange={setLoading}
      />
    );
  };

  const renderContent = () => {
    if (datasetLoading && !config) return <EuiLoadingContent lines={6} />;
    if (!config) {
      return <NoEvalsDatasetPrompt onGetStarted={openSettings} error={dataset.error} />;
    }
    return (
      <EvalActionsProvider index={config.index} bounds={time.bounds} onNavigate={navigate}>
        {route.page !== 'tabs' && loading && (
          <EuiProgress size="xs" color="accent" position="absolute" />
        )}
        {renderPage(config.index)}
      </EvalActionsProvider>
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
