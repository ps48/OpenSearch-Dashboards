/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './evaluations.scss';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  EuiCallOut,
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
  EuiText,
  EuiTitle,
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
  normalizeAppState,
  runsTimeOf,
} from './eval_url_state';
import {
  useAgentCorePresent,
  useResultsPage,
  useEvalData,
  AGENTCORE_LAG_MS,
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
  formatEvalTime,
} from './eval_components';
import { openTraceInAgentTraces } from './eval_links';
import { getEvalsIndexPattern } from './eval_settings';
import { RunDetailPage } from './run_detail';
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

export const EvaluationsApp: React.FC<{ params: AppMountParameters }> = ({ params }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const [state, setState] = useAppState(params, services);
  const index = getEvalsIndexPattern(services.uiSettings);
  const time = useTimeRange(services);
  const runsTimeValue = runsTimeOf(state);
  const runsTime = useRunsTimeRange(services, runsTimeValue, (next) =>
    setState({
      runsTime:
        next.from === DEFAULT_RUNS_TIME.from && next.to === DEFAULT_RUNS_TIME.to ? undefined : next,
    })
  );
  const filters = useMemo(() => filtersOf(state), [state]);
  const data = useEvalData(
    services.data,
    time.bounds,
    filters,
    time.refreshKey,
    index,
    state.tab === 'results' ? 'results' : 'overview'
  );
  const agentCorePresent = useAgentCorePresent(services.data, index);
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
  const showLagNote =
    state.tab !== 'runs' && agentCorePresent && time.bounds.to > Date.now() - AGENTCORE_LAG_MS;
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
            path: '#/?_a=(ui:(activeTabId:traces,showHistogram:!t))',
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

  useEffect(() => {
    services.chrome.docTitle.change(PAGE_TITLE);
    services.chrome.setBreadcrumbs([{ text: PAGE_TITLE }]);
  }, [services.chrome]);

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
    const lagNote = showLagNote ? (
      <>
        <EuiCallOut
          size="s"
          iconType="clock"
          data-test-subj="agtEvlLagNote"
          title={i18n.translate('agentTraces.evalsPage.lagNote', {
            defaultMessage: 'AgentCore results arrive about 15 minutes after a session ends.',
          })}
        />
        <EuiSpacer size="s" />
      </>
    ) : null;
    const partial = data.current?.truncated ? (
      <>
        <AggregateLimitNotice />
        <EuiSpacer size="s" />
      </>
    ) : null;
    if (state.tab === 'results') {
      return (
        <>
          {lagNote}
          <ResultsTab
            results={resultsPage.rows}
            total={data.total}
            loading={resultsPage.loading}
            error={resultsPage.error}
            beyondLimit={resultsPage.beyondLimit}
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
        {lagNote}
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
        />
      </>
    );
  };

  const loading =
    state.tab === 'runs'
      ? runs.loading || runDetail.loading || compareData.loading || previousDetail.loading
      : data.loading;
  // A json setting: no default override (it would be JSON-parsed).
  const quickRanges = useMemo(
    () =>
      (services.uiSettings.get('timepicker:quickRanges') as QuickRange[] | undefined)?.map(
        ({ from, to, display }) => ({ start: from, end: to, label: display })
      ) ?? [],
    [services.uiSettings]
  );

  return (
    <EuiErrorBoundary>
      <ShowTracesContext.Provider value={showTraces}>
        <EuiPage paddingSize="m" className="agtEvlPage" data-test-subj="agtEvlPage">
          <EuiPageBody>
            <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" wrap>
              <EuiFlexItem grow={false}>
                {/* The new navigation header already shows the app title. */}
                {!services.chrome.navGroup?.getNavGroupEnabled() && (
                  <EuiTitle size="m">
                    <h1>{PAGE_TITLE}</h1>
                  </EuiTitle>
                )}
                <EuiText size="s" color="subdued">
                  <FormattedMessage
                    id="agentTraces.evalsPage.description"
                    defaultMessage="Scores and judgments on your agents' spans, traces and sessions, from online evaluators and offline evaluation runs."
                  />
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                {runsActive ? (
                  <EuiFlexGroup
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
                            hasActiveFilters={
                              runsTime.time.from === r.from && runsTime.time.to === 'now'
                            }
                            onClick={() =>
                              runsTime.onTimeChange({
                                start: r.from,
                                end: 'now',
                              } as OnTimeChangeProps)
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
                )}
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="m" />
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
          </EuiPageBody>
        </EuiPage>
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
      </ShowTracesContext.Provider>
    </EuiErrorBoundary>
  );
};
