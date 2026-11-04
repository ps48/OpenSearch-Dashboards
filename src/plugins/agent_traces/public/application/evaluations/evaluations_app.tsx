/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './evaluations.scss';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  EuiButtonEmpty,
  EuiEmptyPrompt,
  EuiErrorBoundary,
  EuiLoadingContent,
  EuiPage,
  EuiPageBody,
  EuiSpacer,
  EuiSuperDatePicker,
  EuiTab,
  EuiTabs,
  OnTimeChangeProps,
  prettyDuration,
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
import { EvalResult, parseTime } from './eval_model';
import {
  AGENTS_ROUTE,
  APP_STATE_KEY,
  EvalAppState,
  EvalRoute,
  hashOfRoute,
  normalizeAppState,
  routeOfHash,
} from './eval_routes';
import { EvalContext, EvalScreenContext } from './eval_context';
import { evalsDataset, evalsLookupDataset, spansDataset, usePplRows } from './use_ppl_rows';
import { buildRunWindowQuery } from './eval_ppl';
import {
  EvalsDatasetConfig,
  evalsDataSourceOf,
  spansDataSourceOf,
  spansIndexOf,
  useEvalsDataset,
} from './eval_dataset';
import {
  openSessionInAgentTraces,
  openTraceInAgentTraces,
  targetHref,
  targetOf,
} from './eval_links';
import { EvalSettingsModal } from './eval_settings_modal';
import { EvalGettingStartedButton, EvalHeader, EvalSettingsButton } from './eval_header';
import { GettingStartedModal } from './eval_onboarding';
import { EvalSetupWizard } from './eval_setup_wizard';
import { takeHashParam } from '../pages/traces/deep_link';
import { NoEvalsDatasetPrompt } from './eval_empty_states';
import { QueryErrorCallout, agentLabel, shortId } from './eval_components';
import { useEvalTimezone } from './eval_time';
import { AgentsHome } from './agents_home';
import { AgentPage } from './agent_page';
import { SuitePage } from './suite_page';
import { RunPage } from './run_page';
import { CompareRuns } from './compare_runs';
import { ResultsView } from './results_view';
import { ResultFlyout } from './result_flyout';
import type { EvaluationsServices } from '.';

interface QuickRange {
  from: string;
  to: string;
  display: string;
}

const PAGE_TITLE = i18n.translate('agentTraces.evalsPage.title', {
  defaultMessage: 'Agent evaluations',
});
const CRUMB_HOME = i18n.translate('agentTraces.evalsPage.crumbEvaluations', {
  defaultMessage: 'Evaluations',
});

/** Page state in `_a` (replace: filters do not flood history), screens in the hash path. */
const useAppState = (params: AppMountParameters, services: EvaluationsServices) => {
  const useHash = services.uiSettings.get('state:storeInSessionStorage', false);
  const storage = useMemo(
    () => createOsdUrlStateStorage({ history: params.history, useHash }),
    [params.history, useHash]
  );
  // The global `_g` state (time range) is shared with the other apps; read before the first fetch.
  const sync = useRef<{ stop: () => void }>();
  if (!sync.current) sync.current = syncQueryStateWithUrl(services.data.query, storage);
  const [state, setStateValue] = useState<EvalAppState>(() =>
    normalizeAppState(storage.get(APP_STATE_KEY))
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!sync.current) sync.current = syncQueryStateWithUrl(services.data.query, storage);
    const subscription = storage.change$<unknown>(APP_STATE_KEY).subscribe((raw) => {
      const next = normalizeAppState(raw);
      if (!isEqual(next, stateRef.current)) setStateValue(next);
    });
    return () => {
      subscription.unsubscribe();
      sync.current?.stop();
      sync.current = undefined;
    };
  }, [storage, services.data.query]);

  const setState = useCallback(
    (patch: Partial<EvalAppState>) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setStateValue(next);
      storage.set(APP_STATE_KEY, next, { replace: true });
    },
    [storage]
  );

  /** Opens a screen (a history entry, so Back returns), `_g` kept, `_a` patched. */
  const navigate = useCallback(
    (route: EvalRoute, patch: Partial<EvalAppState> = {}) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setStateValue(next);
      const { history } = params;
      const hash = hashOfRoute(route, history.location.hash);
      const url = setStateToOsdUrl(
        APP_STATE_KEY,
        next,
        { useHash },
        `${window.location.origin}${window.location.pathname}${hash}`
      );
      history.push({
        pathname: history.location.pathname,
        search: history.location.search,
        hash: url.slice(url.indexOf('#')),
      });
    },
    [params, useHash]
  );
  return { state, setState, navigate };
};

