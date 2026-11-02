# Agent Evaluations (P0)

Read-only screens over `gen_ai.evaluation.result` events in the evaluations index
(`otel-v1-genai-evaluation-*`, or the workspace's evaluations dataset). Shown only when both
`explore.agentTraces.enabled` and `explore.agentTraces.evaluations.enabled` are on
(`eval_feature_flag.ts`).

## Data rules

- One verdict rule, computed in PPL (`VERDICT_EVAL` in `eval_ppl.ts`): `error.type` set is an
  evaluator error; `score.label` `pass` / `fail` is Pass / Fail; anything else is Scored. Pass
  rate = pass / (pass + fail). The UI never evaluates thresholds.
- Online results have no `test.suite.run.id`; offline results (suite runs) have one.
- Level: `opensearch.evaluation.level`, else span when `spanId` is set, else trace.
- Results without `gen_ai.agent.name` show as "(no agent name)" (route key `~none`).
- Case status is derived from its results: evaluator error > fail > pass.

## Screens and routes

| Route | Screen | File |
| --- | --- | --- |
| `#/agents` | Agents (home, tab Agents) | `agents_home.tsx` |
| `#/results` | Results (home, tab Results) | `results_view.tsx` |
| `#/agents/<agent>?tab=evaluations\|suites\|results` | Agent | `agent_page.tsx` |
| `#/suites/<suite>` | Suite | `suite_page.tsx` |
| `#/runs/<run id>` | Run (cases, expandable results) | `run_page.tsx` |
| `#/compare/<run A>/<run B>` | Compare runs (+ Compare traces flyout) | `compare_runs.tsx`, `trace_compare_flyout.tsx` |

The result flyout (`result_flyout.tsx`) opens from any result row and runs no query. Agent
Traces integration: the Evaluations column (`pages/traces/row_evaluations_context.tsx`), span
marks and the Evaluations tab of the trace flyout (`pages/traces/flyout/trace_evaluations.tsx`).

## Queries

Every builder is in `eval_ppl.ts`, with its exact text asserted in `eval_ppl.test.ts`. The time
range is applied by the PPL service (the dataset's `@timestamp`). A screen runs its queries only
while shown, and again only on a range, filter or Refresh change (`use_ppl_rows.ts`).
Aggregations end in `head 10000`; documents are read only for a page of results (25), one
expanded case (100), one trace (200) and the two traces of Compare traces.
