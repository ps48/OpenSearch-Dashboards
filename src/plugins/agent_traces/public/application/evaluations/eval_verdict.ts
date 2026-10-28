/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Verdicts of evaluation results: pass, fail, evaluator error, or neutral ("Scored").
 *
 * Only declared rules decide, in this order (the first that decides wins):
 * 1. the evaluator errored (`error.type`): error;
 * 2. the `agentTraces:evaluationRules` advanced setting, by evaluation name;
 * 3. the producer's assessment, `opensearch.evaluation.assessment` (pass | fail);
 * 4. the producer's threshold, `opensearch.evaluation.score.threshold`, in the direction
 *    `opensearch.evaluation.score.direction` (maximize when unset);
 * 5. built-in rules for known evaluators (Bedrock AgentCore `Builtin.*` and AgentCore custom
 *    evaluators that answer Pass or Fail);
 * 6. otherwise neutral: the result is a score without a pass rule, left out of pass rates.
 *
 * The rules are one ordered list of clauses. The browser evaluates them on fetched results
 * and the same list compiles to a PPL `case(...)`, so server-side aggregations count exactly
 * what the badges show.
 */

import { EVALS_RULES_SETTING } from '../../../common';

export type EvalOutcome = 'pass' | 'fail' | 'error' | 'neutral';

/** Pass rule for an evaluation, from the `agentTraces:evaluationRules` setting. */
export interface EvaluationRule {
  /** Which way is better; `maximize` when a threshold is set without one. */
  direction?: 'maximize' | 'minimize';
  /** Values at or above (maximize) or at or below (minimize) pass; others fail. */
  threshold?: number;
  /** Score range, for charts that scale scores to 0..100%. Not a pass rule by itself. */
  min?: number;
  max?: number;
  /** Labels that pass. Alone: any other label fails. */
  passLabels?: string[];
  /** Labels that fail. Alone: any other label passes. */
  failLabels?: string[];
}

export interface RuleEntry {
  /** Evaluation name, or a prefix ending in `*`. */
  pattern: string;
  rule: EvaluationRule;
}

/** What the verdict reads from a result. */
export interface VerdictInput {
  name: string;
  value?: number;
  label?: string;
  errorType?: string;
  assessment?: string;
  threshold?: number;
  direction?: string;
  source?: string;
}

export type VerdictField = keyof VerdictInput;

/** PPL names of the fields the verdict reads. */
export const VERDICT_PPL_FIELDS: Record<VerdictField, string> = {
  name: 'attributes.gen_ai.evaluation.name',
  value: 'attributes.gen_ai.evaluation.score.value',
  label: 'attributes.gen_ai.evaluation.score.label',
  errorType: 'attributes.error.type',
  assessment: 'attributes.opensearch.evaluation.assessment',
  threshold: 'attributes.opensearch.evaluation.score.threshold',
  direction: 'attributes.opensearch.evaluation.score.direction',
  source: 'attributes.derived.evaluation.source',
};

// ---------------------------------------------------------------------------------------
// Conditions: a tiny language both the browser and PPL can evaluate
// ---------------------------------------------------------------------------------------

export type Cond =
  | { k: 'notnull'; f: VerdictField }
  /** Case-insensitive equality with one of the values (text fields). */
  | { k: 'in'; f: VerdictField; v: string[] }
  /** Exact evaluation name. */
  | { k: 'name'; v: string }
  /** One of these evaluation names. */
  | { k: 'names'; v: string[] }
  /** Evaluation name starting with `v` (case-sensitive). */
  | { k: 'prefix'; v: string }
  /** `value >= x` or `value <= x`; `x` a number or the producer threshold. */
  | { k: 'cmp'; op: '>=' | '<='; v: number | 'threshold' }
  | { k: 'and' | 'or'; c: Cond[] }
  | { k: 'not'; c: Cond };

export interface Clause {
  when: Cond;
  outcome: EvalOutcome;
}

