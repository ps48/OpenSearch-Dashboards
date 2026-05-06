/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiAvatar,
  EuiText,
  EuiPanel,
  EuiSpacer,
  EuiIcon,
  EuiLoadingSpinner,
  EuiBadge,
  EuiButtonEmpty,
  EuiTextArea,
  EuiButton,
} from '@elastic/eui';
import { PromptEntry } from '../../../../common/types';

interface ActivityEntry {
  timestamp: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

interface ChatHistoryProps {
  entries: PromptEntry[];
  activityLog?: ActivityEntry[];
  isGenerating?: boolean;
  onSubmit?: (prompt: string) => void;
  hasCode?: boolean;
  initialValue?: string;
}

const TOOL_ICONS: Record<string, string> = {
  get_index_metadata: 'document',
  execute_ppl: 'database',
  get_sample_app: 'code',
  get_ppl_reference: 'documentation',
  get_oui_components: 'palette',
  validate_code: 'check',
  submit_app: 'checkInCircleFilled',
};

export const ChatHistory: React.FC<ChatHistoryProps> = ({
  entries,
  activityLog = [],
  isGenerating = false,
  onSubmit,
  hasCode,
  initialValue,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length, activityLog.length]);

  useEffect(() => {
    if (initialValue) setInputValue(initialValue);
  }, [initialValue]);

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (trimmed && onSubmit) {
      onSubmit(trimmed);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Count tool calls for the summary badge
  const toolCalls = activityLog.filter((e) => e.message.startsWith('\uD83D\uDD27'));
  const toolResults = activityLog.filter((e) => e.message.startsWith('\u2192'));
  const statusMessages = activityLog.filter(
    (e) => !e.message.startsWith('\uD83D\uDD27') && !e.message.startsWith('\u2192')
  );

  return (
    <div
      style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}
      data-test-subj="osdAppsChatHistory"
    >
      {entries.map((entry, idx) => (
        <React.Fragment key={idx}>
          {entry.role === 'user' ? (
            <EuiFlexGroup
              gutterSize="s"
              justifyContent="flexEnd"
              responsive={false}
              style={{ marginBottom: 8 }}
            >
              <EuiFlexItem grow={false} style={{ maxWidth: '85%' }}>
                <EuiPanel
                  paddingSize="s"
                  color="primary"
                  borderRadius="none"
                  style={{ borderRadius: '12px 12px 2px 12px' }}
                >
                  <EuiText size="s">{entry.content}</EuiText>
                </EuiPanel>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiAvatar size="s" name="You" color="#006BB4" iconType="user" />
              </EuiFlexItem>
            </EuiFlexGroup>
          ) : (
            <EuiFlexGroup gutterSize="s" responsive={false} style={{ marginBottom: 8 }}>
              <EuiFlexItem grow={false}>
                <EuiAvatar size="s" name="AI" color="#017D73" iconType="compute" />
              </EuiFlexItem>
              <EuiFlexItem grow={false} style={{ maxWidth: '85%' }}>
                <EuiPanel
                  paddingSize="s"
                  color="subdued"
                  borderRadius="none"
                  style={{ borderRadius: '12px 12px 12px 2px' }}
                >
                  <EuiText size="s" color="subdued">
                    <EuiIcon type="check" size="s" color="secondary" /> Canvas generated
                  </EuiText>
                </EuiPanel>
              </EuiFlexItem>
            </EuiFlexGroup>
          )}
        </React.Fragment>
      ))}

      {/* Tool usage — compact collapsible summary */}
      {activityLog.length > 0 && (
        <EuiFlexGroup gutterSize="s" responsive={false} style={{ marginBottom: 8 }}>
          <EuiFlexItem grow={false}>
            <EuiAvatar size="s" name="AI" color="#017D73" iconType="compute" />
          </EuiFlexItem>
          <EuiFlexItem style={{ maxWidth: '90%' }}>
            <EuiPanel
              paddingSize="s"
              color="subdued"
              borderRadius="none"
              style={{ borderRadius: '12px 12px 12px 2px' }}
            >
              {/* Status messages (always visible) */}
              {statusMessages.slice(-2).map((entry, idx) => (
                <EuiFlexGroup
                  key={idx}
                  gutterSize="xs"
                  alignItems="center"
                  responsive={false}
                  style={{ marginBottom: 2 }}
                >
                  <EuiFlexItem grow={false}>
                    <EuiIcon
                      type={
                        entry.type === 'success'
                          ? 'check'
                          : entry.type === 'error'
                          ? 'crossInACircleFilled'
                          : 'clock'
                      }
                      size="s"
                      color={
                        entry.type === 'success'
                          ? 'secondary'
                          : entry.type === 'error'
                          ? 'danger'
                          : 'subdued'
                      }
                    />
                  </EuiFlexItem>
                  <EuiFlexItem>
                    <EuiText size="xs" color="subdued">
                      {entry.message}
                    </EuiText>
                  </EuiFlexItem>
                </EuiFlexGroup>
              ))}

              {/* Tool calls summary + expand */}
              {toolCalls.length > 0 && (
                <>
                  <EuiFlexGroup
                    gutterSize="xs"
                    alignItems="center"
                    responsive={false}
                    style={{ marginTop: 4 }}
                  >
                    <EuiFlexItem grow={false}>
                      <EuiButtonEmpty
                        size="xs"
                        iconType={toolsExpanded ? 'arrowDown' : 'arrowRight'}
                        onClick={() => setToolsExpanded(!toolsExpanded)}
                        style={{ height: 'auto', padding: 0 }}
                      >
                        <EuiText size="xs">
                          <EuiBadge color="hollow">{toolCalls.length}</EuiBadge> tool calls
                        </EuiText>
                      </EuiButtonEmpty>
                    </EuiFlexItem>
                  </EuiFlexGroup>

                  {/* Expanded tool details */}
                  {toolsExpanded && (
                    <div style={{ marginTop: 4, marginLeft: 8 }}>
                      {activityLog
                        .filter(
                          (e) =>
                            e.message.startsWith('\uD83D\uDD27') || e.message.startsWith('\u2192')
                        )
                        .map((entry, idx) => {
                          const isCall = entry.message.startsWith('\uD83D\uDD27');
                          if (isCall) {
                            const toolMatch = entry.message.match(/\uD83D\uDD27\s*(\w+)/);
                            const toolName = toolMatch ? toolMatch[1] : '';
                            return (
                              <EuiFlexGroup
                                key={idx}
                                gutterSize="xs"
                                alignItems="center"
                                responsive={false}
                                style={{ marginBottom: 2 }}
                              >
                                <EuiFlexItem grow={false}>
                                  <EuiIcon
                                    type={TOOL_ICONS[toolName] || 'wrench'}
                                    size="s"
                                    color="primary"
                                  />
                                </EuiFlexItem>
                                <EuiFlexItem>
                                  <EuiText size="xs">
                                    <code
                                      style={{
                                        fontSize: 10,
                                        background: '#F5F7FA',
                                        padding: '1px 3px',
                                        borderRadius: 2,
                                      }}
                                    >
                                      {toolName}
                                    </code>
                                  </EuiText>
                                </EuiFlexItem>
                              </EuiFlexGroup>
                            );
                          }
                          // Tool result
                          return (
                            <EuiFlexGroup
                              key={idx}
                              gutterSize="xs"
                              alignItems="center"
                              responsive={false}
                              style={{ marginBottom: 3, marginLeft: 16 }}
                            >
                              <EuiFlexItem grow={false}>
                                <EuiIcon type="arrowRight" size="s" color="subdued" />
                              </EuiFlexItem>
                              <EuiFlexItem>
                                <EuiText size="xs" color="subdued">
                                  {entry.message.replace('\u2192 ', '')}
                                </EuiText>
                              </EuiFlexItem>
                            </EuiFlexGroup>
                          );
                        })}
                    </div>
                  )}
                </>
              )}
            </EuiPanel>
          </EuiFlexItem>
        </EuiFlexGroup>
      )}

      {/* Generating indicator */}
      {isGenerating && activityLog.length === 0 && (
        <EuiFlexGroup gutterSize="s" responsive={false} style={{ marginBottom: 8 }}>
          <EuiFlexItem grow={false}>
            <EuiAvatar size="s" name="AI" color="#017D73" iconType="compute" />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiPanel
              paddingSize="s"
              color="subdued"
              borderRadius="none"
              style={{ borderRadius: '12px 12px 12px 2px' }}
            >
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiLoadingSpinner size="s" />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiText size="xs" color="subdued">
                    Building your canvas...
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>
          </EuiFlexItem>
        </EuiFlexGroup>
      )}

      {/* Chat input */}
      {onSubmit && (
        <div style={{ padding: '8px 0', borderTop: '1px solid #D3DAE6', marginTop: 8 }}>
          <EuiFlexGroup gutterSize="s" responsive={false}>
            <EuiFlexItem>
              <EuiTextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  hasCode ? 'Refine your canvas...' : 'Describe the canvas you want to build...'
                }
                rows={2}
                disabled={isGenerating}
                compressed
                fullWidth
                data-test-subj="osdAppsPromptInput"
              />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButton
                size="s"
                fill
                onClick={handleSubmit}
                isLoading={isGenerating}
                disabled={!inputValue.trim() || isGenerating}
                data-test-subj="osdAppsPromptSubmit"
              >
                {hasCode ? 'Refine' : 'Generate'}
              </EuiButton>
            </EuiFlexItem>
          </EuiFlexGroup>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
