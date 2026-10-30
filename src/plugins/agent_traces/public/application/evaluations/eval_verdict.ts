/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Verdicts of evaluation results: pass, fail, evaluator error, or neutral ("Scored").
 *
 * Only declared rules decide, in this order (the first that decides wins):
 * 1. the evaluator errored (`error.type`): error;
 * 2. the producer's assessment, `opensearch.evaluation.assessment` (pass | fail);
 * 3. the producer's threshold, `opensearch.evaluation.score.threshold`, in the direction
 *    `opensearch.evaluation.score.direction` (maximize when unset);
 * 4. built-in rules for known evaluators (Bedrock AgentCore `Builtin.*` and AgentCore custom
 *    evaluators that answer Pass or Fail);
 * 5. otherwise neutral: the result is a score without a pass rule, left out of pass rates.
 *
 * The rules are one ordered list of clauses, evaluated in the browser: on fetched results,
 * and on aggregated rows grouped by what the verdict reads (`eval_verdict_keys.ts`), so
 * server-side aggregations count exactly what the badges show.
 */

export type EvalOutcome = 'pass' | 'fail' | 'error' | 'neutral';

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
  /**
   * Sign of `value - threshold` when only that is known (aggregated rows): comparisons with
   * the producer threshold read it instead of `value` and `threshold`.
   */
  thresholdSign?: number;
}

export type VerdictField = Exclude<keyof VerdictInput, 'thresholdSign'>;

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
export const buildVerdictClauses = (): Clause[] => [
  { when: notnull('errorType'), outcome: 'error' },
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
      if (cond.v === 'threshold' && input.thresholdSign !== undefined) {
        return cond.op === '>=' ? input.thresholdSign >= 0 : input.thresholdSign <= 0;
      }
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

/** Name of the verdict column aggregated rows carry once their verdict is applied. */
export const VERDICT_COLUMN = 'evl_verdict';

/** The verdict clauses, in precedence order. */
export const VERDICT_CLAUSES: Clause[] = buildVerdictClauses();