const and = (...c: Cond[]): Cond => ({ k: 'and', c });
const or = (...c: Cond[]): Cond => ({ k: 'or', c });
const notnull = (f: VerdictField): Cond => ({ k: 'notnull', f });
const labelIn = (v: string[]): Cond => ({ k: 'in', f: 'label', v });

// ---------------------------------------------------------------------------------------
// Built-in rules for known evaluators
// ---------------------------------------------------------------------------------------

/**
 * Bedrock AgentCore built-in evaluators with a numerical rating scale report a value 0..1
 * (higher is better) with the scale's label: the built-in rule passes 0.5 and above (on the
 * scales seen, Partially Correct, Neutral/Mixed and better pass). Safety evaluators
 * (Harmfulness, Stereotyping) are decided by their label; Refusal not at all, whether a
 * refusal is good depends on the request.
 */
export const AGENTCORE_NUMERIC_BUILTINS = [
  'Builtin.Correctness',
  'Builtin.Faithfulness',
  'Builtin.Coherence',
  'Builtin.Conciseness',
  'Builtin.ResponseRelevance',
  'Builtin.ContextRelevance',
  'Builtin.Helpfulness',
  'Builtin.InstructionFollowing',
  'Builtin.GoalSuccessRate',
  'Builtin.ToolSelectionAccuracy',
  'Builtin.ToolParameterAccuracy',
];
export const AGENTCORE_LABEL_BUILTINS: Record<string, { pass: string[]; fail: string[] }> = {
  'Builtin.Harmfulness': { pass: ['not harmful'], fail: ['harmful'] },
  'Builtin.Stereotyping': { pass: ['not stereotyping'], fail: ['stereotyping'] },
};
export const AGENTCORE_BUILTIN_THRESHOLD = 0.5;

/** Score range of a known evaluator, for charts. */
export const builtinRange = (name: string): { min: number; max: number } | undefined =>
  name.startsWith('Builtin.') ? { min: 0, max: 1 } : undefined;

const builtinClauses = (): Clause[] => {
  const clauses: Clause[] = [];
  const numeric: Cond = { k: 'names', v: AGENTCORE_NUMERIC_BUILTINS };
  clauses.push({
    when: and(numeric, { k: 'cmp', op: '>=', v: AGENTCORE_BUILTIN_THRESHOLD }),
    outcome: 'pass',
  });
  clauses.push({ when: and(numeric, notnull('value')), outcome: 'fail' });
  Object.entries(AGENTCORE_LABEL_BUILTINS).forEach(([name, labels]) => {
    clauses.push({ when: and({ k: 'name', v: name }, labelIn(labels.pass)), outcome: 'pass' });
    clauses.push({ when: and({ k: 'name', v: name }, labelIn(labels.fail)), outcome: 'fail' });
  });
  // AgentCore custom evaluators with a pass/fail rating scale answer Pass or Fail.
  const agentcore: Cond = { k: 'in', f: 'source', v: ['agentcore'] };
  clauses.push({ when: and(agentcore, labelIn(['pass'])), outcome: 'pass' });
  clauses.push({ when: and(agentcore, labelIn(['fail'])), outcome: 'fail' });
  return clauses;
};

// ---------------------------------------------------------------------------------------
// The rules setting
// ---------------------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLabels = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim() !== '');

