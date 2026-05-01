/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { EuiFlexGroup, EuiFlexItem, EuiTextArea, EuiButton } from '@elastic/eui';
import { i18n } from '@osd/i18n';

interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  isGenerating: boolean;
  initialValue?: string;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onSubmit,
  isGenerating,
  initialValue,
}) => {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (initialValue) setValue(initialValue);
  }, [initialValue]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
    }
  }, [value, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <EuiFlexGroup gutterSize="s" responsive={false}>
      <EuiFlexItem>
        <EuiTextArea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={i18n.translate('osdAppsBuilder.prompt.placeholder', {
            defaultMessage: 'Describe the app you want to build...',
          })}
          rows={3}
          disabled={isGenerating}
          data-test-subj="osdAppsPromptInput"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiButton
          fill
          onClick={handleSubmit}
          isLoading={isGenerating}
          disabled={!value.trim() || isGenerating}
          data-test-subj="osdAppsPromptSubmit"
        >
          {i18n.translate('osdAppsBuilder.prompt.send', { defaultMessage: 'Generate' })}
        </EuiButton>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
