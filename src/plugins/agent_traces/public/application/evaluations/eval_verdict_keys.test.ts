/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Clause,
  Cond,
  EvalOutcome,
  VERDICT_PPL_FIELDS,
  VerdictInput,
  buildVerdictClauses,
  verdictOf,
} from './eval_verdict';
import {
  CUTS_PER_COLUMN,
  MATCH_NONE,
  THRESHOLD_SIGN_COLUMN,
  VerdictKeyPlan,
  valueCuts,
  verdictKeyEval,
  verdictKeyOf,
  verdictKeyPlan,
  verdictOfKey,
  verdictWhere,
} from './eval_verdict_keys';
import {
  buildDistinctAggQuery,
  buildMatchingTraceIdsQuery,
  buildResultsPageQuery,
  buildSummaryAggQuery,
  buildTrendAggQuery,
  buildVerdictKeysQuery,
} from './eval_ppl';
import { buildRunCasesAggQuery, buildRunGradesAggQuery } from './eval_runs_agg';

/**
 * The grouping is generic over the clause list: these tests prepend name-based clauses (exact
 * names and prefixes, thresholds both ways, label lists) to the built-in ones, to check it
 * holds for many rules and bounds, not only for the producer and built-in clauses.
 */
interface TestRule {
  direction?: string;
  threshold?: number;
  min?: number;
  max?: number;
  passLabels?: string[];
  failLabels?: string[];
}

/** The rules the bug was reported with. */
const SEVEN = {
  tool_call_success_rate: { direction: 'maximize', threshold: 0.5, min: 0, max: 1 },
  tool_diversity: { direction: 'maximize', threshold: 0.34, min: 0, max: 1 },
  span_coverage: { direction: 'maximize', threshold: 0.67, min: 0, max: 1 },
  error_free: { direction: 'maximize', threshold: 1, min: 0, max: 1 },
  answer_quality: { direction: 'maximize', threshold: 4, min: 1, max: 5 },
  session_goal_success: { direction: 'maximize', threshold: 4, min: 1, max: 5 },
  handles_missing_data: { passLabels: ['pass'], failLabels: ['fail'] },
};

/** 50 rules: thresholds both ways, prefixes, label lists. */
const fifty = (): Record<string, unknown> => {
  const rules: Record<string, unknown> = {};
  for (let i = 0; i < 50; i++) {
    const name = i % 10 === 9 ? `group_${i}_*` : `eval_${i}`;
    if (i % 5 === 0) {
      rules[name] = {
        passLabels: Array.from({ length: 8 }, (_, j) => `Good Label ${i}.${j}`),
        failLabels: Array.from({ length: 8 }, (_, j) => `Bad Label ${i}.${j}`),
      };
    } else if (i % 5 === 1) {
      rules[name] = { failLabels: [`Nope ${i}`, `NO ${i}`] };
    } else {
      rules[name] = {
        direction: i % 3 === 0 ? 'minimize' : 'maximize',
        threshold: Math.round(i * 7.3) / 10,
      };
    }
  }
  return rules;
};

const clausesOf = (rules: Record<string, unknown>): Clause[] => {
  const nameCond = (p: string): Cond =>
    p.endsWith('*') ? { k: 'prefix', v: p.slice(0, -1) } : { k: 'name', v: p };
  const specificity = (p: string) => (p.endsWith('*') ? p.length : Number.MAX_SAFE_INTEGER);
  const patterns = Object.keys(rules).sort((a, b) => specificity(b) - specificity(a));
  const clauses: Clause[] = [];
  patterns.forEach((pattern, i) => {
    const rule = rules[pattern] as TestRule;
    const earlier = patterns.slice(0, i).map(nameCond);
    const target: Cond = earlier.length
      ? { k: 'and', c: [nameCond(pattern), { k: 'not', c: { k: 'or', c: earlier } }] }
      : nameCond(pattern);
    const when = (c: Cond): Cond => ({ k: 'and', c: [target, c] });
    const labelled: Cond = { k: 'notnull', f: 'label' };
    if (rule.passLabels) {
      clauses.push({ when: when({ k: 'in', f: 'label', v: rule.passLabels }), outcome: 'pass' });
    }
    if (rule.failLabels) {
      clauses.push({ when: when({ k: 'in', f: 'label', v: rule.failLabels }), outcome: 'fail' });
    }
    if (rule.passLabels && !rule.failLabels)
      clauses.push({ when: when(labelled), outcome: 'fail' });
    if (rule.failLabels && !rule.passLabels)
      clauses.push({ when: when(labelled), outcome: 'pass' });
    if (rule.threshold !== undefined) {
      const op = rule.direction === 'minimize' ? '<=' : '>=';
      clauses.push({ when: when({ k: 'cmp', op, v: rule.threshold }), outcome: 'pass' });
      clauses.push({ when: when({ k: 'notnull', f: 'value' }), outcome: 'fail' });
    }
  });
  const [error, ...rest] = buildVerdictClauses();
  return [error, ...clauses, ...rest];
};

