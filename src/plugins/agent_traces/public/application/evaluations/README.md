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

## Links

- Run page: `#/?_a=(tab:runs,run:'<test.suite.run.id>')` opens one run whatever its date (CI
  jobs link here; keep the `run` key).
- Evaluation runs time range: `_a=(runsTime:(from:now-30d,to:now))`, the last 7 days by default.
  Overview and Results use the global time range, the last 24 hours when the link has none.
- Evaluation drill-down on Overview: `_a=(evaluation:'<gen_ai.evaluation.name>')`.
