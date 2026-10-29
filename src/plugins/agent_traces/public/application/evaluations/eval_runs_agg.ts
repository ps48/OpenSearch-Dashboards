/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';
import { PplRecord } from '../pages/sessions/session_utils';
import {
  EVAL_FIELDS,
  EvalFilters,
  SuiteRunEvent,
  TEST_CASE_EVENT,
  TEST_SUITE_RUN_EVENT,
  recordToSuiteRunEvent,
} from './eval_data';
import { RuleEntry, getActiveClauses, getActiveRuleEntries } from './eval_verdict';
import { verdictKeyEval, verdictKeyGroups, verdictKeyPlan } from './eval_verdict_keys';
import {
  EvaluatorAggregate,
  RunSummary,
  linkPreviousRuns,
  parseEvalTime,
} from './eval_aggregations';
import {
  AGG_ROWS_LIMIT,
  QueryContext,
  baseCommands,
  summariesFromAgg,
  toAggRows,
} from './eval_ppl';

/**
 * The Evaluation runs list from PPL aggregations, so it holds at any volume (not the first
 * 10,000 results): grades `stats ... by test.suite.run.id, evaluation name, ...` and the
 * verdict keys (the verdict applied in the browser, `executeVerdictAgg`), case counts by run, case events counted by run and status,
 * and the run events themselves (one small event per run). The run page and Compare still
 * read their runs' events one run at a time.
 */

const field = (f: string) => `\`${f}\``;
const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const RUN = field(EVAL_FIELDS.runId);
const SUITE = field(EVAL_FIELDS.suiteName);
const CASE = field(EVAL_FIELDS.caseId);
const TIME = field(EVAL_FIELDS.time);
const AGENT = '`attributes.gen_ai.agent.name`';
const SERVICE = '`resource.attributes.service.name`';

const runGradeFilters = (filters: EvalFilters): EvalFilters => ({
  names: filters.names,
  search: filters.search,
  runsOnly: true,
});

const present = (missing: ReadonlySet<string>) => (f: string) => !missing.has(f);

