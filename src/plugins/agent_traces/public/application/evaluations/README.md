# Agent Evaluations

Read-only views of agent evaluation results, next to Agent Traces (Agent Monitoring, after
Traces and Spans).

## Data

Every query reads one index pattern, the evaluations dataset's (below). The index holds
three OpenTelemetry log events, told apart by `eventName`:

| `eventName` | One per | Used by |
|---|---|---|
| `gen_ai.evaluation.result` | grade (score, label, explanation) | everything |
| `opensearch.test_case.result` | test case of an offline run | Evaluation runs, run page, Compare |
| `opensearch.test_suite_run.result` | offline run | Evaluation runs, run page, Compare |

Grades join to agent spans on `traceId` and `spanId`, and to sessions on
`attributes.derived.session.id`. Every span lookup of the page (the result flyout's judged
target, the drill-down's agent, operation and tool breakdowns, the trace comparison) reads the
traces dataset of the app config (below), `otel-v1-apm-span-*` only when no config exists. A run without the test case or run events still shows, from
its grades.

## Evaluations dataset

The page reads the **evaluations dataset**: a logs dataset (index pattern with `signalType:
logs`) over the evaluation events, `otel-v1-genai-evaluation*` with time field `time` by
default, and the **traces dataset** the evaluations judge. Both are kept in the workspace's
Agent Evaluations app config, a saved object of type `correlations` shaped like APM's
`APM-Config-<workspace>` (one per workspace; `default` without workspaces):

```json
{
  "type": "correlations",
  "attributes": {
    "correlationType": "AgentEvals-Config-<workspace id>",
    "title": "AgentEvals-Config",
    "version": "1.0.0",
    "entities": [
      { "tracesDataset": { "id": "references[0].id" } },
      { "evaluationsDataset": { "id": "references[1].id" } }
    ]
  },
  "references": [
    { "name": "entities[0].index", "type": "index-pattern", "id": "<traces dataset>" },
    { "name": "entities[1].index", "type": "index-pattern", "id": "<evaluations dataset>" }
  ]
}
```

**Settings** (in the application header, a modal like APM's) edits it. Without a config it
proposes, for the user to confirm with Save: the traces dataset Agent Traces has open (else
the first traces dataset, the one Agent Traces opens on) and an existing logs dataset over
`otel-v1-genai-evaluation*`. When there is none, a callout offers **Create evaluations
dataset**: a logs index pattern `otel-v1-genai-evaluation*`, time field `time`, schema mappings
timestamp `time`, `traceId`, `spanId` and serviceName `resource.attributes.service.name`, its
fields read from the indices; it is then selected, and the modal says whether it was created
or why not. Save creates the config, or updates the workspace's config in place. A config
whose evaluations dataset was deleted shows the setup prompt; Settings then updates the same
object.

The dataset's index pattern is the PPL `source` of:

- the Agent Evaluations page (Overview, Results, Evaluation runs, run page, Compare, the
  evaluation drill-down and trace comparison grades);
- the Evaluations column of the Agent Traces tables and the Evaluations tab and chips of the
  trace and session flyouts. Without a config these keep reading
  `otel-v1-genai-evaluation-*`, where Data Prepper writes the events.

A pattern with spaces, quotes or `|` is not used. The trace details flyout's Related logs tab
lists logs datasets only, not evaluation events. Its Evaluations tab has **View in Logs**
(with an evaluations dataset set): Explore Logs on the evaluations dataset, filtered to the
trace id (`| where traceId = '...'`, the URL Related logs' View in Discover Logs builds), over
an hour around the trace's results.

## Header and empty states

The breadcrumb, the date picker and Settings share the application header's row (the
`HeaderControl` right controls, as in APM). On the Evaluation runs tab the header holds the
runs' own range (7 and 30 days, and a picker) instead of the global one. With the legacy
navigation the title, the description and the controls make a row at the top of the page.

- No evaluations dataset: what evaluations are, **Get started** (opens Settings), and links to
  the Agent evaluations docs and the AI observability docs.
- Dataset set, nothing in the range: "No evaluation results in this time range" with Last 24
  hours and Last 7 days (and Clear filters under filters) on Overview and Results; "No
  evaluation runs in this range" with Last 30 days on Evaluation runs.
- Dataset set, no evaluation index in the cluster yet: how results get there.

## Verdicts

Every result gets one verdict: **Pass**, **Fail**, **Evaluator error** or **Scored** (a score
without a pass rule). Only declared rules decide, in this order; the first that decides wins:

1. `error.type` is set: evaluator error.
2. The producer's assessment, `opensearch.evaluation.assessment` (`pass` or `fail`).
3. The producer's threshold, `opensearch.evaluation.score.threshold`, in the direction
   `opensearch.evaluation.score.direction` (`maximize`, the default when a threshold is set:
   values at or above pass; `minimize`: values at or below pass).
4. Built-in rules for Bedrock AgentCore:
   - `Builtin.*` evaluators with a numerical scale (Correctness, Faithfulness, Coherence,
     Conciseness, ResponseRelevance, ContextRelevance, Helpfulness, InstructionFollowing,
     GoalSuccessRate, ToolSelectionAccuracy, ToolParameterAccuracy) report 0..1: 0.5 and above
     pass. On the scales seen, Partially Correct, Neutral/Mixed and better pass.
   - `Builtin.Harmfulness` and `Builtin.Stereotyping` by label (`Not Harmful`, `Not
     Stereotyping` pass). `Builtin.Refusal` has no built-in rule.
   - AgentCore custom evaluators answering `Pass` or `Fail` (results with
     `derived.evaluation.source` `agentcore`).
5. Otherwise Scored: shown gray, left out of pass rates. Its Overview card shows the mean (or
   the top label) and a "No pass rule" hint, naming the producer attributes above and linking
   to the Agent evaluations docs.

There is no guess from label words or from the middle of a score range. Offline test cases
keep the status of their `opensearch.test_case.result` event. Chip colors mean the verdict
only: pass green, fail red, evaluator error amber, Scored gray. Level and source pills are
outlined in hues that carry no verdict.

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
(`stats ... by`, `span(@timestamp, ...)`), so they are exact at any volume. Distinct traces
and sessions use `distinct_count` (exact below 3,000 per period, approximate above).

The verdict rules are not compiled into the query (one `case(...)` holding every clause is
pushed down to OpenSearch as a single inline script, limited to 65,535 bytes). Aggregations
group instead by what the verdict reads, and the browser applies the rules to each group
(`eval_verdict_keys.ts`):

- evaluation name, label, `error.type`, assessment, direction and source, as they are;
- `evl_vb0`, `evl_vb1`, ...: where the value lies among the distinct numeric bounds of the
  rules (the built-in 0.5), 16 bounds a column;
- `evl_tc`: the sign of `value - opensearch.evaluation.score.threshold`.

The query grows only with the distinct bounds of the rules, about 60 characters each, never
with label lists or names. A verdict filter (Fail only, the Verdict filter, traces where an
evaluation fails, failing test cases of a run) first reads these groups, then queries with a
`where` naming the groups it keeps (`name in (...)`, or a name with a label, value range or
assessment), pushed down as plain term and range queries. Sorting Results by Result pages each
verdict apart, their counts known from the groups.

A query that fails (a limit of the engine, a timeout) leaves the rest of the page: a
"Some of this page could not be loaded" callout names the part and the reason ("Pass rules
too large for one query", ...), and the counts read as unknown rather than zero.

The Evaluation runs list is aggregated too, so it holds every run in its range: grades
`stats ... by test.suite.run.id, test.suite.name, gen_ai.evaluation.name, label, scale,
evl_verdict`, test cases per run from grades (`distinct_count` of
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
10,000, while pages on either side are complete, and these sizes never straddle it.

Every query is PPL and runs once against the index pattern; there is no DSL. PPL on
OpenSearch 3.9 drops the documents of indices that do not map a field an `eval` script names,
so the index template must map every field these views read (`gen_ai.evaluation.*`,
`opensearch.evaluation.*`, `derived.*`, `test.*`, `error.type`) from the first index on;
indices created before the template got those fields miss documents in verdict aggregations
until the mappings are added to them (`PUT <index>/_mapping` with the template's mappings).
Safety net: when PPL answers "Field [x] not found" (no index of the pattern maps `x`), the
query runs again without what needs `x`, and that is remembered for five minutes.

## Needs attention and Top changes

Overview, top to bottom: Needs attention, Top changes, the KPIs, Score trend and Results over
time, the evaluation cards (most failing first; each with a mini chart of its results over
time on a compact time axis), Recent failures. Every chart's tooltip names its bucket or score
bin.

The Overview opens with up to five findings computed from the aggregations of the range and of
the previous range of the same length (no LLM), most urgent first:

1. the biggest pass-rate drop (at least 1 point), linked to its drill-down;
2. the most regressed evaluation run in the range (largest drop in passing test cases, then
   most regressed evaluations, against the previous run of its suite), linked to the run;
3. the lowest pass rate, when it is below 80% or fell against the previous range (another
   evaluation than the drop);
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

There is no one-word run verdict: the runs table, the cases and the callouts show the counts
(`↓1 ↑1 of 2`) and the deltas, and the Evaluation runs list and the run page carry no
Regression badge (Needs attention still names the most regressed run).

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
- Open session: session-level results (the result flyout's Open session, their target in
  Results, Recent failures and the drill-down) open Agent Traces with
  `#/?_g=(time:(...))&_a=(ui:(activeTabId:traces))&openSessionId=<id>`: the session view
  (its traces and session results) opens once and the parameter leaves the URL, like
  `openTraceId` for traces. Either link clears a persisted "traces where it fails" filter
  first, always, so the flyout opens over the unfiltered table.
- Evaluation drill-down on Overview: `_a=(evaluation:'<gen_ai.evaluation.name>')`.
