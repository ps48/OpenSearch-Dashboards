/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Verdicts of aggregated rows, with queries whose size does not grow with the rules.
 *
 * A PPL `case(...)` holding every rule is pushed down to OpenSearch as one inline script, and
 * that script grows with every rule and built-in clause until OpenSearch rejects it (65,535
 * bytes). Instead, aggregations group by what the verdict reads, and the browser applies the
 * rules to each group:
 *
 * - the text fields as they are: evaluation name, label, error type, assessment, direction,
 *   source (low cardinality; labels are compared case-insensitively in the browser);
 * - `evl_vb<i>`: where the value lies among the numeric bounds of the rules (each distinct
 *   bound once, whatever the number of rules naming it; long lists split over columns);
 * - `evl_tc`: the sign of `value - threshold` (the producer threshold), a fixed expression.
 *
 * A verdict filter (Fail only, traces where an evaluation fails) is a `where` naming the
 * groups whose verdict it keeps (`verdictWhere`). It is pushed down as a plain query on the
 * fields (terms and ranges), not as a script.
 */

import {
  Clause,
  Cond,
  EvalOutcome,
  VERDICT_PPL_FIELDS,
  VerdictField,
  VerdictInput,
  verdictOf,
} from './eval_verdict';

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const field = (f: VerdictField) => `\`${VERDICT_PPL_FIELDS[f]}\``;

/** Text fields grouped as they are. */
export const KEY_TEXT_FIELDS = ['label', 'errorType', 'assessment', 'direction', 'source'] as const;
type KeyTextField = (typeof KEY_TEXT_FIELDS)[number];

export const VALUE_BUCKET_PREFIX = 'evl_vb';
export const THRESHOLD_SIGN_COLUMN = 'evl_tc';
/** Bounds per bucket column: each pushed-down script stays near 12 KB (about 0.7 KB a bound). */
export const CUTS_PER_COLUMN = 16;

/**
 * A bound on the value. `lt`: from `value >= b` (below means `value < b`); `le`: from
 * `value <= b` (below means `value <= b`).
 */
export interface Cut {
  b: number;
  kind: 'lt' | 'le';
}

/** What a set of clauses needs grouped, for the fields the index maps. */
export interface VerdictKeyPlan {
  cuts: Cut[];
  /** Bucket columns, each over a run of consecutive cuts. */
  columns: Array<{ name: string; cuts: Cut[] }>;
  /** `evl_tc` is computed (value and threshold mapped). */
  thresholdSign: boolean;
  textFields: KeyTextField[];
  missing: ReadonlySet<string>;
}

const collectCuts = (cond: Cond, into: Cut[]) => {
  switch (cond.k) {
    case 'cmp':
      if (typeof cond.v === 'number')
        into.push({ b: cond.v, kind: cond.op === '>=' ? 'lt' : 'le' });
      return;
    case 'and':
    case 'or':
      cond.c.forEach((c) => collectCuts(c, into));
      return;
    case 'not':
      collectCuts(cond.c, into);
      return;
    default:
      return;
  }
};