/** What the engine computes for one result: its fields and the key columns. */
const serverRow = (input: VerdictInput, plan: VerdictKeyPlan): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  (Object.keys(VERDICT_PPL_FIELDS) as Array<keyof typeof VERDICT_PPL_FIELDS>).forEach((f) => {
    row[VERDICT_PPL_FIELDS[f]] = input[f] ?? null;
  });
  const v = input.value;
  plan.columns.forEach(({ name, cuts }) => {
    if (v === undefined) {
      row[name] = -1;
      return;
    }
    const i = cuts.findIndex((c) => (c.kind === 'lt' ? v < c.b : v <= c.b));
    row[name] = i === -1 ? cuts.length : i;
  });
  if (plan.thresholdSign) {
    const t = input.threshold;
    row[THRESHOLD_SIGN_COLUMN] =
      v === undefined || t === undefined ? -2 : v < t ? -1 : v === t ? 0 : 1;
  }
  return row;
};

/** Results around every bound, for every kind of name, with and without producer fields. */
const sampleInputs = (clauses: Clause[], names: string[]): VerdictInput[] => {
  const bounds = valueCuts(clauses).map((c) => c.b);
  const values: Array<number | undefined> = [undefined, -100, 100];
  bounds.forEach((b) => values.push(b, b - 0.001, b + 0.001));
  const labels = [undefined, '', 'pass', 'PASS ', 'fail', 'Not Harmful', 'harmful', 'other'];
  const inputs: VerdictInput[] = [];
  let i = 0;
  names.forEach((name) =>
    values.forEach((value) =>
      labels.forEach((label) => {
        i++;
        inputs.push({
          name,
          value,
          label,
          errorType: i % 23 === 0 ? 'Timeout' : undefined,
          assessment: i % 7 === 0 ? 'pass' : i % 11 === 0 ? 'FAIL' : undefined,
          threshold: i % 3 === 0 ? 0.5 : i % 5 === 0 ? value : undefined,
          direction: i % 4 === 0 ? 'minimize' : i % 6 === 0 ? 'maximize' : undefined,
          source: i % 2 === 0 ? 'agentcore' : 'opensearch-sdk',
        });
      })
    )
  );
  return inputs;
};

// A tiny compiler of the `where` conditions `verdictWhere` writes, to check what they keep.
type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;
const compileWhere = (where: string): Pred => {
  const tokens =
    where.match(/`[^`]+`|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|<=|>=|!=|[()=<>,]|[a-z]+/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const operand = (): ((row: Row) => unknown) => {
    const t = next();
    if (t.startsWith('`')) {
      const f = t.slice(1, -1);
      return (row) => row[f] ?? null;
    }
    const constant = t.startsWith("'") ? t.slice(1, -1).replace(/\\(.)/g, '$1') : Number(t);
    return () => constant;
  };
  const primary = (): Pred => {
    const t = peek();
    if (t === '(') {
      next();
      const p = disjunction();
      next(); // ')'
      return p;
    }
    if (t === 'isnull' || t === 'isnotnull') {
      next();
      next(); // '('
      const v = operand();
      next(); // ')'
      return t === 'isnull' ? (row) => v(row) === null : (row) => v(row) !== null;
    }
    const left = operand();
    const op = next();
    if (op === 'in') {
      next(); // '('
      const list: Array<(row: Row) => unknown> = [];
      while (peek() !== ')') {
        list.push(operand());
        if (peek() === ',') next();
      }
      next();
      return (row) => {
        const l = left(row);
        return l !== null && list.some((x) => x(row) === l);
      };
    }
    const right = operand();
    const cmp: Record<string, (a: number, b: number) => boolean> = {
      '=': (a, b) => a === b,
      '<': (a, b) => a < b,
      '<=': (a, b) => a <= b,
      '>': (a, b) => a > b,
      '>=': (a, b) => a >= b,
    };
    const f = cmp[op];
    if (!f) throw new Error(`unexpected ${op}`);
    return (row) => {
      const a = left(row);
      const b = right(row);
      return a !== null && b !== null && f(a as number, b as number);
    };
  };
  const conjunction = (): Pred => {
    const parts = [primary()];
    while (peek() === 'and') {
      next();
      parts.push(primary());
    }
    return (row) => parts.every((p) => p(row));
  };
  const disjunction = (): Pred => {
    const parts = [conjunction()];
    while (peek() === 'or') {
      next();
      parts.push(conjunction());
    }
    return (row) => parts.some((p) => p(row));
  };
  const pred = disjunction();
  if (pos !== tokens.length) throw new Error(`trailing tokens in ${where}`);
  return pred;
};

const NAMES = [
  ...Object.keys(SEVEN),
  'eval_2',
  'eval_3',
  'eval_5',
  'eval_6',
  'group_9_a',
  'group_19_b',
  'Builtin.Correctness',
  'Builtin.Harmfulness',
  'Builtin.Refusal',
  "it's custom",
];

