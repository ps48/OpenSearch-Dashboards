/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import '../pages/traces/flyout/message_content_view.scss';

import React, { useMemo, useState } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingContent,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  GenAiMessage,
  GenAiMessagePart,
  parseGenAiMessages,
  readAttribute,
} from '../pages/traces/hooks/genai_message_preview';
import {
  MarkdownText,
  MessageViewMode,
  MessageViewModeToggle,
} from '../pages/traces/flyout/message_content_view';
import { PplRecord, get, num, parseTime, str } from './eval_model';
import { COMPARE_SPANS_LIMIT, buildTraceSpansQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { QueryErrorCallout } from './eval_components';
import { JsonBlock } from './json_viewer';

/** One step of a case log: a message's text, a tool call (with arguments) or a tool result. */
export interface LogEntry {
  role: string;
  type: 'text' | 'tool_call' | 'tool_result';
  text?: string;
  name?: string;
  id?: string;
  value?: unknown;
}

interface LogEvent {
  at: number;
  order: number;
  messages?: GenAiMessage[];
  tool?: LogEntry;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `gen_ai.system_instructions` (parts, or text) as text. */
const systemText = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  let decoded = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (Array.isArray(decoded)) {
    const text = decoded
      .map((p) => (isObject(p) && typeof p.content === 'string' ? p.content : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return typeof decoded === 'string' ? decoded : JSON.stringify(decoded);
};

/** A message's entries: its text, then each tool call / tool result part. */
const entriesOfMessage = (m: GenAiMessage, seenTools: Set<string>): LogEntry[] => {
  const out: LogEntry[] = [];
  const text: string[] = [];
  const flush = () => {
    if (text.length) out.push({ role: m.role, type: 'text', text: text.join('\n') });
    text.length = 0;
  };
  m.parts.forEach((p: GenAiMessagePart) => {
    const id = str(p.id);
    if (p.type === 'text' || p.type === 'reasoning') {
      if (typeof p.content === 'string' && p.content.trim()) text.push(p.content);
    } else if (p.type === 'tool_call' || p.type === 'server_tool_call') {
      flush();
      if (id && seenTools.has(`call:${id}`)) return;
      if (id) seenTools.add(`call:${id}`);
      out.push({ role: m.role, type: 'tool_call', name: str(p.name), id, value: p.arguments });
    } else if (p.type === 'tool_call_response' || p.type === 'server_tool_call_response') {
      flush();
      if (id && seenTools.has(`result:${id}`)) return;
      if (id) seenTools.add(`result:${id}`);
      out.push({ role: m.role, type: 'tool_result', name: str(p.name), id, value: p.response });
    } else {
      text.push(`[${typeof p.modality === 'string' ? p.modality : p.type}]`);
    }
  });
  flush();
  return out;
};

/**
 * A case's message sequence from its trace's spans: each span's input messages when it
 * starts and its output messages when it ends, tool spans' arguments and results, in time
 * order. A message already shown (a later model call repeats the history) is shown once.
 */
export const caseLogOf = (rows: PplRecord[]): LogEntry[] => {
  const events: LogEvent[] = [];
  let system: string | undefined;
  rows.forEach((row, i) => {
    const doc = row as Record<string, unknown>;
    const start = parseTime(get(row, 'startTime'));
    const nanos = num(get(row, 'durationInNanos'));
    const end = nanos !== undefined ? start + nanos / 1e6 : parseTime(get(row, 'endTime'));
    system = system ?? systemText(readAttribute(doc, 'gen_ai.system_instructions'));
    const input = parseGenAiMessages(readAttribute(doc, 'gen_ai.input.messages'));
    const output = parseGenAiMessages(readAttribute(doc, 'gen_ai.output.messages'));
    if (input) events.push({ at: start, order: i * 2, messages: input });
    if (output) events.push({ at: end, order: i * 2 + 1, messages: output });
    const args = readAttribute(doc, 'gen_ai.tool.call.arguments');
    const result = readAttribute(doc, 'gen_ai.tool.call.result');
    if (!input && !output && (args !== undefined || result !== undefined)) {
      const name = str(readAttribute(doc, 'gen_ai.tool.name')) ?? str(row.name);
      const id = str(readAttribute(doc, 'gen_ai.tool.call.id'));
      events.push({
        at: start,
        order: i * 2,
        tool: { role: 'assistant', type: 'tool_call', name, id, value: args },
      });
      if (result !== undefined)
        events.push({
          at: end,
          order: i * 2 + 1,
          tool: { role: 'tool', type: 'tool_result', name, id, value: result },
        });
    }
  });
  const time = (t: number) => (Number.isFinite(t) ? t : Infinity);
  events.sort((a, b) => time(a.at) - time(b.at) || a.order - b.order);

  const out: LogEntry[] = system ? [{ role: 'system', type: 'text', text: system }] : [];
  const seenMessages = new Set<string>();
  const seenTools = new Set<string>();
  events.forEach((e) => {
    if (e.tool) {
      const key = `${e.tool.type === 'tool_call' ? 'call' : 'result'}:${e.tool.id}`;
      if (e.tool.id && seenTools.has(key)) return;
      if (e.tool.id) seenTools.add(key);
      out.push(e.tool);
      return;
    }
    (e.messages ?? []).forEach((m) => {
      const key = JSON.stringify(m);
      if (seenMessages.has(key)) return;
      seenMessages.add(key);
      if (m.role === 'system' && system) return;
      out.push(...entriesOfMessage(m, seenTools));
    });
  });
  return out;
};

const roleLabel = (e: LogEntry): string => {
  if (e.type === 'tool_call')
    return i18n.translate('agentTraces.evals.caseLog.toolCall', {
      defaultMessage: 'Tool call: {name}',
      values: { name: e.name ?? e.id ?? '' },
    });
  if (e.type === 'tool_result')
    return i18n.translate('agentTraces.evals.caseLog.toolResult', {
      defaultMessage: 'Tool result: {name}',
      values: { name: e.name ?? e.id ?? '' },
    });
  return e.role.charAt(0).toUpperCase() + e.role.slice(1);
};

/** The entries as the Formatted view's role-labeled messages; tool values in the JSON viewer. */
const FormattedLog: React.FC<{ entries: LogEntry[] }> = ({ entries }) => (
  <div className="agtMessageContent">
    {entries.map((e, i) => (
      <div
        className="agtMessageContent__message"
        key={i}
        data-test-subj={`agtEvlCaseLogEntry-${e.type}`}
      >
        <EuiText size="xs" color="subdued" className="agtMessageContent__role">
          <strong>{roleLabel(e)}</strong>
        </EuiText>
        {e.type === 'text' ? (
          <MarkdownText text={e.text ?? ''} />
        ) : (
          <JsonBlock value={e.value} overflowHeight={200} />
        )}
      </div>
    ))}
  </div>
);

/**
 * A case's full message sequence (system, user, assistant, tool calls and results), read
 * from its agent trace's spans with one bounded query when it mounts (the case opens).
 */
export const CaseLog: React.FC<{ traceId: string; caseId: string }> = ({ traceId, caseId }) => {
  const { spans, refreshKey } = useEvalContext();
  const { rows, loading, loaded, error } = usePplRows(
    spans,
    buildTraceSpansQuery(spans.title, [traceId]),
    undefined,
    refreshKey
  );
  const [mode, setMode] = useState<MessageViewMode>('formatted');
  const entries = useMemo(() => caseLogOf(rows), [rows]);
  return (
    <div className="agtEvlCaseLog" data-test-subj={`agtEvlCaseLog-${caseId}`}>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xxs">
            <span>
              {i18n.translate('agentTraces.evals.caseLog.title', { defaultMessage: 'Case log' })}
            </span>
          </EuiTitle>
        </EuiFlexItem>
        {loaded && (
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {i18n.translate('agentTraces.evals.caseLog.count', {
                defaultMessage: '{n} {n, plural, one {step} other {steps}} from {spans} spans',
                values: { n: entries.length, spans: rows.length },
              })}
            </EuiText>
          </EuiFlexItem>
        )}
        <EuiFlexItem />
        <EuiFlexItem grow={false}>
          <MessageViewModeToggle
            mode={mode}
            onChange={setMode}
            idPrefix={`agtEvlCaseLog-${caseId}`}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="xs" />
      {error ? (
        <QueryErrorCallout message={error} />
      ) : loading || !loaded ? (
        <EuiLoadingContent lines={3} />
      ) : (
        <>
          {rows.length >= COMPARE_SPANS_LIMIT && (
            <EuiText size="xs" color="subdued" data-test-subj="agtEvlCaseLogTruncated">
              <p>
                {i18n.translate('agentTraces.evals.caseLog.truncated', {
                  defaultMessage: 'Showing the first {limit} spans of this trace.',
                  values: { limit: COMPARE_SPANS_LIMIT },
                })}
              </p>
            </EuiText>
          )}
          {!entries.length ? (
            <EuiText size="xs" color="subdued" data-test-subj="agtEvlCaseLogEmpty">
              <p>
                {i18n.translate('agentTraces.evals.caseLog.empty', {
                  defaultMessage: 'No messages or tool calls were recorded on this trace.',
                })}
              </p>
            </EuiText>
          ) : mode === 'json' ? (
            <JsonBlock value={entries} overflowHeight={400} testId="agtEvlCaseLogJson" />
          ) : (
            <FormattedLog entries={entries} />
          )}
        </>
      )}
    </div>
  );
};
