/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { IUiSettingsClient } from '../../../../../core/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { AGENT_EVALS_INDEX_PATTERN, EVALS_INDEX_SETTING } from '../../../common';

/**
 * The index pattern evaluation queries read: the `agentTraces:evaluationsIndexPattern`
 * advanced setting, else the default. Characters that would break out of a PPL `source`
 * clause (spaces, pipes, quotes) fall back to the default.
 */
export const getEvalsIndexPattern = (uiSettings?: Pick<IUiSettingsClient, 'get'>): string => {
  let value: unknown;
  try {
    value = uiSettings?.get(EVALS_INDEX_SETTING, AGENT_EVALS_INDEX_PATTERN);
  } catch {
    // an unregistered setting in tests or older servers
  }
  const pattern = typeof value === 'string' ? value.trim() : '';
  return pattern && /^[^\s|'"`]+$/.test(pattern) ? pattern : AGENT_EVALS_INDEX_PATTERN;
};

/** The evaluation index pattern from the app's uiSettings. */
export const useEvalsIndexPattern = (): string => {
  const { services } = useOpenSearchDashboards<{ uiSettings?: IUiSettingsClient }>();
  return getEvalsIndexPattern(services?.uiSettings);
};
