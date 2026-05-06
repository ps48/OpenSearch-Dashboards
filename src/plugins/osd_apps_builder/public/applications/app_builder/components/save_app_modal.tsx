/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  EuiModal,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiModalBody,
  EuiModalFooter,
  EuiButton,
  EuiButtonEmpty,
  EuiForm,
  EuiFormRow,
  EuiFieldText,
  EuiTextArea,
  EuiComboBox,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';

interface SaveAppModalProps {
  onSave: (title: string, description: string, tags: string[]) => void;
  onClose: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialTags?: string[];
}

export const SaveAppModal: React.FC<SaveAppModalProps> = ({
  onSave,
  onClose,
  initialTitle = '',
  initialDescription = '',
  initialTags = [],
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [tags, setTags] = useState(initialTags.map((t) => ({ label: t })));

  const handleSave = () => {
    if (title.trim()) {
      onSave(
        title.trim(),
        description.trim(),
        tags.map((t) => t.label)
      );
    }
  };

  return (
    <EuiModal onClose={onClose} data-test-subj="osdAppsSaveModal">
      <EuiModalHeader>
        <EuiModalHeaderTitle>
          {i18n.translate('osdAppsBuilder.save.title', { defaultMessage: 'Save canvas' })}
        </EuiModalHeaderTitle>
      </EuiModalHeader>
      <EuiModalBody>
        <EuiForm>
          <EuiFormRow
            label={i18n.translate('osdAppsBuilder.save.nameLabel', { defaultMessage: 'Title' })}
            isInvalid={!title.trim()}
            error={
              !title.trim()
                ? i18n.translate('osdAppsBuilder.save.nameRequired', {
                    defaultMessage: 'Title is required',
                  })
                : undefined
            }
          >
            <EuiFieldText
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-test-subj="osdAppsSaveTitle"
            />
          </EuiFormRow>
          <EuiFormRow
            label={i18n.translate('osdAppsBuilder.save.descLabel', {
              defaultMessage: 'Description',
            })}
          >
            <EuiTextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              data-test-subj="osdAppsSaveDescription"
            />
          </EuiFormRow>
          <EuiFormRow
            label={i18n.translate('osdAppsBuilder.save.tagsLabel', { defaultMessage: 'Tags' })}
          >
            <EuiComboBox
              selectedOptions={tags}
              onChange={(selected) => setTags(selected)}
              onCreateOption={(value) => setTags([...tags, { label: value }])}
              data-test-subj="osdAppsSaveTags"
            />
          </EuiFormRow>
        </EuiForm>
      </EuiModalBody>
      <EuiModalFooter>
        <EuiButtonEmpty onClick={onClose}>
          {i18n.translate('osdAppsBuilder.save.cancel', { defaultMessage: 'Cancel' })}
        </EuiButtonEmpty>
        <EuiButton
          fill
          onClick={handleSave}
          disabled={!title.trim()}
          data-test-subj="osdAppsSaveConfirm"
        >
          {i18n.translate('osdAppsBuilder.save.confirm', { defaultMessage: 'Save' })}
        </EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
};
