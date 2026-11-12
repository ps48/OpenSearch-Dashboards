# Agent Evaluations (P0 and P0.5)

Read-only screens over `gen_ai.evaluation.result` events in the workspace's evaluations dataset
(set up by the setup assist, which proposes `otel-v1-genai-evaluation*`). Shown only when both
`explore.agentTraces.enabled` and `explore.agentTraces.evaluations.enabled` are on
(`eval_feature_flag.ts`).

## Data rules

- One verdict rule, computed in PPL (`VERDICT_EVAL` in `ppl_queries.ts`): `error.type` set is an
  evaluator error; `score.label` `pass` / `fail` is Pass / Fail; anything else is Scored. Pass
  rate = pass / (pass + fail). The UI never evaluates thresholds.
- PPL never runs an `eval` before a `stats` or a `where`: pushed down as a script, it fails on the
  backing indices that do not map a field it names (a fresh index after a rollover) and silently
  drops their results. Aggregations by verdict group by the raw `error.type` and `score.label`
  first and compute the verdict on those rows (`verdictStats`); the verdict filter is plain
  conditions on the raw fields (`verdictCond`). Averages are recomputed from sums and counts.
- Those first stages, and every `stats ... by` an optional field (`gen_ai.agent.name`,
  `gen_ai.agent.version`), rely on PPL keeping groups with a null key: `error.type` is null on
  almost every result. OpenSearch 3.9 keeps them with `plugins.ppl.syntax.legacy.preferred`
  `true` (the default) and drops them with `false` (checked on a throwaway index: the first stage
  returned no row at all; `bucket_nullable=true` keeps them either way but is not accepted by
  older engines). Conditional sums (`sum(case(...))`) are no way out: a script again, they drop
  the results of indices that do not map a field (2 of 5 lost in the same check). So the data
  check probes it (`buildNullGroupsCheckQuery`) and shows a "drops empty groups" empty state
  instead of wrong counts. The first stage is not capped by `plugins.query.size_limit` or
  `plugins.query.buckets` (only the final rows are, `isTruncated`).
- Online results have no `test.suite.run.id`; offline results (suite runs) have one.
- Attribute names follow OTel; OpenSearch gap fields mirror them under `opensearch.*`:
  `opensearch.gen_ai.evaluation.*` (score.min, score.max, score.threshold, score.direction,
  evaluator.name, evaluator.type, evaluator.version, level, judge.trace_id) and
  `opensearch.test.case.expected` / `.expected_truncated` (offline results only).
- Level: `opensearch.gen_ai.evaluation.level`, else span when `spanId` is set, else trace.
- A version's pass rate is pooled over its results: pass / (pass + fail) of all its evaluations
  together (`versionsOf`), so an evaluation with more results weighs more. Values are never faded
  for a small sample; the tooltips give n.
- Evaluations without a pass rule: numeric ones show the average score (direction-aware change,
  `score.direction` `minimize` means lower is better), categorical ones the most common label.
- Results without `gen_ai.agent.name` show as "(no agent name)" (route key `~none`).
- Case status is derived from its results: evaluator error > fail > pass.

## Screens and routes

| Route | Screen | File |
| --- | --- | --- |
| `#/agents` | Agents (home, tab Agents) | `agents_home.tsx` |
| `#/runs` | Eval runs (home, tab Eval runs) | `runs_view.tsx` |
| `#/results` | Eval results (home, tab Eval results) | `results_view.tsx` |
| `#/agents/<agent>?tab=evaluations\|suites\|results` | Agent | `agent_page.tsx` |
| `#/suites/<suite>` | Suite | `suite_page.tsx` |
| `#/runs/<run id>` | Run (cases, expandable results) | `run_page.tsx` |
| `#/compare/<run A>/<run B>` | Compare runs (+ Compare traces flyout) | `compare_runs.tsx`, `trace_compare_flyout.tsx` |

The result flyout (`result_flyout.tsx`) opens from any result row. It reads the judged span (or
the root span) for "What the judge saw", offline the case's results in this run and the run
before, and the judge trace (`opensearch.gen_ai.evaluation.judge.trace_id`) only when clicked.
Agent Traces integration: the Evaluations column (`pages/traces/row_evaluations_context.tsx`),
span marks and the Evaluations tab of the trace flyout (`pages/traces/flyout/trace_evaluations.tsx`),
and the session view's session evaluations. They show, and query, only with the flag on and an
Agent Evaluations config in the workspace (`useAgentTracesEvalsShown`), reading the config's
index and data source. A "failing evaluations only" traces filter is P1.

App state (`_a`): the filters, the version pair compared on each agent page (`versionPick`) and
a chart slice (`slice`, cleared by a new range or "Back to ...").

## Queries

Every builder, for these screens and for the evaluation parts of Agent Traces, is in
`ppl_queries.ts`, with its exact text asserted in `ppl_queries.test.ts`. The time range is applied
by the PPL service (the dataset's `@timestamp`). A screen runs its queries only while shown, and
again only on a range, filter or Refresh change (`use_ppl_rows.ts`). Aggregations end in
`head 10000`; documents are read only for a page of results (25), one case (100), one document
per run (100), per case of a run (500) or per evaluation of a run (100), the spans one or two
results point to (1 / 2) or, without a span id, up to 10 AI-root candidates of a trace, one trace
(200), the two traces of Compare traces (2000) and a session's
turns (50). Span lookups by trace id carry no time range.

Optional per-run and per-case values (run name and description, the CI run link
`cicd.pipeline.run.url.full`, the case name `test.case.name`) are never in a `stats ... by`: they
are the same on every result of a run or case, and PPL fails on a field the index mapping does
not have. They are read from one whole document per run (`buildRunNamesQuery`) or per case
(`buildCaseNamesQuery`).

What a result judged (case input and output, the result flyout) is the span its `spanId` points
to, whatever its level; without one, the span that stands for the trace
(`aiRootWithFallbackOf` in `utils/ai_root.ts`, which the trace flyout uses too: a GenAI or
marked root, else the earliest outermost marked span, else the earliest outermost GenAI span,
else the root), never a non-GenAI HTTP root with a GenAI span under it. The candidates are the
root and the first 10 GenAI spans (`buildAiRootCandidatesQuery`) plus, when the span index maps
the marker, the trace's marked spans read apart (`buildMarkedSpansQuery`), so earlier GenAI
calls cannot push the marked agent span out.