/** Per run, evaluation, label, declared scale and verdict keys: counts, value sums and times. */
export const buildRunGradesAggQuery = (filters: EvalFilters, ctx: QueryContext = {}): string => {
  const missing = ctx.missing ?? new Set<string>();
  const groups = [
    EVAL_FIELDS.runId,
    EVAL_FIELDS.suiteName,
    EVAL_FIELDS.name,
    ...[
      EVAL_FIELDS.label,
      EVAL_FIELDS.direction,
      EVAL_FIELDS.scoreMin,
      EVAL_FIELDS.scoreMax,
    ].filter(present(missing)),
  ].map(field);
  const plan = verdictKeyPlan(ctx.clauses ?? getActiveClauses(), missing);
  const keyEval = verdictKeyEval(plan);
  const by = Array.from(new Set([...groups, ...verdictKeyGroups(plan)]));
  const values = missing.has(EVAL_FIELDS.value)
    ? ''
    : `, count(${field(EVAL_FIELDS.value)}) as nv, sum(${field(
        EVAL_FIELDS.value
      )}) as sv, min(${field(EVAL_FIELDS.value)}) as vmin, max(${field(EVAL_FIELDS.value)}) as vmax`;
  return [
    ...baseCommands(runGradeFilters(filters), { ...ctx, verdictWhere: undefined }),
    ...(keyEval ? [keyEval] : []),
    `stats count() as n${values}, min(${TIME}) as t0, max(${TIME}) as t1 by ${by.join(', ')}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');
};

/**
 * Test cases per run counted from grades (`test.case.id`), for runs without test case
 * events: all cases, or with `ctx.verdictWhere` those with a grade of the wanted verdicts
 * (failing; passing or failing), the `where` built from the grades' verdict groups.
 */
export const buildRunCasesAggQuery = (filters: EvalFilters, ctx: QueryContext = {}): string =>
  [
    ...baseCommands(runGradeFilters(filters), ctx),
    `stats distinct_count(${CASE}) as nc by ${RUN}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');

/** Test case events per run and status: counts, times and the agent. */
export const buildRunCaseEventsAggQuery = (index: string = AGENT_EVALS_INDEX_PATTERN): string =>
  [
    `source = ${index}`,
    `where ${field(EVAL_FIELDS.eventName)} = ${quote(TEST_CASE_EVENT)}`,
    `where isnotnull(${RUN})`,
    `stats count() as n, distinct_count(${CASE}) as nc, min(${TIME}) as t0, max(${TIME}) as t1 by ${RUN}, ${SUITE}, ${field(
      EVAL_FIELDS.caseStatus
    )}, ${AGENT}, ${SERVICE}`,
    `head ${AGG_ROWS_LIMIT}`,
  ].join(' | ');

/** The run events (one per run), newest first. */
export const buildRunEventsOnlyQuery = (
  limit = AGG_ROWS_LIMIT,
  index: string = AGENT_EVALS_INDEX_PATTERN
): string =>
  [
    `source = ${index}`,
    `where ${field(EVAL_FIELDS.eventName)} = ${quote(TEST_SUITE_RUN_EVENT)}`,
    `sort - ${TIME}`,
    `head ${limit}`,
  ].join(' | ');

const str = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export interface RunAggRows {
  grades: PplRecord[];
  /** `buildRunCasesAggQuery` rows: all cases, failing cases, decided cases. */
  gradeCases: { all: PplRecord[]; fail: PplRecord[]; decided: PplRecord[] };
  caseEvents: PplRecord[];
  runEvents: PplRecord[];
}

const sumBy = (rows: PplRecord[], pick: (r: PplRecord) => number | undefined) =>
  rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

const timeOf = (v: unknown) => parseEvalTime(str(v));

/**
 * Run summaries from the aggregations. Counts and timing come from the run event when there
 * is one, else from the case events, else from the grades (cases by `test.case.id`; a case
 * fails when any of its grades fails, passes when any passes and none fails).
 */
export const runSummariesFromAgg = (
  rows: RunAggRows,
  options: { onlyWithGrades?: boolean; rules?: RuleEntry[] } = {}
): RunSummary[] => {
  const rules = options.rules ?? getActiveRuleEntries();
  const gradesByRun = new Map<string, PplRecord[]>();
  rows.grades.forEach((r) => {
    const id = str(r[EVAL_FIELDS.runId]);
    if (id) gradesByRun.set(id, [...(gradesByRun.get(id) ?? []), r]);
  });
  const caseEventsByRun = new Map<string, PplRecord[]>();
  rows.caseEvents.forEach((r) => {
    const id = str(r[EVAL_FIELDS.runId]);
    if (id) caseEventsByRun.set(id, [...(caseEventsByRun.get(id) ?? []), r]);
  });
  const latestRunEvent = new Map<string, SuiteRunEvent>();
  rows.runEvents.forEach((row) => {
    const e = recordToSuiteRunEvent(row);
    if (!e) return;
    const seen = latestRunEvent.get(e.runId);
    if (!seen || parseEvalTime(e.time) > parseEvalTime(seen.time)) latestRunEvent.set(e.runId, e);
  });
  const caseCount = (list: PplRecord[]) => {
    const m = new Map<string, number>();
    list.forEach((r) => {
      const id = str(r[EVAL_FIELDS.runId]);
      if (id) m.set(id, (m.get(id) ?? 0) + (num(r.nc) ?? 0));
    });
    return m;
  };
  const allCases = caseCount(rows.gradeCases.all);
  const failCases = caseCount(rows.gradeCases.fail);
  const decidedCases = caseCount(rows.gradeCases.decided);

  const runIds = new Set<string>([
    ...gradesByRun.keys(),
    ...(options.onlyWithGrades ? [] : [...caseEventsByRun.keys(), ...latestRunEvent.keys()]),
  ]);

  const runs = Array.from(runIds).map((runId) => {
    const grades = gradesByRun.get(runId) ?? [];
    const caseRows = caseEventsByRun.get(runId) ?? [];
    const runEvent = latestRunEvent.get(runId);
    const aggRows = toAggRows(grades);
    const evaluators: Record<string, EvaluatorAggregate> = {};
    summariesFromAgg(aggRows, rules).forEach((s) => {
      const own = aggRows.filter((r) => r.name === s.name);
      const mins = own.map((r) => r.valueMin).filter((v): v is number => v !== undefined);
      const maxs = own.map((r) => r.valueMax).filter((v): v is number => v !== undefined);
      evaluators[s.name] = {
        name: s.name,
        count: s.count,
        mean: s.mean,
        normalizedMean: s.normalizedMean,
        passRate:
          s.passCount + s.failCount > 0 ? s.passCount / (s.passCount + s.failCount) : undefined,
        topLabel: s.labels[0]?.label,
        min: mins.length ? Math.min(...mins) : undefined,
        max: maxs.length ? Math.max(...maxs) : undefined,
        direction: s.direction,
        passCount: s.passCount,
        failCount: s.failCount,
      };
    });

    // Case counts: case events by status, else grades by test.case.id.
    const fromCaseEvents = caseRows.length > 0;
    const byStatus = (status: string) =>
      sumBy(
        caseRows.filter((r) => str(r[EVAL_FIELDS.caseStatus])?.toLowerCase().startsWith(status)),
        (r) => num(r.nc) || num(r.n)
      );
    let counted: { cases: number; passed: number; failed: number; errored: number };
    if (fromCaseEvents) {
      counted = {
        cases: sumBy(caseRows, (r) => num(r.nc) || num(r.n)),
        passed: byStatus('pass'),
        failed: byStatus('fail'),
        errored: byStatus('error'),
      };
    } else {
      const decided = decidedCases.get(runId) ?? 0;
      const failed = failCases.get(runId) ?? 0;
      counted = {
        cases: allCases.get(runId) ?? 0,
        passed: Math.max(0, decided - failed),
        failed,
        errored: 0,
      };
    }

    const times = [...grades, ...caseRows].flatMap((r) => [timeOf(r.t0), timeOf(r.t1)]);
    const finite = times.filter(Number.isFinite);
    const runEnd = runEvent ? parseEvalTime(runEvent.time) : NaN;
    const ended = Number.isFinite(runEnd) ? runEnd : finite.length ? Math.max(...finite) : NaN;
    const started =
      Number.isFinite(runEnd) && runEvent?.durationMs !== undefined
        ? runEnd - runEvent.durationMs
        : finite.length
          ? Math.min(...finite)
          : ended;
    const durationMs =
      runEvent?.durationMs ??
      (fromCaseEvents && Number.isFinite(ended - started) ? ended - started : undefined);
    const first = <T>(values: Array<T | undefined>) => values.find((v) => v !== undefined);
    const summary: RunSummary = {
      runId,
      suiteName: first([
        runEvent?.suiteName,
        ...caseRows.map((r) => str(r[EVAL_FIELDS.suiteName])),
        ...grades.map((r) => str(r[EVAL_FIELDS.suiteName])),
      ]),
      started,
      ended,
      durationMs,
      status: runEvent?.status,
      results: sumBy(grades, (r) => num(r.n)),
      cases: runEvent?.caseCount ?? counted.cases,
      casesPassed: runEvent?.passCount ?? counted.passed,
      casesFailed: runEvent?.failCount ?? counted.failed,
      casesErrored: runEvent?.errorCount ?? counted.errored,
      fromCaseEvents,
      agentName: first(caseRows.map((r) => str(r['attributes.gen_ai.agent.name']))),
      serviceName: first(caseRows.map((r) => str(r['resource.attributes.service.name']))),
      metadata: runEvent?.metadata,
      evaluators,
      regressedEvaluators: [],
      passRateDropped: false,
    };
    return summary;
  });
  return linkPreviousRuns(runs);
};

/** Whether an aggregation may have left rows out. */
export const runAggTruncated = (rows: RunAggRows) =>
  rows.grades.length >= AGG_ROWS_LIMIT ||
  rows.caseEvents.length >= AGG_ROWS_LIMIT ||
  rows.runEvents.length >= AGG_ROWS_LIMIT ||
  rows.gradeCases.all.length >= AGG_ROWS_LIMIT;
