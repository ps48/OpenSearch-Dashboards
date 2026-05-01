/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { EuiComment, EuiText, EuiSpacer } from '@elastic/eui';
import { PromptEntry } from '../../../../common/types';

interface ChatHistoryProps {
  entries: PromptEntry[];
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({ entries }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }} data-test-subj="osdAppsChatHistory">
      {entries.map((entry, idx) => (
        <React.Fragment key={idx}>
          <EuiComment
            username={entry.role === 'user' ? 'You' : 'AI'}
            event={entry.role === 'user' ? 'prompted' : 'generated'}
            timestamp={entry.timestamp}
            timelineIcon={entry.role === 'user' ? 'user' : 'compute'}
          >
            <EuiText size="s">
              <p>{entry.role === 'user' ? entry.content : 'Code generated successfully.'}</p>
            </EuiText>
          </EuiComment>
          <EuiSpacer size="s" />
        </React.Fragment>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
