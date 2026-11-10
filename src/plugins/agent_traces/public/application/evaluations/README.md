# Agent Evaluations (P0 and P0.5)

Read-only screens over `gen_ai.evaluation.result` events in the workspace's evaluations dataset
(set up by the setup assist, which proposes `otel-v1-genai-evaluation*`). Shown only when both
`explore.agentTraces.enabled` and `explore.agentTraces.evaluations.enabled` are on
(`eval_feature_flag.ts`).

## Data rules

- One verdict rule, computed in PPL (`VERDICT_EVAL` in `ppl_queries.ts`): `error.type` set is an
  evaluator error; `score.label` `pass` / `fail` is Pass / Fail; anything else is Scored. Pass
  rate = pass / (pass + fail). The UI never evaluates thresholds.
- Online results have no `test.suite.run.id`; offline results (suite runs) have one.
- Attribute names follow OTel; OpenSearch gap fields mirror them under `opensearch.*`:
  `opensearch.gen_ai.evaluation.*` (score.min, score.max, score.threshold, score.direction,
  evaluator.name, evaluator.type, evaluator.version, level, judge.trace_id) and
  `opensearch.test.case.expected` / `.expected_truncated` (offline results only).
- Level: `opensearch.gen_ai.evaluation.level`, else span when `spanId` is set, else trace.
- A version's pass rate is the mean of its evaluations' pass rates (each evaluation counts the
  same). A change with fewer than 30 results with a pass rule on either side is greyed.
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
to, whatever its level; without one, the trace's AI root by the Agent Traces rule (a GenAI or
marked root, else the earliest marked span, else the earliest GenAI span), never a non-GenAI
HTTP root.
