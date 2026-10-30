/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo } from 'react';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { RunSummary, TimeBoundsMs, mergeRunData, summarizeRuns } from './eval_aggregations';
import { DEFAULT_APP_STATE, filtersOf } from './eval_url_state';
import { useRunDetail, useRunResults, useRunsDetail } from './use_eval_data';
import { RunDetailPage } from './run_detail';
import { CompareRuns } from './compare_runs';
import type { EvaluationsServices } from '.';

const DAY_MS = 24 * 3600 * 1000;
/** The suite's other runs are read over this long before the run (or the earliest run). */
export const SUITE_HISTORY_MS = 30 * DAY_MS;
/** No filters on the run and compare pages: they have no filter bar. */
const NO_FILTERS = filtersOf(DEFAULT_APP_STATE);
const IDLE_BOUNDS: TimeBoundsMs = { from: 0, to: 0 };

/**
 * The range the suite's runs are read over on a page that has no time picker: from 30 days
 * before the earliest of `started` to now. Undefined until a start is known.
 */
export const suiteHistoryBounds = (
  started: number[],
  now: number = Date.now()
): TimeBoundsMs | undefined => {
  const known = started.filter((t) => Number.isFinite(t) && t > 0);
  if (known.length === 0) return undefined;
  return {
    from: Math.min(...known) - SUITE_HISTORY_MS,
    to: Math.max(now, Math.max(...known) + 3600 * 1000),
  };
};

const useSuiteRuns = (
  started: number[],
  refreshKey: number,
  index: string
): { runs: RunSummary[]; loading: boolean } => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const key = started.join(',');
  // Read once per set of runs: a fresh `Date.now()` on every render would refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bounds = useMemo(() => suiteHistoryBounds(started), [key]);
  const runs = useRunResults(
    services.data,
    bounds ?? IDLE_BOUNDS,
    NO_FILTERS,
    refreshKey,
    !!bounds,
    index
  );
  return { runs: runs.runs, loading: !!bounds && runs.loading };
};

/**
 * A run's own page (`#/runs/<id>`): the run read by its id whatever its date, the suite's
 * other runs around it for the previous run, the trend and "Compare with".
 */
export const RunPage: React.FC<{
  index: string;
  runId: string;
  refreshKey: number;
  onBack: () => void;
  onOpenRun: (runId: string) => void;
  onCompare: (runIds: string[]) => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
  /** The suite name once the run is read (the page title and breadcrumb). */
  onTitle: (title: string | undefined) => void;
  onLoadingChange: (loading: boolean) => void;
}> = ({
  index,
  runId,
  refreshKey,
  onBack,
  onOpenRun,
  onCompare,
  onOpenTrace,
  onTitle,
  onLoadingChange,
}) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const runDetail = useRunDetail(services.data, runId, refreshKey, index);
  const own = useMemo(
    () => summarizeRuns(runDetail.results, runDetail.events).find((r) => r.runId === runId),
    [runDetail.results, runDetail.events, runId]
  );
  const suite = useSuiteRuns(own ? [own.started] : [], refreshKey, index);
  // The run page compares cases with the previous run of the suite: read that run too.
  const previousRunId = suite.runs.find((r) => r.runId === runId)?.previousRunId;
  const previousDetail = useRunsDetail(
    services.data,
    previousRunId ? [previousRunId] : undefined,
    refreshKey,
    index
  );
  const runData = useMemo(
    () => mergeRunData(previousDetail, runDetail),
    [previousDetail, runDetail]
  );
  const title = own ? (own.suiteName ?? runId) : undefined;
  useEffect(() => onTitle(title), [title, onTitle]);
  const loading = runDetail.loading || suite.loading || previousDetail.loading;
  useEffect(() => onLoadingChange(loading), [loading, onLoadingChange]);
  return (
    <RunDetailPage
      runId={runId}
      results={runData.results}
      events={runData.events}
      runs={suite.runs}
      loading={runDetail.loading}
      error={runDetail.error}
      onBack={onBack}
      onOpenRun={onOpenRun}
      onCompare={onCompare}
      onOpenTrace={onOpenTrace}
    />
  );
};

/** The comparison of 2 to 5 runs (`#/compare`), its runs read by id; "Add run" offers the suite's. */
export const ComparePage: React.FC<{
  index: string;
  runIds: string[];
  baseline?: string;
  refreshKey: number;
  onChange: (runIds: string[], baseline: string) => void;
  onBack: () => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
  onLoadingChange: (loading: boolean) => void;
}> = ({ index, runIds, baseline, refreshKey, onChange, onBack, onOpenTrace, onLoadingChange }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const data = useRunsDetail(services.data, runIds, refreshKey, index);
  const started = useMemo(
    () => summarizeRuns(data.results, data.events).map((r) => r.started),
    [data.results, data.events]
  );
  const suite = useSuiteRuns(started, refreshKey, index);
  const loading = data.loading || suite.loading;
  useEffect(() => onLoadingChange(loading), [loading, onLoadingChange]);
  return (
    <CompareRuns
      runIds={runIds}
      baselineId={baseline && runIds.includes(baseline) ? baseline : runIds[0]}
      results={data.results}
      events={data.events}
      loading={data.loading}
      error={data.error}
      missing={data.missing}
      available={suite.runs}
      onChange={onChange}
      onBack={onBack}
      onOpenTrace={onOpenTrace}
    />
  );
};
