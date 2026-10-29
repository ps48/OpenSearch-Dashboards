/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EvaluatorSummary, summaryPassRate } from './eval_data';
import { ChangeKind, RunSummary, isRegression } from './eval_aggregations';

/**
 * "Needs attention" and "Top changes" on the Overview: plain findings computed from the
 * aggregations of the current and the previous period (and the runs in the range), no LLM.
 */

/** A pass-rate drop smaller than this (1 point) is noise. */
export const MIN_DROP = 0.01;
export const MAX_FINDINGS = 5;
export const MAX_TOP_CHANGES = 6;

export type Finding =
  | { kind: 'drop'; name: string; from: number; to: number }
  | { kind: 'runRegression'; run: RunSummary; previous?: RunSummary }
  | { kind: 'lowest'; name: string; passRate: number; failCount: number; decided: number }
  | { kind: 'newLabel'; name: string; label: string; count: number }
  | { kind: 'silent'; name: string; previousCount: number };

const decided = (s: EvaluatorSummary) => s.passCount + s.failCount;
const passRateOfRun = (r?: RunSummary) => (r && r.cases > 0 ? r.casesPassed / r.cases : undefined);

/**
 * Up to five findings, most urgent first: the biggest pass-rate drop against the previous
 * period, the most regressed suite run in the range, the lowest pass rate, a failing label
 * not seen in the previous period, and evaluations that reported in the previous period but
 * not in this one.
 */
export const needsAttention = (
  current: EvaluatorSummary[],
  previous: EvaluatorSummary[] | undefined,
  runs: RunSummary[] = []
): Finding[] => {
  const findings: Finding[] = [];
  const before = new Map((previous ?? []).map((s) => [s.name, s]));

  // 1. Biggest pass-rate drop.
  const drops = current
    .map((s) => {
      const p = before.get(s.name);
      const to = summaryPassRate(s);
      const from = p ? summaryPassRate(p) : undefined;
      return to !== undefined && from !== undefined ? { name: s.name, from, to } : undefined;
    })
    .filter(
      (d): d is { name: string; from: number; to: number } => !!d && d.from - d.to >= MIN_DROP
    )
    .sort((a, b) => b.from - b.to - (a.from - a.to));
  const drop = drops[0];
  if (drop) findings.push({ kind: 'drop', ...drop });

  // 2. The most regressed suite run: largest pass-rate drop, then most regressed evaluations.
  const byId = new Map(runs.map((r) => [r.runId, r]));
  const regressed = runs
    .filter(isRegression)
    .map((run) => {
      const prev = run.previousRunId ? byId.get(run.previousRunId) : undefined;
      const now = passRateOfRun(run);
      const was = passRateOfRun(prev);
      return { run, prev, drop: now !== undefined && was !== undefined ? was - now : 0 };
    })
    .sort(
      (a, b) =>
        b.drop - a.drop ||
        b.run.regressedEvaluators.length - a.run.regressedEvaluators.length ||
        b.run.started - a.run.started
    );
  if (regressed[0]) {
    findings.push({ kind: 'runRegression', run: regressed[0].run, previous: regressed[0].prev });
  }

  // 3. Lowest pass rate (below 100%), not the evaluation already named for its drop.
  const lowest = current
    .filter((s) => decided(s) > 0 && s.failCount > 0 && s.name !== drop?.name)
    .sort((a, b) => (summaryPassRate(a) ?? 1) - (summaryPassRate(b) ?? 1) || b.count - a.count)[0];
  if (lowest) {
    findings.push({
      kind: 'lowest',
      name: lowest.name,
      passRate: summaryPassRate(lowest) ?? 0,
      failCount: lowest.failCount,
      decided: decided(lowest),
    });
  }

  // 4. A failing label the evaluation did not report in the previous period.
  const newLabels = current
    .flatMap((s) => {
      const p = before.get(s.name);
      if (!p || p.count === 0) return [];
      const seen = new Set(p.labels.map((l) => l.label.toLowerCase()));
      return s.labels
        .filter((l) => l.outcome === 'fail' && !seen.has(l.label.toLowerCase()))
        .map((l) => ({ name: s.name, label: l.label, count: l.count }));
    })
    .sort((a, b) => b.count - a.count);
  if (newLabels[0]) findings.push({ kind: 'newLabel', ...newLabels[0] });

  // 5. Evaluations with results in the previous period and none now, busiest first.
  const names = new Set(current.map((s) => s.name));
  (previous ?? [])
    .filter((s) => s.count > 0 && !names.has(s.name))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .forEach((s) => findings.push({ kind: 'silent', name: s.name, previousCount: s.count }));

  return findings.slice(0, MAX_FINDINGS);
};

export interface TopChange {
  name: string;
  /** Pass rate when the evaluation has a pass rule, else the mean. */
  metric: 'passRate' | 'mean';
  value: number;
  previous?: number;
  /** Signed change on a 0..1 scale where positive is better (pass rate, normalized mean). */
  score?: number;
  change?: ChangeKind;
}

/**
 * Per evaluation, the pass rate (or the mean without a pass rule) against the previous
 * period, worst change first; evaluations without a previous value last. At most six.
 */
export const topChanges = (
  current: EvaluatorSummary[],
  previous: EvaluatorSummary[] | undefined
): TopChange[] => {
  const before = new Map((previous ?? []).map((s) => [s.name, s]));
  const items = current
    .map((s): TopChange | undefined => {
      const p = before.get(s.name);
      const rate = summaryPassRate(s);
      if (rate !== undefined) {
        const was = p ? summaryPassRate(p) : undefined;
        const score = was !== undefined ? rate - was : undefined;
        return {
          name: s.name,
          metric: 'passRate',
          value: rate,
          previous: was,
          score,
          change:
            score === undefined
              ? undefined
              : score > 0.005
                ? 'improved'
                : score < -0.005
                  ? 'regressed'
                  : 'unchanged',
        };
      }
      if (s.mean === undefined) return undefined;
      const score =
        s.normalizedMean !== undefined && p?.normalizedMean !== undefined
          ? s.normalizedMean - p.normalizedMean
          : undefined;
      return {
        name: s.name,
        metric: 'mean',
        value: s.mean,
        previous: p?.mean,
        score,
        // Without a known range there is no better or worse: neutral.
        change:
          score === undefined
            ? undefined
            : score > 0.005
              ? 'improved'
              : score < -0.005
                ? 'regressed'
                : 'unchanged',
      };
    })
    .filter((t): t is TopChange => !!t);
  return items
    .sort((a, b) => {
      const ka = a.score ?? (a.previous !== undefined ? 0 : Infinity);
      const kb = b.score ?? (b.previous !== undefined ? 0 : Infinity);
      return ka - kb || a.name.localeCompare(b.name);
    })
    .slice(0, MAX_TOP_CHANGES);
};