/** A valid rule, or the reason it is not. */
export const validateRule = (raw: unknown): EvaluationRule | string => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not an object';
  const r = raw as Record<string, unknown>;
  const known = ['direction', 'threshold', 'min', 'max', 'passLabels', 'failLabels'];
  const unknown = Object.keys(r).filter((k) => !known.includes(k));
  if (unknown.length) return `unknown keys ${unknown.join(', ')}`;
  const rule: EvaluationRule = {};
  if (r.direction !== undefined) {
    if (r.direction !== 'maximize' && r.direction !== 'minimize') {
      return 'direction must be maximize or minimize';
    }
    rule.direction = r.direction;
  }
  for (const key of ['threshold', 'min', 'max'] as const) {
    if (r[key] !== undefined) {
      if (!isNum(r[key])) return `${key} must be a number`;
      rule[key] = r[key] as number;
    }
  }
  if (rule.min !== undefined && rule.max !== undefined && rule.min >= rule.max) {
    return 'min must be below max';
  }
  for (const key of ['passLabels', 'failLabels'] as const) {
    if (r[key] !== undefined) {
      if (!isLabels(r[key])) return `${key} must be a list of labels`;
      rule[key] = (r[key] as string[]).map((l) => l.trim());
    }
  }
  return rule;
};

/** `*` only as the last character. */
const validPattern = (pattern: string) =>
  pattern.trim() !== '' && pattern !== '*' && !pattern.slice(0, -1).includes('*');

/** Exact names first, then longer prefixes: the most specific rule applies. */
const specificity = (pattern: string) =>
  pattern.endsWith('*') ? pattern.length : Number.MAX_SAFE_INTEGER;

/**
 * Rules from the setting value (an object, or its JSON text). Invalid entries are skipped
 * with a warning; the others still apply.
 */
export const parseEvaluationRules = (
  raw: unknown,
  // eslint-disable-next-line no-console
  warn: (message: string) => void = (m) => console.warn(m)
): RuleEntry[] => {
  let value = raw;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      value = JSON.parse(value);
    } catch {
      warn('agentTraces:evaluationRules is not valid JSON; no evaluation rules apply.');
      return [];
    }
  }
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object' || Array.isArray(value)) {
    warn('agentTraces:evaluationRules must be an object keyed by evaluation name.');
    return [];
  }
  const entries: RuleEntry[] = [];
  Object.entries(value as Record<string, unknown>).forEach(([pattern, ruleRaw]) => {
    if (!validPattern(pattern)) {
      warn(`agentTraces:evaluationRules: ignoring "${pattern}": "*" only at the end of a name.`);
      return;
    }
    const rule = validateRule(ruleRaw);
    if (typeof rule === 'string') {
      warn(`agentTraces:evaluationRules: ignoring "${pattern}": ${rule}.`);
      return;
    }
    if (!rule.passLabels && !rule.failLabels && rule.threshold === undefined) {
      if (rule.direction === undefined && rule.min === undefined && rule.max === undefined) {
        warn(`agentTraces:evaluationRules: ignoring "${pattern}": the rule is empty.`);
        return;
      }
    }
    entries.push({ pattern, rule });
  });
  return entries.sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
};

const patternCond = (pattern: string): Cond =>
  pattern.endsWith('*') ? { k: 'prefix', v: pattern.slice(0, -1) } : { k: 'name', v: pattern };

export const matchesPattern = (name: string, pattern: string) =>
  pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;

/** The setting's rule for an evaluation name (the most specific match). */
export const ruleFor = (entries: RuleEntry[], name: string): EvaluationRule | undefined =>
  entries.find((e) => matchesPattern(name, e.pattern))?.rule;

const settingClauses = (entries: RuleEntry[]): Clause[] => {
  const clauses: Clause[] = [];
  entries.forEach((entry, i) => {
    const earlier = entries.slice(0, i).map((e) => patternCond(e.pattern));
    const own = patternCond(entry.pattern);
    const target = earlier.length ? and(own, { k: 'not', c: or(...earlier) }) : own;
    const { passLabels, failLabels, threshold } = entry.rule;
    if (passLabels) {
      clauses.push({ when: and(target, labelIn(passLabels)), outcome: 'pass' });
    }
    if (failLabels) {
      clauses.push({ when: and(target, labelIn(failLabels)), outcome: 'fail' });
    }
    // One list alone: every other label is the opposite.
    if (passLabels && !failLabels) {
      clauses.push({ when: and(target, notnull('label')), outcome: 'fail' });
    }
    if (failLabels && !passLabels) {
      clauses.push({ when: and(target, notnull('label')), outcome: 'pass' });
    }
    if (threshold !== undefined) {
      const op = entry.rule.direction === 'minimize' ? '<=' : '>=';
      clauses.push({
        when: and(target, { k: 'cmp', op, v: threshold }),
        outcome: 'pass',
      });
      clauses.push({ when: and(target, notnull('value')), outcome: 'fail' });
    }
  });
  return clauses;
};

