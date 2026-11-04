/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import '../pages/traces/flyout/message_content_view.scss';

import React, { useState } from 'react';
import { EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  CopyContentButton,
  MessageContent,
  MessageViewMode,
  MessageViewModeToggle,
  copyTextFor,
} from '../pages/traces/flyout/message_content_view';

export interface IOSection {
  key: string;
  label: string;
  /** The raw attribute value: GenAI messages JSON or plain text. */
  value: unknown;
  /** A note after the label (e.g. the attribute name). */
  note?: string;
}

const NOT_RECORDED = i18n.translate('agentTraces.evals.io.notRecorded', {
  defaultMessage: 'Not recorded',
});

/**
 * Input, output and expected output as the Agent Traces span detail shows them: role-labeled
 * messages (Formatted) or the attribute JSON, with a copy button per section.
 */
export const SpanIOView: React.FC<{
  sections: IOSection[];
  idPrefix: string;
  /** Hide the Formatted / JSON switch (e.g. side by side, where the caller owns it). */
  mode?: MessageViewMode;
  testId?: string;
}> = ({ sections, idPrefix, mode: fixedMode, testId }) => {
  const [ownMode, setMode] = useState<MessageViewMode>('formatted');
  const mode = fixedMode ?? ownMode;
  return (
    <div className="agtEvlSpanIO" data-test-subj={testId}>
      {sections.map((section, i) => (
        <div key={section.key} data-test-subj={`agtEvlIO-${section.key}`}>
          {i > 0 && <EuiSpacer size="s" />}
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiTitle size="xxs">
                <span>{section.label}</span>
              </EuiTitle>
            </EuiFlexItem>
            {section.note && (
              <EuiFlexItem grow={false}>
                <EuiText size="xs" color="subdued">
                  {section.note}
                </EuiText>
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false}>
              <CopyContentButton
                text={copyTextFor(section.value, mode)}
                label={i18n.translate('agentTraces.evals.io.copy', {
                  defaultMessage: 'Copy {section}',
                  values: { section: section.label },
                })}
              />
            </EuiFlexItem>
            {i === 0 && !fixedMode && (
              <>
                {/* Pushes the switch to the right, as in the Agent Traces span detail. */}
                <EuiFlexItem />
                <EuiFlexItem grow={false} className="agtEvlSpanIO__toggle">
                  <MessageViewModeToggle mode={mode} onChange={setMode} idPrefix={idPrefix} />
                </EuiFlexItem>
              </>
            )}
          </EuiFlexGroup>
          <EuiSpacer size="xs" />
          <div className="agtEvlSpanIO__content">
            <MessageContent value={section.value} mode={mode} emptyText={NOT_RECORDED} />
          </div>
        </div>
      ))}
    </div>
  );
};
