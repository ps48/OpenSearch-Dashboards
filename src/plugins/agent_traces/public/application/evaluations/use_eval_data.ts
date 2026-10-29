/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { DataPublicPluginStart } from '../../../../data/public';
import { PplRecord, pplResponseToRecords, withoutTimeRange } from '../pages/sessions/session_utils';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import {
  EMPTY_RUN_EVENTS,
  EVAL_FIELDS,
  EvalFilters,
  EvalResult,
  EvaluatorSummary,
  RunDetailData,
  outcomesFilter,
  RunEvents,
  buildEvalFacetsQuery,
  buildEvalResultsQuery,
  buildRunDetailQuery,
  createEvalsPplService,
  evalsDataset,
  fetchEvalResults,
  recordsToRunDetail,
} from './eval_data';
import {
  EvalKpis,
  OutcomeBucket,
  TimeBoundsMs,
  TrendPoint,
  pickInterval,
  previousPeriod,
} from './eval_aggregations';
import {
  AGG_ROWS_LIMIT,
  buildDistinctAggQuery,
  buildSummaryAggQuery,
  buildTrendAggQuery,
  bucketsFromAgg,
  ResultsSort,
  executeEvalPpl,
  fetchEvalResultsWith,
  fetchResultsPage,
  kpisFromAgg,
  summariesFromAgg,
  toAggRows,
  trendFromAgg,
} from './eval_ppl';
import { PPLService } from '../pages/traces/trace_details/data_fetching/ppl_request_helpers';
import type { RunSummary } from './eval_aggregations';
import {
  buildRunCaseEventsAggQuery,
  buildRunCasesAggQuery,
  buildRunEventsOnlyQuery,
  buildRunGradesAggQuery,
  runAggTruncated,
  runSummariesFromAgg,
} from './eval_runs_agg';

/** Results read for the Evaluation runs tab. */
export const RUN_RESULTS_LIMIT = 10000;

/** Readable message of a failed PPL request (the engine's reason when it sent one). */
export const errorMessage = (error: unknown): string => {
  if (!error) return '';
  const e = error as { body?: { message?: unknown }; message?: unknown };
  const raw = String(e.body?.message ?? e.message ?? error);
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { reason?: string; details?: string };
      };
      const reason = parsed.error?.details || parsed.error?.reason;
      if (reason) return reason;
    } catch {
      // not JSON: use the raw message
    }
  }
  return raw;
};

/** Whether the error says the evaluation index does not exist yet. */
export const isIndexMissing = (error: unknown): boolean =>
  /no such index|index_not_found|IndexNotFound/i.test(
    `${errorMessage(error)} ${String((error as { message?: unknown })?.message ?? '')}`
  );

export interface Facet {
  name: string;
  level: string;
  source: string;
  count: number;
}

const toFacets = (response: unknown): Facet[] =>
  pplResponseToRecords(response).map((row) => ({
    name: String(row[EVAL_FIELDS.name] ?? ''),
    level: String(row[EVAL_FIELDS.level] ?? ''),
    source: String(row[EVAL_FIELDS.source] ?? ''),
    count: Number(row.results ?? 0),
  }));

const isoRange = ({ from, to }: TimeBoundsMs) => ({
  from: new Date(from).toISOString(),
  to: new Date(to).toISOString(),
});

/** Exact numbers of a period, from server-side aggregations. */
export interface EvalAggregates {
  summaries: EvaluatorSummary[];
  kpis: EvalKpis;
  /** Results per bucket and verdict, all evaluations. */
  buckets: OutcomeBucket[];
  bucketsByName: Map<string, OutcomeBucket[]>;
  /** Normalized mean per evaluation and bucket (evaluations with a known score range). */
  trend: TrendPoint[];
  /** An aggregation returned as many rows as allowed: some rows may be left out. */
  truncated: boolean;
}

export interface EvalData {
  loading: boolean;
  error?: string;
  indexMissing: boolean;
  /** The latest failures under the filters (Overview). The Results table pages its own. */
  results: EvalResult[];
  /** Results in the range under the filters (exact). */
  total?: number;
  /** Evaluation names, levels and sources present in the range (filter options). */
  facets: Facet[];
  current?: EvalAggregates;
  previous?: Pick<EvalAggregates, 'summaries' | 'kpis'>;
  /** Bucket size of the time series, ms. */
  interval: number;
  /** More results matched than rows were read (Results tab). */
  truncated: boolean;
}

const EMPTY: EvalData = {
  loading: true,
  indexMissing: false,
  results: [],
  facets: [],
  interval: 60 * 60 * 1000,
  truncated: false,
};