const producerClauses = (): Clause[] => {
  const minimize: Cond = { k: 'in', f: 'direction', v: ['minimize'] };
  const scored = and(notnull('threshold'), notnull('value'));
  return [
    { when: { k: 'in', f: 'assessment', v: ['pass'] }, outcome: 'pass' },
    { when: { k: 'in', f: 'assessment', v: ['fail'] }, outcome: 'fail' },
    { when: and(minimize, { k: 'cmp', op: '<=', v: 'threshold' }), outcome: 'pass' },
    { when: and(minimize, scored), outcome: 'fail' },
    { when: { k: 'cmp', op: '>=', v: 'threshold' }, outcome: 'pass' },
    { when: scored, outcome: 'fail' },
  ];
};

/** Every clause in precedence order; a result matching none is neutral. */
export const buildVerdictClauses = (entries: RuleEntry[] = []): Clause[] => [
  { when: notnull('errorType'), outcome: 'error' },
  ...settingClauses(entries),
  ...producerClauses(),
  ...builtinClauses(),
];

// ---------------------------------------------------------------------------------------
// Evaluation in the browser
// ---------------------------------------------------------------------------------------

const present = (v: unknown) => v !== undefined && v !== null && v !== '';

const test = (cond: Cond, input: VerdictInput): boolean => {
  switch (cond.k) {
    case 'notnull':
      return present(input[cond.f]);
    case 'in': {
      const v = input[cond.f];
      if (!present(v)) return false;
      const lower = String(v).trim().toLowerCase();
      return cond.v.some((x) => x.toLowerCase() === lower);
    }
    case 'name':
      return input.name === cond.v;
    case 'names':
      return cond.v.includes(input.name);
    case 'prefix':
      return input.name.startsWith(cond.v);
    case 'cmp': {
      const bound = cond.v === 'threshold' ? input.threshold : cond.v;
      if (input.value === undefined || bound === undefined) return false;
      return cond.op === '>=' ? input.value >= bound : input.value <= bound;
    }
    case 'and':
      return cond.c.every((c) => test(c, input));
    case 'or':
      return cond.c.some((c) => test(c, input));
    case 'not':
      return !test(cond.c, input);
  }
};

export const verdictOf = (input: VerdictInput, clauses: Clause[]): EvalOutcome =>
  clauses.find((c) => test(c.when, input))?.outcome ?? 'neutral';

// ---------------------------------------------------------------------------------------
// Compilation to PPL
// ---------------------------------------------------------------------------------------

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const field = (f: VerdictField) => `\`${VERDICT_PPL_FIELDS[f]}\``;

/**
 * A PPL boolean expression for the condition. Conditions on fields the index does not map
 * (`missing`, PPL rejects unknown fields) are false, as they are for a result without them.
 */
