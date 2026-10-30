/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { i18n } from '@osd/i18n';
import { DataPublicPluginStart } from '../../../../data/public';
import { PplRecord, pplResponseToRecords, withoutTimeRange } from '../pages/sessions/session_utils';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import {
  EMPTY_RUN_EVENTS,
  EVAL_FIELDS,
  EvalFilters,
  EvalOutcome,
  EvalResult,
  EvaluatorSummary,
  RunDetailData,
  outcomesFilter,
  RunEvents,
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
  Facet,
  VerdictAgg,
  buildDistinctAggQuery,
  buildSummaryAggQuery,
  buildTrendAggQuery,
  bucketsFromAgg,
  ResultsSort,
  executeEvalPpl,
  executeVerdictAgg,
  fetchEvalResultsWith,
  fetchFacets,
  fetchResultsPage,
  keepOutcomes,
  kpisFromAgg,
  summariesFromAgg,
  toAggRows,
  trendFromAgg,
  whereForOutcomes,
} from './eval_ppl';

export type { Facet } from './eval_ppl';
import { MATCH_NONE, verdictKeyPlan } from './eval_verdict_keys';
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

/**
 * What went wrong with a query, in a few words when the engine's reason is a known limit
 * (the full reason follows).
 */
export const queryProblem = (error: unknown): string => {
  const message = errorMessage(error);
  let text = `${message} ${String((error as { message?: unknown })?.message ?? '')}`;
  try {
    text += ` ${JSON.stringify((error as { body?: unknown })?.body ?? '')}`;
  } catch {
    // circular body: the message is enough
  }
  if (/max allowed inline script size/i.test(text)) {
    return i18n.translate('agentTraces.evalsPage.problem.scriptSize', {
      defaultMessage: 'Pass rules too large for one query ({message})',
      values: { message },
    });
  }
  if (/too_many_clauses|maxClauseCount|too many clauses/i.test(text)) {
    return i18n.translate('agentTraces.evalsPage.problem.clauses', {
      defaultMessage: 'Verdict filter too large for one query ({message})',
      values: { message },
    });
  }
  return message;
};

/** Whether the error says the evaluation index does not exist yet. */
export const isIndexMissing = (error: unknown): boolean =>
  /no such index|index_not_found|IndexNotFound/i.test(
    `${errorMessage(error)} ${String((error as { message?: unknown })?.message ?? '')}`
  );

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
  /** Parts that could not be loaded, each with its reason (the others still show). */
  warnings: string[];
  /** The per-evaluation aggregation failed: counts are unknown, not zero. */
  failed?: boolean;
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
  /** Parts that could not be loaded, each with its reason (the others still show). */
  warnings: string[];
}

const EMPTY: EvalData = {
  loading: true,
  indexMissing: false,
  results: [],
  facets: [],
  interval: 60 * 60 * 1000,
  truncated: false,
  warnings: [],
};

/** Failures listed on the Overview. */
export const RECENT_FAILURES = 10;

/** Names of the parts of the page, for the "could not load" notice. */
const PART = {
  summary: i18n.translate('agentTraces.evalsPage.part.summary', {
    defaultMessage: 'Evaluation counts and pass rates',
  }),
  trend: i18n.translate('agentTraces.evalsPage.part.trend', {
    defaultMessage: 'Score trend and results over time',
  }),
  distinct: i18n.translate('agentTraces.evalsPage.part.distinct', {
    defaultMessage: 'Evaluated traces and sessions',
  }),
  previous: i18n.translate('agentTraces.evalsPage.part.previous', {
    defaultMessage: 'Previous period',
  }),
  failures: i18n.translate('agentTraces.evalsPage.part.failures', {
    defaultMessage: 'Recent failures',
  }),
  facets: i18n.translate('agentTraces.evalsPage.part.facets', {
    defaultMessage: 'Filter options',
  }),
  grades: i18n.translate('agentTraces.evalsPage.part.runGrades', {
    defaultMessage: 'Run evaluation scores',
  }),
  cases: i18n.translate('agentTraces.evalsPage.part.runCases', {
    defaultMessage: 'Run test case counts',
  }),
};