describe.each([
  ['no rules', {}],
  ['the 7 reported rules', SEVEN],
  ['50 rules', fifty()],
])('verdicts from groups, %s', (_title, rules) => {
  const clauses = clausesOf(rules);
  const plan = verdictKeyPlan(clauses);
  const inputs = sampleInputs(clauses, NAMES);
  const rows = inputs.map((input) => serverRow(input, plan));
  const keys = rows.map((r) => verdictKeyOf(r, plan));

  const expected = inputs.map((input) => verdictOf(input, clauses));

  it('gives every result the verdict of its own fields', () => {
    expect(new Set(expected).size).toBeGreaterThan(2);
    const wrong = inputs.filter((_, i) => verdictOfKey(keys[i], plan, clauses) !== expected[i]);
    expect(wrong).toEqual([]);
  });

  it.each<[EvalOutcome[]]>([[['fail']], [['pass', 'fail']], [['error']], [['neutral', 'pass']]])(
    'filters %j with a where that keeps exactly those results',
    (outcomes) => {
      const where = verdictWhere(keys, plan, clauses, outcomes);
      const keeps = where === MATCH_NONE ? () => false : compileWhere(where);
      const wrong = inputs.filter((_, i) => keeps(rows[i]) !== outcomes.includes(expected[i]));
      expect(wrong).toEqual([]);
    }
  );
});

describe('query size', () => {
  const BUDGET = 6000;
  const fiftyClauses = clausesOf(fifty());

  it('does not grow with the number of rules or labels', () => {
    const ctx = { index: 'otel-v1-genai-evaluation*', clauses: fiftyClauses };
    const none = { index: 'otel-v1-genai-evaluation*', clauses: clausesOf({}) };
    const queries = [
      buildSummaryAggQuery({}, ctx),
      buildTrendAggQuery({}, 3600 * 1000, ctx),
      buildVerdictKeysQuery({}, ctx),
      buildRunGradesAggQuery({}, ctx),
      buildResultsPageQuery({}, { field: 'result', direction: 'asc' }, 0, 25, ctx),
    ];
    queries.forEach((q) => {
      expect(q.length).toBeLessThan(BUDGET);
      // No rule name, label list or per-clause lower() reaches the engine.
      expect(q).not.toContain('eval_12');
      expect(q).not.toContain('Good Label');
      expect(q).not.toMatch(/lower\(/i);
    });
    // Only the distinct numeric bounds add to the query, a few dozen bytes each.
    const growth = buildSummaryAggQuery({}, ctx).length - buildSummaryAggQuery({}, none).length;
    expect(growth).toBeLessThan(valueCuts(fiftyClauses).length * 80);
  });

  it('splits the bounds over small bucket columns', () => {
    const plan = verdictKeyPlan(fiftyClauses);
    expect(plan.columns.length).toBeGreaterThan(1);
    plan.columns.forEach((c) => expect(c.cuts.length).toBeLessThanOrEqual(CUTS_PER_COLUMN));
    const evalCommand = verdictKeyEval(plan) ?? '';
    evalCommand.split(/, (?=evl_)/).forEach((column) => expect(column.length).toBeLessThan(1600));
  });

  it('keeps verdict filters to plain field conditions', () => {
    const plan = verdictKeyPlan(fiftyClauses);
    const keys = sampleInputs(fiftyClauses, NAMES).map((input) =>
      verdictKeyOf(serverRow(input, plan), plan)
    );
    const where = verdictWhere(keys, plan, fiftyClauses, ['fail']);
    expect(where).not.toMatch(/case\(|lower\(/);
    const q = buildMatchingTraceIdsQuery({}, 500, { verdictWhere: where });
    expect(q).toContain(`| where ${where} |`);
    expect(buildDistinctAggQuery({}, { verdictWhere: where })).toContain(where);
    expect(buildRunCasesAggQuery({}, { verdictWhere: where })).toContain(where);
  });

  it('says when no group has the verdict', () => {
    const clauses = clausesOf(SEVEN);
    const plan = verdictKeyPlan(clauses);
    const key = verdictKeyOf(
      serverRow({ name: 'error_free', value: 1, source: 'opensearch-sdk' }, plan),
      plan
    );
    expect(verdictWhere([key], plan, clauses, ['fail'])).toBe(MATCH_NONE);
    expect(verdictWhere([key], plan, clauses, ['pass'])).toBe(
      "`attributes.gen_ai.evaluation.name` = 'error_free'"
    );
  });

  it('leaves out fields the index does not map', () => {
    const missing = new Set([VERDICT_PPL_FIELDS.threshold, VERDICT_PPL_FIELDS.assessment]);
    const plan = verdictKeyPlan(clausesOf(SEVEN), missing);
    expect(plan.thresholdSign).toBe(false);
    const q = buildSummaryAggQuery({}, { clauses: clausesOf(SEVEN), missing });
    expect(q).not.toContain('threshold');
    expect(q).not.toContain('assessment');
    expect(q).toContain('evl_vb0 = case(');
  });
});