export const condToPpl = (cond: Cond, missing: ReadonlySet<string> = new Set()): string => {
  const absent = (f: VerdictField) => missing.has(VERDICT_PPL_FIELDS[f]);
  switch (cond.k) {
    case 'notnull':
      return absent(cond.f) ? 'false' : `isnotnull(${field(cond.f)})`;
    case 'in':
      if (absent(cond.f)) return 'false';
      return `lower(${field(cond.f)}) in (${cond.v.map((v) => quote(v.toLowerCase())).join(', ')})`;
    case 'name':
      return `${field('name')} = ${quote(cond.v)}`;
    case 'names':
      return `${field('name')} in (${cond.v.map(quote).join(', ')})`;
    case 'prefix':
      return `substring(${field('name')}, 1, ${cond.v.length}) = ${quote(cond.v)}`;
    case 'cmp': {
      if (absent('value') || (cond.v === 'threshold' && absent('threshold'))) return 'false';
      const bound = cond.v === 'threshold' ? field('threshold') : String(cond.v);
      return `${field('value')} ${cond.op} ${bound}`;
    }
    case 'and': {
      const parts = cond.c.map((c) => condToPpl(c, missing)).filter((p) => p !== 'true');
      if (parts.includes('false')) return 'false';
      return parts.length === 0
        ? 'true'
        : parts.length === 1
          ? parts[0]
          : `(${parts.join(' and ')})`;
    }
    case 'or': {
      const parts = cond.c.map((c) => condToPpl(c, missing)).filter((p) => p !== 'false');
      if (parts.includes('true')) return 'true';
      return parts.length === 0
        ? 'false'
        : parts.length === 1
          ? parts[0]
          : `(${parts.join(' or ')})`;
    }
    case 'not': {
      const inner = condToPpl(cond.c, missing);
      return inner === 'false' ? 'true' : inner === 'true' ? 'false' : `not ${inner}`;
    }
  }
};

/** Name of the verdict column the PPL `eval` adds. */
export const VERDICT_COLUMN = 'evl_verdict';

/**
 * The verdict as one PPL `case(...)` expression, each verdict written as `values[verdict]`
 * (a quoted word by default, a number for sort ranks).
 */
export const verdictCasePpl = (
  clauses: Clause[],
  missing: ReadonlySet<string> = new Set(),
  values: Record<EvalOutcome, string> = {
    pass: "'pass'",
    fail: "'fail'",
    error: "'error'",
    neutral: "'neutral'",
  }
): string => {
  const branches = clauses
    .map((c) => ({ cond: condToPpl(c.when, missing), outcome: c.outcome }))
    // Branches that can never match only lengthen the query.
    .filter((b) => b.cond !== 'false')
    .map((b) => `${b.cond}, ${values[b.outcome]}`);
  return branches.length ? `case(${branches.join(', ')} else ${values.neutral})` : values.neutral;
};

/** `eval evl_verdict = case(...)`: the verdict of each result, computed by the engine. */
export const verdictEvalPpl = (clauses: Clause[], missing: ReadonlySet<string> = new Set()) =>
  `eval ${VERDICT_COLUMN} = ${verdictCasePpl(clauses, missing)}`;

// ---------------------------------------------------------------------------------------
// Active rules: read from uiSettings once the plugin starts
// ---------------------------------------------------------------------------------------

export const EVAL_RULES_SETTING = EVALS_RULES_SETTING;

let readRules: (() => unknown) | undefined;
let cached: { raw: string; entries: RuleEntry[]; clauses: Clause[] } | undefined;

/** Called at plugin start with uiSettings; tests pass a function returning the value. */
export const setEvaluationRulesSource = (
  source: { get: (key: string, fallback?: unknown) => unknown } | (() => unknown) | undefined
) => {
  readRules =
    typeof source === 'function'
      ? source
      : source
        ? () => {
            try {
              return source.get(EVAL_RULES_SETTING, '{}');
            } catch {
              return undefined;
            }
          }
        : undefined;
  cached = undefined;
};

const active = () => {
  const value = readRules?.();
  let raw: string;
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  } catch {
    raw = '{}';
  }
  if (!cached || cached.raw !== raw) {
    const entries = parseEvaluationRules(value);
    cached = { raw, entries, clauses: buildVerdictClauses(entries) };
  }
  return cached;
};

/** The setting's rules, most specific first. */
export const getActiveRuleEntries = (): RuleEntry[] => active().entries;
/** The verdict clauses for the active rules. */
export const getActiveClauses = (): Clause[] => active().clauses;
