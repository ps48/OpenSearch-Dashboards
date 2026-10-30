/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export const PLUGIN_ID = 'agentTraces';
export const PLUGIN_NAME = 'Agent Traces';
export const AGENT_TRACES_NAV_ID = 'agentTraces/traces';
export const AGENT_SPANS_NAV_ID = 'agentTraces/spans';
export const AGENT_EVALS_NAV_ID = 'agentTraces/evaluations';
/** Index pattern of GenAI evaluation results (`gen_ai.evaluation.result` events), one doc per
 *  result. Data Prepper routes the events here from the OTLP logs path. The Evaluations page
 *  reads the evaluations dataset correlated with the traces dataset instead; Agent Traces
 *  falls back to this pattern without that correlation. */
export const AGENT_EVALS_INDEX_PATTERN = 'otel-v1-genai-evaluation-*';
export const DEFAULT_COLUMNS_SETTING = 'defaultColumns';
export const SAMPLE_SIZE_SETTING = 'discover:sampleSize';
export const SORT_DEFAULT_ORDER_SETTING = 'discover:sort:defaultOrder';
export const DOC_HIDE_TIME_COLUMN_SETTING = 'doc_table:hideTimeColumn';
export const MODIFY_COLUMNS_ON_SWITCH = 'discover:modifyColumnsOnSwitch';
export const DEFAULT_TRACE_COLUMNS_SETTING = 'explore:defaultTraceColumns';
export const DEFAULT_LOGS_COLUMNS_SETTING = 'explore:defaultLogsColumns';
export const AGENT_TRACES_DEFAULT_LANGUAGE = 'PPL';
export const AGENT_TRACES_TRACES_TAB_ID = 'traces';
export const AGENT_TRACES_SPANS_TAB_ID = 'spans';
export const AGENT_TRACES_VISUALIZATION_TAB_ID = 'visualization';
export const AGENT_TRACES_SESSIONS_TAB_ID = 'sessions';

/** Span attribute that groups traces into a session (OTel GenAI semantic conventions).
 *  Data Prepper normalizes OpenInference/ADOT `session.id` to this key at ingest. */
export const AGENT_TRACES_SESSION_ID_FIELD = 'attributes.gen_ai.conversation.id';

export enum AgentTracesFlavor {
  Traces = 'traces',
}

/** Hardcoded default columns for agent traces / spans tables. These are always
 *  present and cannot be removed by the user via the fields sidebar. */
export const AGENT_TRACES_DEFAULT_COLUMNS: readonly string[] = [
  'kind',
  'name',
  'status',
  'latency',
  'totalTokens',
  'evaluations',
  'input',
  'output',
];

/** Map from virtual column key to its user-facing display name. */
export const AGENT_TRACES_COLUMN_DISPLAY_NAMES: Record<string, string> = {
  kind: 'Kind',
  name: 'Name',
  status: 'Status',
  latency: 'Latency',
  totalTokens: 'Tokens',
  input: 'Input',
  output: 'Output',
  evaluations: 'Evaluations',
};

/** Virtual columns that support sorting in the DataTable. */
export const AGENT_TRACES_SORTABLE_COLUMNS = new Set<string>(['kind', 'name', 'status', 'latency']);

/** Map from virtual column key to the underlying source field(s) used for details/filtering. */
export const AGENT_TRACES_VIRTUAL_COLUMN_SOURCE_FIELDS: Record<string, string> = {
  kind: 'attributes.gen_ai.operation.name',
  status: 'status.code',
  latency: 'durationInNanos',
  input: 'attributes.gen_ai.input.messages',
  output: 'attributes.gen_ai.output.messages',
};