/** Failures listed on the Overview. */
export const RECENT_FAILURES = 10;

const fetchAggregates = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  interval: number | undefined
): Promise<EvalAggregates> => {
  const [summaryRows, trendRows, distinct] = await Promise.all([
    executeEvalPpl(ppl, index, (missing, source) =>
      buildSummaryAggQuery(filters, { index: source, missing })
    ),
    interval
      ? executeEvalPpl(ppl, index, (missing, source) =>
          buildTrendAggQuery(filters, interval, { index: source, missing })
        )
      : Promise.resolve([]),
    // Without a verdict filter the distinct counts need no script.
    executeEvalPpl(ppl, index, (missing, source) =>
      buildDistinctAggQuery(filters, {
        index: source,
        missing,
        withoutVerdict: !outcomesFilter(filters),
      })
    ),
  ]);
  const summaries = summariesFromAgg(toAggRows(summaryRows));
  const trendAgg = toAggRows(trendRows);
  const { all, byName } = bucketsFromAgg(trendAgg);
  const distinctTotals = distinct.reduce<PplRecord>(
    (acc, row) => ({
      traces: Number(acc.traces ?? 0) + Number(row.traces ?? 0),
      sessions: Number(acc.sessions ?? 0) + Number(row.sessions ?? 0),
    }),
    {}
  );
  return {
    summaries,
    kpis: kpisFromAgg(summaries, distinctTotals),
    buckets: all,
    bucketsByName: byName,
    trend: trendFromAgg(trendAgg),
    truncated: summaryRows.length >= AGG_ROWS_LIMIT || trendRows.length >= AGG_ROWS_LIMIT,
  };
};

/**
 * Exact aggregates of the current and previous period, the filter facets, and result rows:
 * the latest results (Results tab) or the latest failures (Overview).
 */
export const useEvalData = (
  data: DataPublicPluginStart,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  refreshKey: number,
  index: string = AGENT_EVALS_INDEX_PATTERN,
  view: 'overview' | 'results' = 'overview'
): EvalData => {
  const [state, setState] = useState<EvalData>(EMPTY);
  const key = JSON.stringify([bounds, filters, refreshKey, index, view]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const range = isoRange(bounds);
    const previousRange = isoRange(previousPeriod(bounds));
    const current = createEvalsPplService(data, range, controller.signal);
    const before = createEvalsPplService(data, previousRange, controller.signal);
    const interval = pickInterval(bounds);
    const run = async () =>
      // The Results table pages its rows itself (useResultsPage).
      Promise.all([
        fetchAggregates(current, index, filters, view === 'overview' ? interval : undefined),
        view === 'overview'
          ? fetchAggregates(before, index, filters, undefined)
          : Promise.resolve(undefined),
        view === 'overview'
          ? fetchEvalResultsWith(
              current,
              index,
              { ...filters, outcomes: ['fail'] },
              RECENT_FAILURES
            )
          : Promise.resolve([]),
        current.executeQuery(evalsDataset(index), buildEvalFacetsQuery({}, index)),
      ]);
    run()
      .then(([agg, previous, results, allFacets]) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          indexMissing: false,
          results,
          total: agg.kpis.results,
          facets: toFacets(allFacets),
          current: agg,
          previous: previous && { summaries: previous.summaries, kpis: previous.kpis },
          interval,
          truncated: false,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          ...EMPTY,
          loading: false,
          indexMissing: isIndexMissing(error),
          error: errorMessage(error),
        });
      });
    return () => controller.abort();
    // `key` captures bounds, filters and refreshKey by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);

  return state;
};

export interface RunData {
  loading: boolean;
  error?: string;
  indexMissing: boolean;
  /** Runs in the time range, newest first, from aggregations (exact at any volume). */
  runs: RunSummary[];
  /** An aggregation returned as many rows as allowed: some runs may be missing. */
  truncated: boolean;
}

export const EMPTY_RUN_DATA: RunData = {
  loading: true,
  indexMissing: false,
  runs: [],
  truncated: false,
};