const useEvalRoute = (history: AppMountParameters['history']): EvalRoute => {
  const [route, setRoute] = useState<EvalRoute>(() => routeOfHash(history.location.hash));
  useEffect(
    () =>
      history.listen((location) =>
        setRoute((prev) => {
          const next = routeOfHash(location.hash);
          return isEqual(prev, next) ? prev : next;
        })
      ),
    [history]
  );
  return route;
};

const sameTime = (next: TimeRange) => (prev: TimeRange) =>
  prev.from === next.from && prev.to === next.to ? prev : next;

/** The global range, resolved to absolute bounds on every change and Refresh. */
const useTimeRange = (services: EvaluationsServices) => {
  const timefilter = services.data.query.timefilter.timefilter;
  const [time, setTime] = useState(() => timefilter.getTime());
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const subscription = timefilter
      .getTimeUpdate$()
      .subscribe(() => setTime(sameTime(timefilter.getTime())));
    setTime(sameTime(timefilter.getTime()));
    return () => subscription.unsubscribe();
  }, [timefilter]);
  const resolved = useMemo(() => {
    const b = timefilter.calculateBounds(time);
    const from = b.min?.valueOf() ?? Date.now() - 24 * 3600e3;
    const to = b.max?.valueOf() ?? Date.now();
    return {
      timeRange: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      rangeMs: to - from,
    };
    // Refresh resolves relative ranges (now-24h) again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, refreshKey, timefilter]);
  return {
    time,
    ...resolved,
    refreshKey,
    onTimeChange: ({ start, end }: OnTimeChangeProps) =>
      timefilter.setTime({ from: start, to: end }),
    onRefresh: () => setRefreshKey((k) => k + 1),
  };
};

const titleOf = (route: EvalRoute): string => {
  switch (route.page) {
    case 'agent':
      return agentLabel(route.agent);
    case 'suite':
      return route.suite;
    case 'run':
      return i18n.translate('agentTraces.evalsPage.runTitle', {
        defaultMessage: 'Run {id}',
        values: { id: shortId(route.runId) },
      });
    case 'compare':
      return i18n.translate('agentTraces.evalsPage.compareTitle', {
        defaultMessage: 'Compare runs',
      });
    default:
      return PAGE_TITLE;
  }
};

/** Agents and Results: the home's two tabs. */
const HomeTabs: React.FC<{ route: EvalRoute }> = ({ route }) => {
  const { navigate } = React.useContext(EvalContext);
  return (
    <EuiTabs size="s">
      <EuiTab
        isSelected={route.page === 'agents'}
        onClick={() => navigate(AGENTS_ROUTE)}
        data-test-subj="agtEvlHomeTab-agents"
      >
        {i18n.translate('agentTraces.evalsPage.tabAgents', { defaultMessage: 'Agents' })}
      </EuiTab>
      <EuiTab
        isSelected={route.page === 'results'}
        onClick={() => navigate({ page: 'results' })}
        data-test-subj="agtEvlHomeTab-results"
      >
        {i18n.translate('agentTraces.evalsPage.tabResults', { defaultMessage: 'Results' })}
      </EuiTab>
    </EuiTabs>
  );
};

export const EvalScreen: React.FC<{ route: EvalRoute }> = ({ route }) => {
  switch (route.page) {
    case 'agent':
      return <AgentPage key={route.agent} agent={route.agent} tab={route.tab} />;
    case 'suite':
      return <SuitePage key={route.suite} suite={route.suite} />;
    case 'run':
      return <RunPage key={route.runId} runId={route.runId} />;
    case 'compare':
      return (
        <CompareRuns key={`${route.runA}|${route.runB}`} runA={route.runA} runB={route.runB} />
      );
    case 'results':
      return (
        <>
          <HomeTabs route={route} />
          <EuiSpacer size="m" />
          <ResultsView />
        </>
      );
    default:
      return (
        <>
          <HomeTabs route={route} />
          <EuiSpacer size="m" />
          <AgentsHome />
        </>
      );
  }
};

/** Padding around a run's results: its traces start a little before its first result. */
export const RUN_WINDOW_PAD_MS = 15 * 60e3;

/** How far before a run the run and compare pages look for other runs of its suite. */
export const RUN_LOOKBACK_MS = 30 * 24 * 3600e3;

/** The runs a page shows (run and compare pages), else none. */
export const runsOfRoute = (route: EvalRoute): string[] =>
  route.page === 'run' ? [route.runId] : route.page === 'compare' ? [route.runA, route.runB] : [];

/**
 * The run and compare pages read the runs' own window (first to last result, padded), found
 * with one filtered single-row query; other pages read the global range.
 */
const useRunWindow = (
  config: EvalsDatasetConfig | undefined,
  runIds: string[],
  refreshKey: number
): { window?: TimeRange; loading: boolean; missing: boolean; error?: string } => {
  const dataset = useMemo(
    () => (config ? evalsLookupDataset(config.index, evalsDataSourceOf(config)) : undefined),
    [config]
  );
  const query = config && runIds.length ? buildRunWindowQuery(config.index, runIds) : undefined;
  const { rows, loading, loaded, error } = usePplRows(dataset, query, undefined, refreshKey);
  const first = parseTime(rows[0]?.first);
  const last = parseTime(rows[0]?.last);
  const window =
    Number.isFinite(first) && Number.isFinite(last)
      ? {
          from: new Date(first - RUN_WINDOW_PAD_MS).toISOString(),
          to: new Date(last + RUN_WINDOW_PAD_MS).toISOString(),
        }
      : undefined;
  return { window, loading: !!query && !loaded, missing: !!query && loaded && !window, error };
};

export const EvaluationsApp: React.FC<{ params: AppMountParameters }> = ({ params }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  useEvalTimezone(services.uiSettings);
  const { state, setState, navigate } = useAppState(params, services);
  const route = useEvalRoute(params.history);
  const time = useTimeRange(services);
  const dataset = useEvalsDataset({ force: true });
  const datasetLoading =
    !dataset.unavailable && (dataset.status === 'idle' || dataset.status === 'loading');
  const config = dataset.config;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const [result, setResult] = useState<EvalResult>();

  // A new screen closes the result flyout.
  useEffect(() => setResult(undefined), [route]);

  // The nav popover's Settings: `openSettings=true` in the hash query, taken on any navigation
  // (also when the app is already open).
  useEffect(() => {
    const check = () => {
      if (takeHashParam('openSettings')) setSettingsOpen(true);
    };
    check();
    return params.history.listen(check);
  }, [params.history]);

  // A new range drops the chart slice (the slice belongs to the range it was clicked in).
  const firstTime = useRef(true);
  useEffect(() => {
    if (firstTime.current) {
      firstTime.current = false;
      return;
    }
    if (state.slice) setState({ slice: undefined });
    // Only a range change clears the slice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time.time.from, time.time.to]);

  const hrefOf = useCallback(
    (r: EvalResult) => {
      const target = targetOf(r);
      return target ? targetHref(services.application, target, r.time) : undefined;
    },
    [services.application]
  );

  const openTrace = useCallback(
    (traceId: string, aroundMs: number) =>
      openTraceInAgentTraces(services.application, traceId, aroundMs),
    [services.application]
  );

  useEffect(() => {
    const crumb = (text: string, to?: EvalRoute) => ({
      text,
      ...(to
        ? {
            href: hashOfRoute(to),
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              navigate(to);
            },
          }
        : {}),
    });
    const crumbs = [crumb(CRUMB_HOME, route.page === 'agents' ? undefined : AGENTS_ROUTE)];
    if (route.page === 'results') crumbs.push(crumb(titleOf(route)));
    if (route.page !== 'agents' && route.page !== 'results') crumbs.push(crumb(titleOf(route)));
    services.chrome.setBreadcrumbs(crumbs);
    services.chrome.docTitle.change(
      route.page === 'agents' ? PAGE_TITLE : [titleOf(route), PAGE_TITLE]
    );
  }, [services.chrome, route, navigate]);

  const quickRanges = useMemo(
    () =>
      (services.uiSettings.get('timepicker:quickRanges') as QuickRange[] | undefined)?.map(
        ({ from, to, display }) => ({ start: from, end: to, label: display })
      ) ?? [],
    [services.uiSettings]
  );

  const rangeLabel = useMemo(
    () =>
      prettyDuration(
        time.time.from,
        time.time.to,
        quickRanges,
        services.uiSettings.get('dateFormat')
      ),
    [time.time.from, time.time.to, quickRanges, services.uiSettings]
  );

  const runIds = runsOfRoute(route);
  const runKey = runIds.join('|');
  const run = useRunWindow(config, runIds, time.refreshKey);
  const onRunPage = runIds.length > 0;
  // Other runs (the run before, Compare with): the global range, reaching back at least
  // RUN_LOOKBACK_MS before the run, so a run opened from a link still finds the run before it.
  const browseRange = useMemo(() => {
    if (!run.window) return time.timeRange;
    const back = new Date(Date.parse(run.window.from) - RUN_LOOKBACK_MS).toISOString();
    return {
      from: back < time.timeRange.from ? back : time.timeRange.from,
      to: run.window.to > time.timeRange.to ? run.window.to : time.timeRange.to,
    };
  }, [run.window, time.timeRange]);

  const context = useMemo<EvalScreenContext | undefined>(
    () =>
      config
        ? {
            dataset: evalsDataset(config.index, evalsDataSourceOf(config)),
            spans: spansDataset(spansIndexOf(config), spansDataSourceOf(config)),
            index: config.index,
            timeRange: onRunPage && run.window ? run.window : time.timeRange,
            browseRange,
            rangeMs: time.rangeMs,
            rangeLabel,
            refreshKey: time.refreshKey,
            state,
            setState,
            navigate,
            openResult: setResult,
            openTrace,
            hrefOf,
          }
        : undefined,
    [
      config,
      onRunPage,
      run.window,
      browseRange,
      time.timeRange,
      time.rangeMs,
      rangeLabel,
      time.refreshKey,
      state,
      setState,
      navigate,
      openTrace,
      hrefOf,
    ]
  );

  const gettingStartedButton = (
    <EvalGettingStartedButton key="gettingStarted" onClick={() => setTourOpen(true)} />
  );
  const settingsButton = (
    <EvalSettingsButton key="settings" onClick={() => setSettingsOpen(true)} />
  );
  const datePicker = (
    <EuiSuperDatePicker
      key="time"
      compressed
      start={time.time.from}
      end={time.time.to}
      onTimeChange={time.onTimeChange}
      onRefresh={time.onRefresh}
      dateFormat={services.uiSettings.get('dateFormat')}
      commonlyUsedRanges={quickRanges}
      data-test-subj="agtEvlDatePicker"
    />
  );

  const refreshButton = (
    <EuiButtonEmpty
      key="refresh"
      size="s"
      iconType="refresh"
      onClick={time.onRefresh}
      data-test-subj="agtEvlRefresh"
    >
      {i18n.translate('agentTraces.evalsPage.refresh', { defaultMessage: 'Refresh' })}
    </EuiButtonEmpty>
  );

  const renderContent = () => {
    if (datasetLoading && !config) return <EuiLoadingContent lines={6} />;
    if (config && onRunPage && run.error) return <QueryErrorCallout message={run.error} />;
    if (config && onRunPage && run.loading) return <EuiLoadingContent lines={6} />;
    if (config && onRunPage && run.missing)
      return (
        <EuiEmptyPrompt
          iconType="search"
          title={
            <h3>
              {i18n.translate('agentTraces.evalsPage.runMissing', {
                defaultMessage: 'No results for this run',
              })}
            </h3>
          }
          body={i18n.translate('agentTraces.evalsPage.runMissingBody', {
            defaultMessage: 'No evaluation result carries the run id {ids}.',
            values: { ids: runKey.replace('|', ', ') },
          })}
          data-test-subj="agtEvlRunMissing"
        />
      );
    if (!context) {
      return (
        <NoEvalsDatasetPrompt
          onSetUp={() => setSetupOpen(true)}
          onGettingStarted={() => setTourOpen(true)}
          error={dataset.error}
        />
      );
    }
    return (
      <EvalContext.Provider value={context}>
        <EvalScreen route={route} />
        {result && (
          <ResultFlyout
            key={result.id}
            result={result}
            onClose={() => setResult(undefined)}
            onOpenResult={setResult}
            links={{
              openTrace,
              openSession: (sessionId: string, aroundMs: number) =>
                openSessionInAgentTraces(services.application, sessionId, aroundMs),
              openSuite: (suite) => navigate({ page: 'suite', suite }),
              openRun: (runId) => navigate({ page: 'run', runId }),
            }}
          />
        )}
      </EvalContext.Provider>
    );
  };

  return (
    <EuiErrorBoundary>
      <EuiPage paddingSize="m" className="agtEvlPage" data-test-subj="agtEvlPage">
        <EuiPageBody>
          <EvalHeader
            title={PAGE_TITLE}
            description={
              <FormattedMessage
                id="agentTraces.evalsPage.description"
                defaultMessage="Evaluation results of your agents, from online evaluators and suite runs."
              />
            }
            controls={
              !config
                ? [gettingStartedButton, settingsButton]
                : onRunPage
                  ? [refreshButton, gettingStartedButton, settingsButton]
                  : [datePicker, gettingStartedButton, settingsButton]
            }
          />
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
      {tourOpen && (
        <GettingStartedModal
          onClose={() => setTourOpen(false)}
          onSetUp={config ? undefined : () => setSetupOpen(true)}
        />
      )}
      {setupOpen && (
        <EvalSetupWizard
          configId={dataset.configId}
          workspaceId={dataset.workspaceId}
          onClose={(saved) => {
            setSetupOpen(false);
            if (saved) dataset.refresh();
          }}
        />
      )}
    </EuiErrorBoundary>
  );
};
