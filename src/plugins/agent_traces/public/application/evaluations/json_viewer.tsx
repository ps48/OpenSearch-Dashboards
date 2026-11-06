/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { EuiAccordion, EuiCodeBlock, EuiText } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { toPrettyJson } from '../pages/traces/flyout/message_content_view';

const NOT_RECORDED = i18n.translate('agentTraces.evals.json.notRecorded', {
  defaultMessage: 'Not recorded',
});

/** Whether a value reads as JSON (structured, or a string that parses as an object / array). */
export const isJsonLike = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'string') return typeof value === 'object';
  const t = value.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};

/**
 * A raw value as Discover's JSON tab and the Agent Traces JSON view show it: a syntax
 * highlighted, copyable code block (pretty JSON, else plain text).
 */
export const JsonBlock: React.FC<{
  value: unknown;
  overflowHeight?: number;
  testId?: string;
}> = ({ value, overflowHeight = 300, testId }) => {
  const text = toPrettyJson(value);
  if (!text) {
    return (
      <EuiText size="xs" color="subdued" data-test-subj={testId}>
        {NOT_RECORDED}
      </EuiText>
    );
  }
  return (
    <EuiCodeBlock
      language={isJsonLike(value) ? 'json' : 'text'}
      isCopyable
      overflowHeight={overflowHeight}
      paddingSize="s"
      fontSize="s"
      data-test-subj={testId}
    >
      {text}
    </EuiCodeBlock>
  );
};

/**
 * A collapsed JSON block: the value (or `read()`, for a value that is costly to build) is
 * only built and drawn once the accordion opens.
 */
export const JsonAccordion: React.FC<{
  id: string;
  label: React.ReactNode;
  value?: unknown;
  read?: () => unknown;
  extraAction?: React.ReactNode;
  initialIsOpen?: boolean;
  overflowHeight?: number;
  testId?: string;
}> = ({ id, label, value, read, extraAction, initialIsOpen = false, overflowHeight, testId }) => {
  const [open, setOpen] = useState(initialIsOpen);
  return (
    <EuiAccordion
      id={id}
      buttonContent={label}
      extraAction={extraAction}
      initialIsOpen={initialIsOpen}
      onToggle={setOpen}
      paddingSize="s"
      data-test-subj={testId}
    >
      {open ? <JsonBlock value={read ? read() : value} overflowHeight={overflowHeight} /> : null}
    </EuiAccordion>
  );
};