/** Runs in the range from PPL aggregations on the index pattern (see `executeEvalPpl`). */
export const fetchRunSummaries = async (
  data: DataPublicPluginStart,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  index: string,
  signal?: AbortSignal
): Promise<{ runs: RunSummary[]; truncated: boolean }> => {
  const ppl = createEvalsPplService(data, isoRange(bounds), signal);
  // No run id field mapped: no runs.
  const viaPattern = (build: (missing: ReadonlySet<string>, source: string) => string) =>
    executeEvalPpl(ppl, index, build, {
      emptyWithout: [EVAL_FIELDS.runId, EVAL_FIELDS.suiteName, EVAL_FIELDS.caseId],
    });
  // Case and run events are optional: a run without them still works from its grades.
  const optional = (query: string) =>
    ppl
      .executeQuery(evalsDataset(index), query)
      .then((r) => pplResponseToRecords(r))
      .catch(() => [] as PplRecord[]);
  const [grades, all, fail, decided, caseEvents, runEvents] = await Promise.all([
    viaPattern((missing, source) => buildRunGradesAggQuery(filters, { index: source, missing })),
    viaPattern((missing, source) =>
      buildRunCasesAggQuery(filters, 'all', { index: source, missing, withoutVerdict: true })
    ),
    viaPattern((missing, source) =>
      buildRunCasesAggQuery(filters, 'fail', { index: source, missing })
    ),
    viaPattern((missing, source) =>
      buildRunCasesAggQuery(filters, 'decided', { index: source, missing })
    ),
    optional(buildRunCaseEventsAggQuery(index)),
    optional(buildRunEventsOnlyQuery(undefined, index)),
  ]);
  const rows = { grades, gradeCases: { all, fail, decided }, caseEvents, runEvents };
  const narrowed = (filters.names?.length ?? 0) > 0 || !!filters.search?.trim();
  return {
    runs: runSummariesFromAgg(rows, { onlyWithGrades: narrowed }),
    truncated: runAggTruncated(rows),
  };
};

/** Evaluation runs in the time range, from aggregations. */
export const useRunResults = (
  data: DataPublicPluginStart,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  refreshKey: number,
  /** Fetch only while the runs are shown. */
  enabled = true,
  index: string = AGENT_EVALS_INDEX_PATTERN
): RunData => {
  const [state, setState] = useState<RunData>(EMPTY_RUN_DATA);
  const key = JSON.stringify([bounds, filters.names, filters.search, refreshKey, index]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    // Level, source and outcome filters do not apply: a run is compared on all its results.
    fetchRunSummaries(
      data,
      bounds,
      { names: filters.names, search: filters.search },
      index,
      controller.signal
    )
      .then(({ runs, truncated }) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, indexMissing: false, runs, truncated });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          indexMissing: isIndexMissing(error),
          error: errorMessage(error),
          runs: [],
          truncated: false,
        });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, enabled]);
  return state;
};

export interface RunDetailState extends RunDetailData {
  loading: boolean;
  error?: string;
}

const EMPTY_DETAIL: RunDetailState = { loading: false, results: [], events: EMPTY_RUN_EVENTS };

/**
 * Every grade, test case event and run event of one run, whatever its time: a run page
 * opened from a link (a CI job) shows the run even when it is older than the runs' range.
 */
