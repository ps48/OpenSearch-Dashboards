/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { EuiComboBox, EuiFormRow } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { SavedObjectsClientContract } from '../../../../../core/public';
import { DataSourceRef } from '../../../../common/types';

interface DataSourcePickerProps {
  onSelect: (refs: DataSourceRef[]) => void;
  selectedRefs: DataSourceRef[];
  savedObjectsClient: SavedObjectsClientContract;
}

interface ComboOption {
  label: string;
  value: DataSourceRef;
}

export const DataSourcePicker: React.FC<DataSourcePickerProps> = ({
  onSelect,
  selectedRefs,
  savedObjectsClient,
}) => {
  const [options, setOptions] = useState<ComboOption[]>([]);

  useEffect(() => {
    const fetchIndices = async () => {
      try {
        const response = await savedObjectsClient.find<{ title: string; dataSourceRef?: any }>({
          type: 'index-pattern',
          perPage: 100,
          fields: ['title', 'dataSourceRef'],
        });
        setOptions(
          response.savedObjects.map((obj) => {
            // Only include dataSource ref if it's a remote data source connection
            // Local cluster index patterns should NOT have a dataSource
            const dsRef = obj.attributes.dataSourceRef;
            const ref: DataSourceRef = {
              id: obj.id,
              type: dsRef ? 'DATA_SOURCE' : 'DATA_SOURCE',
              title: obj.attributes.title,
            };
            return { label: obj.attributes.title, value: ref };
          })
        );
      } catch {
        // Silently fail
      }
    };
    fetchIndices();
  }, [savedObjectsClient]);

  const selectedOptions = selectedRefs.map((ref) => ({
    label: ref.title,
    value: ref,
  }));

  return (
    <EuiFormRow
      label={i18n.translate('osdAppsBuilder.dataPicker.label', {
        defaultMessage: 'Data sources',
      })}
      helpText={i18n.translate('osdAppsBuilder.dataPicker.help', {
        defaultMessage: 'Select indices for the AI to query',
      })}
    >
      <EuiComboBox
        options={options}
        selectedOptions={selectedOptions}
        onChange={(selected) => onSelect(selected.map((s) => (s as ComboOption).value))}
        placeholder={i18n.translate('osdAppsBuilder.dataPicker.placeholder', {
          defaultMessage: 'Select index patterns...',
        })}
        data-test-subj="osdAppsDataSourcePicker"
      />
    </EuiFormRow>
  );
};
