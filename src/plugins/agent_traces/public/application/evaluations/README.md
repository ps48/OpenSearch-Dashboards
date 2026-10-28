# Agent Evaluations

Read-only views of agent evaluation results, next to Agent Traces (Agent Monitoring, after
Traces and Spans).

## Data

Every query reads one index pattern, `otel-v1-genai-evaluation-*` by default. The index holds
three OpenTelemetry log events, told apart by `eventName`:

| `eventName` | One per | Used by |
|---|---|---|
| `gen_ai.evaluation.result` | grade (score, label, explanation) | everything |
| `opensearch.test_case.result` | test case of an offline run | Evaluation runs, run page, Compare |
| `opensearch.test_suite_run.result` | offline run | Evaluation runs, run page, Compare |

Grades join to agent spans (`otel-v1-apm-span-*`) on `traceId` and `spanId`, and to sessions on
`attributes.derived.session.id`. A run without the test case or run events still shows, from
its grades.

## Setting: evaluations index pattern

`agentTraces:evaluationsIndexPattern` (Dashboards Management > Advanced settings, section
Observability) sets the index pattern read by:

- the Agent Evaluations page (Overview, Results, Evaluation runs, run page, Compare, the
  evaluation drill-down and trace comparison grades);
- the Evaluations column of the Agent Traces tables;
- the Evaluations tab and chips of the trace details flyout.

Default: `otel-v1-genai-evaluation-*`. Set it when your pipeline writes evaluation events to
another index, for example `my-team-evals-*`. A value with spaces, quotes or `|` is ignored
and the default is used.

## Verdicts

Every result gets one verdict: **Pass**, **Fail**, **Evaluator error** or **Scored** (a score
without a pass rule). Only declared rules decide, in this order; the first that decides wins:

1. `error.type` is set: evaluator error.
2. The `agentTraces:evaluationRules` setting (below), by evaluation name.
3. The producer's assessment, `opensearch.evaluation.assessment` (`pass` or `fail`).
4. The producer's threshold, `opensearch.evaluation.score.threshold`, in the direction
   `opensearch.evaluation.score.direction` (`maximize`, the default when a threshold is set:
   values at or above pass; `minimize`: values at or below pass).
5. Built-in rules for Bedrock AgentCore:
   - `Builtin.*` evaluators with a numerical scale (Correctness, Faithfulness, Coherence,
     Conciseness, ResponseRelevance, ContextRelevance, Helpfulness, InstructionFollowing,
     GoalSuccessRate, ToolSelectionAccuracy, ToolParameterAccuracy) report 0..1: 0.5 and above
     pass. On the scales seen, Partially Correct, Neutral/Mixed and better pass.
   - `Builtin.Harmfulness` and `Builtin.Stereotyping` by label (`Not Harmful`, `Not
     Stereotyping` pass). `Builtin.Refusal` has no built-in rule.
   - AgentCore custom evaluators answering `Pass` or `Fail` (results with
     `derived.evaluation.source` `agentcore`).
6. Otherwise Scored: shown gray, left out of pass rates. Its Overview card shows the mean (or
   the top label) and a "No pass rule" hint.

There is no guess from label words or from the middle of a score range. Offline test cases
keep the status of their `opensearch.test_case.result` event. Chip colors mean the verdict
only: pass green, fail red, evaluator error amber, Scored gray. Level and source pills are
outlined in hues that carry no verdict.

## Setting: evaluation pass rules

`agentTraces:evaluationRules` (Advanced settings, section Observability, JSON) maps evaluation
names to pass rules. A key ending in `*` matches a prefix; an exact name wins over a prefix,
a longer prefix over a shorter one.

```json
{
  "answer_quality": { "threshold": 4, "min": 1, "max": 5 },
  "latency_*": { "direction": "minimize", "threshold": 10 },
  "tone": { "passLabels": ["friendly", "neutral"] },
  "Builtin.*": { "threshold": 0.7 }
}
```

| Key | Meaning |
|---|---|
| `threshold` | Values at or above (maximize) or at or below (minimize) pass, others fail. |
| `direction` | `maximize` (default) or `minimize`. Also orients the score trend and cards. |
| `min`, `max` | Score range, for charts that scale scores to 0..100%. Not a pass rule. |
| `passLabels` | Labels that pass (case-insensitive). Alone: any other label fails. |
| `failLabels` | Labels that fail. Alone: any other label passes. With both, other labels fall through. |

A rule that does not decide a result (no matching label, no value) leaves it to the producer's
attributes and the built-in rules. Invalid entries are skipped with a browser console warning;
the others apply. The setting applies everywhere results are shown: chips, Overview cards and
KPIs, Results, run page, Compare, the trace flyout and the Evaluations column.

## Time range

Overview and Results use the global time range, shared with Explore and Agent Traces: it
carries over between apps, a link's `_g` wins, and on a fresh start it is the
`timepicker:timeDefaults` setting (the last 15 minutes). The app's last URL (tab, filters, run
range) is kept for the browser session like other apps (`lastUrl:` in session storage).
Evaluation runs have their own range in `_a.runsTime`, the last 7 days by default.

When the range ends less than 15 minutes ago and the index holds AgentCore results, a note
says AgentCore results arrive about 15 minutes after a session ends.

## Exact numbers

KPIs, evaluation cards (count, pass, fail, error and scored counts, mean, label split), the
score trend and results over time come from PPL aggregations on the evaluation index
(`eval evl_verdict = case(...)` with the verdict rules compiled to PPL, then `stats ... by`,
`span(@timestamp, ...)`), so they are exact at any volume. Distinct traces and sessions use
`distinct_count` (exact below 3,000 per period, approximate above). The Results table lists the
latest 5,000 results; its total is exact.

PPL on OpenSearch 3.9 drops the documents of indices that do not map a field an `eval`
script names (daily indices with dynamic mappings, where a new attribute such as
`opensearch.evaluation.assessment` exists only in newer indices). So each aggregation first
asks, in one DSL aggregation, which indices in the range hold which optional fields, then runs
once per group of indices naming only the fields that group holds, and adds up the rows.

## Traces where an evaluation fails

Result chips, Overview cards and Results rows have a menu: Show traces where it fails, with
its label, or with a value below or above its value. Agent Traces then lists only those traces
(distinct target trace ids of matching results in the time range, the first 500), with a
removable pill naming the condition. The filter is kept for the browser session.

## Links

- Run page: `#/?_a=(tab:runs,run:'<test.suite.run.id>')` opens one run whatever its date (CI
  jobs link here; keep the `run` key).
- Evaluation runs time range: `_a=(runsTime:(from:now-30d,to:now))`, the last 7 days by default.
  Overview and Results use the global time range (`_g`).
- Evaluation drill-down on Overview: `_a=(evaluation:'<gen_ai.evaluation.name>')`.