/** Distinct bounds of the clauses, in value order (`lt` before `le` at the same bound). */
export const valueCuts = (clauses: Clause[]): Cut[] => {
  const all: Cut[] = [];
  clauses.forEach((c) => collectCuts(c.when, all));
  const seen = new Set<string>();
  return all
    .filter((c) => {
      const key = `${c.b}|${c.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((x, y) => x.b - y.b || (x.kind === y.kind ? 0 : x.kind === 'lt' ? -1 : 1));
};

const absent = (missing: ReadonlySet<string>, f: VerdictField) =>
  missing.has(VERDICT_PPL_FIELDS[f]);

export const verdictKeyPlan = (
  clauses: Clause[],
  missing: ReadonlySet<string> = new Set()
): VerdictKeyPlan => {
  const cuts = absent(missing, 'value') ? [] : valueCuts(clauses);
  const columns: VerdictKeyPlan['columns'] = [];
  // Without bounds, one column still tells whether there is a value.
  if (!absent(missing, 'value') && cuts.length === 0) {
    columns.push({ name: `${VALUE_BUCKET_PREFIX}0`, cuts: [] });
  }
  for (let i = 0; i < cuts.length; i += CUTS_PER_COLUMN) {
    columns.push({
      name: `${VALUE_BUCKET_PREFIX}${columns.length}`,
      cuts: cuts.slice(i, i + CUTS_PER_COLUMN),
    });
  }
  return {
    cuts,
    columns,
    thresholdSign: !absent(missing, 'value') && !absent(missing, 'threshold'),
    textFields: KEY_TEXT_FIELDS.filter((f) => !absent(missing, f)),
    missing,
  };
};

/** A PPL number literal (no exponent). */
const literal = (n: number) => {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/\.?0+$/, '') : s;
};
const below = (cut: Cut) => `${field('value')} ${cut.kind === 'lt' ? '<' : '<='} ${literal(cut.b)}`;
const above = (cut: Cut) => `${field('value')} ${cut.kind === 'lt' ? '>=' : '>'} ${literal(cut.b)}`;

/**
 * The `eval` adding the bucket columns and `evl_tc`, or nothing. A bucket column holds how
 * many of its cuts the value is above (-1 without a value).
 */
export const verdictKeyEval = (plan: VerdictKeyPlan): string | undefined => {
  const parts = plan.columns.map(
    ({ name, cuts }) =>
      `${name} = case(${[
        ...cuts.map((c, i) => `${below(c)}, ${i}`),
        `isnotnull(${field('value')}), ${cuts.length}`,
      ].join(', ')} else -1)`
  );
  if (plan.thresholdSign) {
    const v = field('value');
    const t = field('threshold');
    parts.push(
      `${THRESHOLD_SIGN_COLUMN} = case(${v} < ${t}, -1, ${v} = ${t}, 0, ${v} > ${t}, 1 else -2)`
    );
  }
  return parts.length ? `eval ${parts.join(', ')}` : undefined;
};

/** The `stats ... by` columns the verdict needs (name first). */
export const verdictKeyGroups = (plan: VerdictKeyPlan): string[] => [
  field('name'),
  ...plan.textFields.map(field),
  ...plan.columns.map((c) => c.name),
  ...(plan.thresholdSign ? [THRESHOLD_SIGN_COLUMN] : []),
];

/** What the verdict reads from one aggregated row. */
export interface VerdictKey {
  name: string;
  text: Partial<Record<KeyTextField, string>>;
  /** Region of the value among the cuts (0..cuts.length), -1 without a value. */
  region: number;
  /** Sign of `value - threshold`; -2 when either is missing; undefined when not grouped. */
  sign?: number;
}

const rawText = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);
const rawNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const verdictKeyOf = (record: Record<string, unknown>, plan: VerdictKeyPlan): VerdictKey => {
  const text: VerdictKey['text'] = {};
  plan.textFields.forEach((f) => {
    const v = rawText(record[VERDICT_PPL_FIELDS[f]]);
    if (v !== undefined) text[f] = v;
  });
  let region = plan.columns.length ? 0 : -1;
  for (const c of plan.columns) {
    const n = rawNum(record[c.name]);
    if (n === undefined || n < 0) {
      region = -1;
      break;
    }
    region += n;
  }
  return {
    name: rawText(record[VERDICT_PPL_FIELDS.name]) ?? '',
    text,
    region,
    sign: plan.thresholdSign ? (rawNum(record[THRESHOLD_SIGN_COLUMN]) ?? -2) : undefined,
  };
};

/** A value in the region: compared with every cut, it gives what the region's values give. */
export const regionValue = (cuts: Cut[], region: number): number | undefined => {
  if (region < 0) return undefined;
  if (cuts.length === 0) return 0;
  if (region === 0) return cuts[0].b - 1;
  if (region >= cuts.length) return cuts[cuts.length - 1].b + 1;
  const lower = cuts[region - 1];
  const upper = cuts[region];
  // Above an `lt` cut is `>= b`: b itself is in the region when the upper cut allows it.
  if (lower.kind === 'lt' && (upper.b > lower.b || upper.kind === 'le')) return lower.b;
  return (lower.b + upper.b) / 2;
};

export const verdictOfKey = (
  key: VerdictKey,
  plan: VerdictKeyPlan,
  clauses: Clause[]
): EvalOutcome => {
  const input: VerdictInput = {
    name: key.name,
    ...key.text,
    value: regionValue(plan.cuts, key.region),
  };
  if (key.sign !== undefined && key.sign > -2) {
    input.threshold = 0;
    input.thresholdSign = key.sign;
  }
  return verdictOf(input, clauses);
};

// ---------------------------------------------------------------------------------------
// A verdict filter as a `where` on the groups
// ---------------------------------------------------------------------------------------

type Dim = KeyTextField | 'region' | 'sign';

const dimValue = (key: VerdictKey, d: Dim): string => {
  if (d === 'region') return String(key.region);
  if (d === 'sign') return String(key.sign ?? '');
  const v = key.text[d];
  return v === undefined ? '\u0000' : `=${v}`;
};

const or = (parts: string[]) => (parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`);
const and = (parts: string[]) => (parts.length === 1 ? parts[0] : `(${parts.join(' and ')})`);

/** Condition on the value: one of the regions (consecutive regions make one range). */
const regionsCond = (cuts: Cut[], regions: number[]): string => {
  const sorted = Array.from(new Set(regions)).sort((a, b) => a - b);
  const parts: string[] = [];
  if (sorted[0] === -1) {
    parts.push(`isnull(${field('value')})`);
    sorted.shift();
  }
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const from = sorted[i];
    const to = sorted[j];
    const range: string[] = [];
    if (from > 0) range.push(above(cuts[from - 1]));
    if (to < cuts.length) range.push(below(cuts[to]));
    parts.push(range.length ? and(range) : `isnotnull(${field('value')})`);
    i = j + 1;
  }
  return or(parts);
};

const signCond = (signs: number[]): string => {
  const v = field('value');
  const t = field('threshold');
  const each: Record<number, string> = {
    [-1]: `${v} < ${t}`,
    0: `${v} = ${t}`,
    1: `${v} > ${t}`,
    [-2]: `(isnull(${v}) or isnull(${t}))`,
  };
  return or(Array.from(new Set(signs)).map((s) => each[s]));
};

const textCond = (f: KeyTextField, values: Array<string | undefined>): string => {
  const set = Array.from(new Set(values));
  const parts: string[] = [];
  const listed = set.filter((v): v is string => v !== undefined);
  if (listed.length === 1) parts.push(`${field(f)} = ${quote(listed[0])}`);
  if (listed.length > 1) parts.push(`${field(f)} in (${listed.map(quote).join(', ')})`);
  if (set.includes(undefined)) parts.push(`isnull(${field(f)})`);
  return or(parts);
};

const dimCond = (plan: VerdictKeyPlan, d: Dim, keys: VerdictKey[]): string => {
  if (d === 'region')
    return regionsCond(
      plan.cuts,
      keys.map((k) => k.region)
    );
  if (d === 'sign') return signCond(keys.map((k) => k.sign ?? -2));
  return textCond(
    d,
    keys.map((k) => k.text[d])
  );
};

/** Condition, within one evaluation, matching the wanted groups and none of the others. */
const nameCond = (plan: VerdictKeyPlan, wanted: VerdictKey[], others: VerdictKey[]): string => {
  const dims: Dim[] = [
    ...plan.textFields,
    ...(plan.columns.length ? (['region'] as Dim[]) : []),
    ...(plan.thresholdSign ? (['sign'] as Dim[]) : []),
  ];
  const all = [...wanted, ...others];
  const varying = dims.filter((d) => new Set(all.map((k) => dimValue(k, d))).size > 1);
  // One field telling them apart.
  for (const d of varying) {
    const w = new Set(wanted.map((k) => dimValue(k, d)));
    if (!others.some((k) => w.has(dimValue(k, d)))) return dimCond(plan, d, wanted);
  }
  // Otherwise each wanted group, on the fields that vary.
  const seen = new Set<string>();
  const groups: string[] = [];
  wanted.forEach((k) => {
    const id = varying.map((d) => dimValue(k, d)).join('\u0001');
    if (seen.has(id)) return;
    seen.add(id);
    groups.push(and(varying.map((d) => dimCond(plan, d, [k]))));
  });
  return or(groups);
};

/** Means the filter keeps nothing: run no query. */
export const MATCH_NONE = 'false';

/**
 * A `where` condition keeping the results whose verdict is one of `outcomes`, from the
 * groups of an aggregation under the same filters and time range. `MATCH_NONE` when no
 * group has such a verdict.
 */
export const verdictWhere = (
  keys: VerdictKey[],
  plan: VerdictKeyPlan,
  clauses: Clause[],
  outcomes: EvalOutcome[]
): string => {
  const byName = new Map<string, { wanted: VerdictKey[]; others: VerdictKey[] }>();
  keys.forEach((k) => {
    const entry = byName.get(k.name) ?? { wanted: [], others: [] };
    (outcomes.includes(verdictOfKey(k, plan, clauses)) ? entry.wanted : entry.others).push(k);
    byName.set(k.name, entry);
  });
  const whole: string[] = [];
  const partial: string[] = [];
  Array.from(byName.entries()).forEach(([name, { wanted, others }]) => {
    if (!wanted.length) return;
    if (!others.length) whole.push(name);
    else partial.push(`(${field('name')} = ${quote(name)} and ${nameCond(plan, wanted, others)})`);
  });
  const parts = [
    ...(whole.length === 1 ? [`${field('name')} = ${quote(whole[0])}`] : []),
    ...(whole.length > 1 ? [`${field('name')} in (${whole.map(quote).join(', ')})`] : []),
    ...partial,
  ];
  return parts.length ? or(parts) : MATCH_NONE;
};
