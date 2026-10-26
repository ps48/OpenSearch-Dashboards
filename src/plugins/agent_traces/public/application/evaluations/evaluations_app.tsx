/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './evaluations.scss';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  EuiErrorBoundary,
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
import { EvalResult } from './eval_data';
import { TimeBoundsMs } from './eval_aggregations';
import {
  APP_STATE_KEY,
  EvalAppState,
  EvalTab,
  compactAppState,
  filtersOf,
  normalizeAppState,
} from './eval_url_state';
import { RESULTS_LIMIT, useEvalData, useRunResults } from './use_eval_data';
import { EvalFiltersBar } from './eval_filters_bar';
import { OverviewTab } from './overview_tab';
import { ResultsTab } from './results_tab';
import { RunsTab } from './runs_tab';
import { ResultFlyout } from './result_flyout';
import { NoEvalIndexPrompt, QueryErrorCallout, TruncationNotice } from './eval_components';
import { openTraceInAgentTraces } from './eval_links';
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
  // The global `_g` state (time range, refresh interval) is shared with the other apps. Start
  // syncing on the first render, so the time range is read from the URL before the first fetch.
  const sync = useRef<{ stop: () => void }>();
  if (!sync.current) sync.current = syncQueryStateWithUrl(services.data.query, storage);
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

  const update = useCallback(
    (patch: Partial<EvalAppState>) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setState(next);
      storage.set(APP_STATE_KEY, compactAppState(next), { replace: true });
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

export const EvaluationsApp: React.FC<{ params: AppMountParameters }> = ({ params }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const [state, setState] = useAppState(params, services);
  const time = useTimeRange(services);
  const filters = useMemo(() => filtersOf(state), [state]);
  const data = useEvalData(services.data, time.bounds, filters, time.refreshKey);
  const runsActive = state.tab === 'runs';
  const runs = useRunResults(services.data, time.bounds, filters, time.refreshKey, runsActive);
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
      runs.results.find((r) => r.id === state.result);
    if (found) setFlyoutResult(found);
  }, [state.result, data.results, runs.results, flyoutResult]);

  const openResult = useCallback(
    (r: EvalResult) => {
      setFlyoutResult(r);
      setState({ result: r.id });
    },
    [setState]
  );

  const counts: Partial<Record<EvalTab, number>> = {
    results: data.results.length,
  };

  const renderTab = () => {
    if (state.tab === 'runs') {
      if (runs.indexMissing) return <NoEvalIndexPrompt />;
      if (runs.error) return <QueryErrorCallout message={runs.error} />;
      if (runs.loading && runs.results.length === 0) return <EuiLoadingContent lines={6} />;
      return (
        <>
          {runs.truncated && <TruncationNotice shown={runs.results.length} />}
          <RunsTab
            results={runs.results}
            compare={state.compare}
            onCompareChange={(compare) => setState({ compare })}
            onOpenTrace={(traceId, aroundMs) =>
              openTraceInAgentTraces(services.application, traceId, aroundMs)
            }
          />
        </>
      );
    }
    if (data.indexMissing) return <NoEvalIndexPrompt />;
    if (data.error) return <QueryErrorCallout message={data.error} />;
    if (data.loading && data.results.length === 0) return <EuiLoadingContent lines={8} />;
    const notice = data.truncated ? (
      <>
        <TruncationNotice shown={RESULTS_LIMIT} total={data.total} />
        <EuiSpacer size="s" />
      </>
    ) : null;
    if (state.tab === 'results') {
      return (
        <>
          {notice}
          <ResultsTab results={data.results} onOpenResult={openResult} />
        </>
      );
    }
    return (
      <>
        {notice}
        <OverviewTab
          results={data.results}
          previous={data.previous}
          bounds={time.bounds}
          onSelectEvaluation={(name) => setState({ names: [name], tab: 'results' })}
          onOpenResult={openResult}
        />
      </>
    );
  };

  const loading = state.tab === 'runs' ? runs.loading : data.loading;
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
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="m" />
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
        </EuiPageBody>
      </EuiPage>
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
    </EuiErrorBoundary>
  );
};
