/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiCard, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiSpacer, EuiTitle } from '@elastic/eui';
import { i18n } from '@osd/i18n';

interface PromptSuggestionsProps {
  onSelect: (prompt: string) => void;
}

const SUGGESTIONS = [
  {
    title: 'Web Logs Explorer',
    prompt:
      'Build a web logs explorer for opensearch_dashboards_sample_data_logs with response code filtering, a table of top URLs by hit count, and byte transfer statistics',
    icon: 'logsApp',
  },
  {
    title: 'Flight Delays Dashboard',
    prompt:
      'Create a flight delays dashboard for opensearch_dashboards_sample_data_flights showing delay stats by carrier, average delay times, and cancellation rates',
    icon: 'visLine',
  },
  {
    title: 'eCommerce Overview',
    prompt:
      'Build an ecommerce overview app for opensearch_dashboards_sample_data_ecommerce with total revenue, order count, top products table, and sales by category',
    icon: 'search',
  },
];

export const PromptSuggestions: React.FC<PromptSuggestionsProps> = ({ onSelect }) => {
  return (
    <div data-test-subj="osdAppsPromptSuggestions">
      <EuiTitle size="xs">
        <h3>
          {i18n.translate('osdAppsBuilder.suggestions.title', {
            defaultMessage: 'Get started with an example',
          })}
        </h3>
      </EuiTitle>
      <EuiSpacer size="s" />
      <EuiFlexGroup direction="column" gutterSize="s">
        {SUGGESTIONS.map((s) => (
          <EuiFlexItem key={s.title}>
            <EuiCard
              layout="horizontal"
              icon={<EuiIcon type={s.icon} size="l" />}
              title={s.title}
              description={s.prompt}
              onClick={() => onSelect(s.prompt)}
              data-test-subj={'osdAppsSuggestion-' + s.icon}
            />
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    </div>
  );
};