export const useRunDetail = (
  data: DataPublicPluginStart,
  runId: string | undefined,
  refreshKey: number,
  index: string = AGENT_EVALS_INDEX_PATTERN
): RunDetailState => {
  const [state, setState] = useState<RunDetailState>(EMPTY_DETAIL);
  useEffect(() => {
    if (!runId) {
      setState(EMPTY_DETAIL);
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const ppl = createEvalsPplService(data, undefined, controller.signal);
    ppl
      .executeQuery(
        withoutTimeRange(evalsDataset(index)),
        buildRunDetailQuery(runId, RUN_RESULTS_LIMIT, index)
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, ...recordsToRunDetail(pplResponseToRecords(response)) });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ ...EMPTY_DETAIL, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [data, runId, refreshKey, index]);
  return state;
};

export interface RunsDetailState extends RunDetailData {
  loading: boolean;
  error?: string;
  /** Runs with no grade, test case or run event (deleted, or a wrong id). */
  missing: string[];
}

/**
 * Every grade, test case event and run event of several runs (a comparison), whatever their
 * time: one query per run, so each run is read up to `RUN_RESULTS_LIMIT` events.
 */
export const useRunsDetail = (
  data: DataPublicPluginStart,
  runIds: string[] | undefined,
  refreshKey: number,
  index: string = AGENT_EVALS_INDEX_PATTERN
): RunsDetailState => {
  const [state, setState] = useState<RunsDetailState>({
    loading: false,
    results: [],
    events: EMPTY_RUN_EVENTS,
    missing: [],
  });
  const key = JSON.stringify([runIds, refreshKey, index]);
  useEffect(() => {
    if (!runIds?.length) {
      setState({ loading: false, results: [], events: EMPTY_RUN_EVENTS, missing: [] });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const ppl = createEvalsPplService(data, undefined, controller.signal);
    Promise.all(
      runIds.map((runId) =>
        ppl
          .executeQuery(
            withoutTimeRange(evalsDataset(index)),
            buildRunDetailQuery(runId, RUN_RESULTS_LIMIT, index)
          )
          .then((response) => recordsToRunDetail(pplResponseToRecords(response)))
      )
    )
      .then((parts) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          results: parts.flatMap((p) => p.results),
          events: {
            cases: parts.flatMap((p) => p.events.cases),
            runs: parts.flatMap((p) => p.events.runs),
          },
          missing: runIds.filter(
            (_id, i) =>
              parts[i].results.length +
                parts[i].events.cases.length +
                parts[i].events.runs.length ===
              0
          ),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          results: [],
          events: EMPTY_RUN_EVENTS,
          missing: [],
          error: errorMessage(error),
        });
      });
    return () => controller.abort();
    // `key` captures the run ids by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);
  return state;
};

export interface EvaluationResultsState {
  loading: boolean;
  error?: string;
  results: EvalResult[];
}

/** Latest results the evaluation drill-down reads (its failure breakdown and charts). */
export const DRILLDOWN_RESULTS_LIMIT = 5000;

/** Results of one evaluation in the time range under the other filters (drill-down). */
export const useEvaluationResults = (
  data: DataPublicPluginStart,
  name: string | undefined,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  refreshKey: number,
  index: string = AGENT_EVALS_INDEX_PATTERN
): EvaluationResultsState => {
  const [state, setState] = useState<EvaluationResultsState>({ loading: false, results: [] });
  const key = JSON.stringify([name, bounds, filters.levels, filters.sources, refreshKey, index]);
  useEffect(() => {
    if (!name) {
      setState({ loading: false, results: [] });
      return;
    }
    const controller = new AbortController();
    setState({ loading: true, results: [] });
    const ppl = createEvalsPplService(data, isoRange(bounds), controller.signal);
    fetchEvalResults(
      ppl,
      buildEvalResultsQuery(
        { names: [name], levels: filters.levels, sources: filters.sources },
        DRILLDOWN_RESULTS_LIMIT,
        index
      ),
      index
    )
      .then((results) => !controller.signal.aborted && setState({ loading: false, results }))
      .catch(
        (error) =>
          !controller.signal.aborted &&
          setState({ loading: false, results: [], error: errorMessage(error) })
      );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);
  return state;
};

/** AgentCore online evaluations run about this long after a session goes idle. */
export const AGENTCORE_LAG_MS = 15 * 60 * 1000;

/** Whether the index holds any AgentCore result (any time): for the lag note. */
export const useAgentCorePresent = (
  data: DataPublicPluginStart,
  index: string = AGENT_EVALS_INDEX_PATTERN
): boolean => {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const ppl = createEvalsPplService(data, undefined, controller.signal);
    ppl
      .executeQuery(
        withoutTimeRange(evalsDataset(index)),
        `source = ${index} | where \`${EVAL_FIELDS.source}\` = 'agentcore' | head 1 | fields \`${EVAL_FIELDS.time}\``
      )
      .then((r) => !controller.signal.aborted && setPresent(pplResponseToRecords(r).length > 0))
      .catch(() => !controller.signal.aborted && setPresent(false));
    return () => controller.abort();
  }, [data, index]);
  return present;
};

export interface ResultsPageState {
  loading: boolean;
  error?: string;
  rows: EvalResult[];
}

/** One page of the Results table, sorted and filtered in the query. */
export const useResultsPage = (
  data: DataPublicPluginStart,
  bounds: TimeBoundsMs,
  filters: EvalFilters,
  refreshKey: number,
  index: string,
  sort: ResultsSort,
  pageIndex: number,
  pageSize: number,
  enabled = true
): ResultsPageState => {
  const [state, setState] = useState<ResultsPageState>({
    loading: true,
    rows: [],
  });
  const key = JSON.stringify([bounds, filters, refreshKey, index, sort, pageIndex, pageSize]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const ppl = createEvalsPplService(data, isoRange(bounds), controller.signal);
    fetchResultsPage(ppl, index, filters, sort, pageIndex, pageSize)
      .then((page) => !controller.signal.aborted && setState({ loading: false, rows: page.rows }))
      .catch(
        (error) =>
          !controller.signal.aborted &&
          setState({ loading: false, rows: [], error: errorMessage(error) })
      );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, enabled]);
  return state;
};
