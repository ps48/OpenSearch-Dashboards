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
Evaluation runs have their own range in `_a.runsTime`, the last 7 days by default, with 7 and
30 day buttons next to the picker.

When the range ends less than 15 minutes ago and the index holds AgentCore results, a note
says AgentCore results arrive about 15 minutes after a session ends.

## Exact numbers

KPIs, evaluation cards (count, pass, fail, error and scored counts, mean, label split), the
score trend and results over time come from PPL aggregations on the evaluation index
(`eval evl_verdict = case(...)` with the verdict rules compiled to PPL, then `stats ... by`,
`span(@timestamp, ...)`), so they are exact at any volume. Distinct traces and sessions use
`distinct_count` (exact below 3,000 per period, approximate above).

The Evaluation runs list is aggregated too, so it holds every run in its range: grades
`stats ... by test.suite.run.id, test.suite.name, gen_ai.evaluation.name, label, scale,
evl_verdict` (per index group), test cases per run from grades (`distinct_count` of
`test.case.id`: all, failing, passing or failing), test case events counted by run and
status, and the run events (one per run, read as is for their metadata). Counts and timing
come from the run event, else the case events, else the grades. Each evaluator cell shows
the change against the previous run of the suite (`4.92 ↑0.05`, colored by better or worse);
Agent version and Model come from the run metadata (`agent.version`, `agent.model`); Tokens
and Cost columns appear when run metadata has keys ending in `tokens` or holding `cost`. The
run page and Compare read their runs' events by run id.

The Results table reaches every result in the range: it is sorted (Time, Evaluation, Level,
Result) and paged in the query (`sort ... | head <size> from <offset>`), filters and search
included, with the exact total from the aggregation. Page sizes are 25, 50 and 100: on
OpenSearch 3.9 a page that straddles offset 10,000 (`plugins.query.size_limit`) is cut at
10,000, while pages on either side are complete, and these sizes never straddle it. Sorting
by Result or filtering on Failing only needs the verdict script; when the range spans
indices with different fields, each group of indices is read up to the page and merged in
the browser, which reaches the first 10,000 results in that order (the table says so past
that).

PPL on OpenSearch 3.9 drops the documents of indices that do not map a field an `eval`
script names (daily indices with dynamic mappings, where a new attribute such as
`opensearch.evaluation.assessment` exists only in newer indices). So each aggregation first
asks, in one DSL aggregation, which indices in the range hold which optional fields, then runs
once per group of indices naming only the fields that group holds, and adds up the rows.

## Needs attention and Top changes

The Overview opens with up to five findings computed from the aggregations of the range and of
the previous range of the same length (no LLM), most urgent first:

1. the biggest pass-rate drop (at least 1 point), linked to its drill-down;
2. the most regressed evaluation run in the range (largest drop in passing test cases, then
   most regressed evaluations, against the previous run of its suite), linked to the run;
3. the lowest pass rate below 100% (another evaluation than the drop);
4. a failing label the evaluation did not report in the previous range;
5. evaluations with results in the previous range and none in this one ("no results in this
   period"), linked to the previous range.

Without any: "Nothing needs attention in this range." Top changes then lists, per evaluation,
its pass rate (or its mean without a pass rule) with the change against the previous range,
worst change first (pass-rate points, or the mean normalized to its range), at most six.

## Traces where an evaluation fails

Result chips, Overview cards and Results rows have a menu: Show traces where it fails, with
its label, or with a value below or above its value. Agent Traces then lists only those traces
(distinct target trace ids of matching results in the time range, the first 500), with a
removable pill naming the condition. The filter is kept for the browser session.

## Compare runs

Select 2 to 5 runs of a suite on Evaluation runs and Compare. Runs are lettered columns (A to
E, oldest first) in hues that carry no verdict; one is the baseline, the others are measured
against it. Each compared run is read by its id, whatever its date.

- Runs table: pass rate with its change in points (`↓8 pp`) and "10 of 12 passed", the mean
  of each evaluation with its change, the duration, and Changes: test cases in both the run
  and the baseline that regressed, improved or did not change.
- Deltas are in the evaluation's unit (`↑0.25`), in points for scores on 0..1 and pass rates.
  They are colored by better or worse for the evaluation (its direction and range applied,
  as in `compareRuns`: a move under 5% of the range is no change), never by sign; gray when
  the range is unknown.
- Test cases: one column per run, a value chip per evaluation colored by verdict, the delta
  against the baseline, the duration, the trace, the case flyout and the step-by-step trace
  comparison with the baseline. Biggest regression first (summed normalized drops plus one
  per pass-to-fail flip), or most improved, or by name.
- A callout says when the runs are not comparable as is: different test cases, another
  evaluator, evaluator version or judge model for an evaluation, or no pass rule in one run
  for an evaluation others decide. Agent version and model changes (run metadata
  `agent.version`, `agent.model`) are listed neutrally.

### Run verdict

Each run other than the baseline gets one word, from the same changes, no LLM:

1. Evaluations whose mean got better or worse by more than 5% of its range.
2. Some better and some worse: **Tradeoff**. Only better: **Improvement**. Only worse:
   **Regression**.
3. No mean moved: more improved than regressed test cases is an Improvement, fewer a
   Regression, as many a **Tie**.

The evidence sentence names the evaluations ("Better on answer_quality, worse on
latency_budget") or the case counts.

## From a chart to its results

Click a bar or point in Results over time, the Score trend, a card's mini chart, the
drill-down's trend and histogram, or a run's score histogram: a small menu offers

- **Show these results**: the Results tab for that time bucket (the global time range is set
  to it), the evaluation and, for a bar, its verdict (`_a.verdicts`); a run's histogram adds
  the run (`_a.runIds`, a removable "Run:" pill) over the time its results span;
- **Show these traces**: Agent Traces filtered to the traces those results judged (as the
  result menus do), its time range opened from an hour before the bucket (traces precede
  their grades).

The Verdict filter (Pass, Fail, Evaluator error, Scored) is in the filter bar.

## Links

- Compare: `_a=(tab:runs,compare:!('<run A>','<run B>',...),baseline:'<run>')`; without
  `baseline` the first run is the baseline (2-run links from before the grid keep working).
- Run page: `#/?_a=(tab:runs,run:'<test.suite.run.id>')` opens one run whatever its date (CI
  jobs link here; keep the `run` key).
- Evaluation runs time range: `_a=(runsTime:(from:now-30d,to:now))`, the last 7 days by default.
  Overview and Results use the global time range (`_g`).
- Evaluation drill-down on Overview: `_a=(evaluation:'<gen_ai.evaluation.name>')`.