/**
 * `promise`, or `fallback` with the reason added to `warnings`: one failed query leaves
 * the rest of the page. A missing index still fails (the page says how to create it).
 */
const settle = async <T>(
  part: string,
  promise: Promise<T>,
  fallback: T,
  warnings: string[]
): Promise<T> => {
  try {
    return await promise;
  } catch (error) {
    if (isIndexMissing(error)) throw error;
    warnings.push(`${part}: ${queryProblem(error)}`);
    return fallback;
  }
};

const NO_AGG: VerdictAgg = { rows: [], keys: [], plan: verdictKeyPlan([]), clauses: [] };

export const fetchAggregates = async (
  ppl: PPLService,
  index: string,
  filters: EvalFilters,
  interval: number | undefined
): Promise<EvalAggregates> => {
  const warnings: string[] = [];
  const outcomes = outcomesFilter(filters);
  const distinctQuery = (verdictWhere?: string) =>
    executeEvalPpl(ppl, index, (missing, source) =>
      buildDistinctAggQuery(filters, { index: source, missing, verdictWhere })
    );
  let summaryFailed = false;
  const summaryPromise = executeVerdictAgg(ppl, index, (missing, source, clauses) =>
    buildSummaryAggQuery(filters, { index: source, missing, clauses })
  ).catch((error) => {
    summaryFailed = true;
    throw error;
  });
  const [summaryAgg, trendAgg, distinct] = await Promise.all([
    settle(PART.summary, summaryPromise, NO_AGG, warnings),
    interval
      ? settle(
          PART.trend,
          executeVerdictAgg(ppl, index, (missing, source, clauses) =>
            buildTrendAggQuery(filters, interval, { index: source, missing, clauses })
          ),
          NO_AGG,
          warnings
        )
      : Promise.resolve(NO_AGG),
    // Without a verdict filter the distinct counts need no verdict groups.
    settle(
      PART.distinct,
      outcomes
        ? summaryPromise.then((agg) => {
            const where = whereForOutcomes(agg, outcomes);
            return where === MATCH_NONE ? [] : distinctQuery(where);
          })
        : distinctQuery(),
      [] as PplRecord[],
      warnings
    ),
  ]);
  const summaryRows = keepOutcomes(summaryAgg.rows, filters);
  const trendRows = keepOutcomes(trendAgg.rows, filters);
  const summaries = summariesFromAgg(toAggRows(summaryRows));
  const trendAggRows = toAggRows(trendRows);
  const { all, byName } = bucketsFromAgg(trendAggRows);
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
    trend: trendFromAgg(trendAggRows),
    truncated: summaryAgg.rows.length >= AGG_ROWS_LIMIT || trendAgg.rows.length >= AGG_ROWS_LIMIT,
    warnings: Array.from(new Set(warnings)),
    failed: summaryFailed,
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
  view: 'overview' | 'results' = 'overview',
  /** Fetch only while this view's tab is shown. */
  enabled = true
): EvalData => {
  const [state, setState] = useState<EvalData>(EMPTY);
  const key = JSON.stringify([bounds, filters, refreshKey, index, view]);
  // A tab keeps its data when you leave and come back: it fetches again only for a new
  // range, filter or a click on Refresh.
  const loadedKey = useRef<string>();

  useEffect(() => {
    if (!enabled || loadedKey.current === key) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const range = isoRange(bounds);
    const previousRange = isoRange(previousPeriod(bounds));
    const current = createEvalsPplService(data, range, controller.signal);
    const before = createEvalsPplService(data, previousRange, controller.signal);
    const interval = pickInterval(bounds);
    const run = async () => {
      const warnings: string[] = [];
      // The Results table pages its rows itself (useResultsPage).
      const [agg, previous, results, allFacets] = await Promise.all([
        fetchAggregates(current, index, filters, view === 'overview' ? interval : undefined),
        view === 'overview'
          ? fetchAggregates(before, index, filters, undefined)
          : Promise.resolve(undefined),
        view === 'overview'
          ? settle(
              PART.failures,
              fetchEvalResultsWith(
                current,
                index,
                { ...filters, outcomes: ['fail'] },
                RECENT_FAILURES
              ),
              [] as EvalResult[],
              warnings
            )
          : Promise.resolve([] as EvalResult[]),
        settle(
          PART.facets,
          fetchFacets(current, index),
          undefined as Facet[] | undefined,
          warnings
        ),
      ]);
      // The previous period only colors changes: its failures read as one line.
      if (previous && previous.warnings.length)
        warnings.push(`${PART.previous}: ${previous.warnings[0]}`);
      return { agg, previous, results, allFacets, warnings: [...agg.warnings, ...warnings] };
    };
    run()
      .then(({ agg, previous, results, allFacets, warnings }) => {
        if (controller.signal.aborted) return;
        loadedKey.current = key;
        setState({
          loading: false,
          indexMissing: false,
          results,
          // Unknown, not zero, when the counts could not be read.
          total: agg.failed ? undefined : agg.kpis.results,
          facets: allFacets ?? [],
          current: agg,
          previous: previous && { summaries: previous.summaries, kpis: previous.kpis },
          interval,
          truncated: false,
          warnings,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        loadedKey.current = key;
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
  }, [data, key, enabled]);

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
  /** Parts that could not be loaded, each with its reason (the runs still show). */
  warnings?: string[];
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
): Promise<{ runs: RunSummary[]; truncated: boolean; warnings: string[] }> => {
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
  const warnings: string[] = [];
  const gradesPromise = executeVerdictAgg(
    ppl,
    index,
    (missing, source, clauses) =>
      buildRunGradesAggQuery(filters, { index: source, missing, clauses }),
    { emptyWithout: [EVAL_FIELDS.runId, EVAL_FIELDS.suiteName, EVAL_FIELDS.caseId] }
  );
  // Cases with a grade of these verdicts, the `where` from the grades' verdict groups.
  const casesWith = (outcomes: EvalOutcome[]) =>
    gradesPromise.then((agg) => {
      const where = whereForOutcomes(agg, outcomes);
      return where === MATCH_NONE
        ? []
        : viaPattern((missing, source) =>
            buildRunCasesAggQuery(filters, { index: source, missing, verdictWhere: where })
          );
    });
  const [gradesAgg, all, fail, decided, caseEvents, runEvents] = await Promise.all([
    settle(PART.grades, gradesPromise, NO_AGG, warnings),
    settle(
      PART.cases,
      viaPattern((missing, source) => buildRunCasesAggQuery(filters, { index: source, missing })),
      [] as PplRecord[],
      warnings
    ),
    settle(PART.cases, casesWith(['fail']), [] as PplRecord[], warnings),
    settle(PART.cases, casesWith(['pass', 'fail']), [] as PplRecord[], warnings),
    optional(buildRunCaseEventsAggQuery(index)),
    optional(buildRunEventsOnlyQuery(undefined, index)),
  ]);
  const rows = {
    grades: gradesAgg.rows,
    gradeCases: { all, fail, decided },
    caseEvents,
    runEvents,
  };
  const narrowed = (filters.names?.length ?? 0) > 0 || !!filters.search?.trim();
  return {
    runs: runSummariesFromAgg(rows, { onlyWithGrades: narrowed }),
    truncated: runAggTruncated(rows),
    warnings: Array.from(new Set(warnings)),
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
  const loadedKey = useRef<string>();
  useEffect(() => {
    if (!enabled || loadedKey.current === key) return;
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
      .then(({ runs, truncated, warnings }) => {
        if (controller.signal.aborted) return;
        loadedKey.current = key;
        setState({ loading: false, indexMissing: false, runs, truncated, warnings });
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
  const loadedKey = useRef<string>();
  useEffect(() => {
    if (!enabled || loadedKey.current === key) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const ppl = createEvalsPplService(data, isoRange(bounds), controller.signal);
    fetchResultsPage(ppl, index, filters, sort, pageIndex, pageSize)
      .then((page) => {
        if (controller.signal.aborted) return;
        loadedKey.current = key;
        setState({ loading: false, rows: page.rows });
      })
      .catch(
        (error) =>
          !controller.signal.aborted &&
          setState({ loading: false, rows: [], error: queryProblem(error) })
      );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, enabled]);
  return state;
};
