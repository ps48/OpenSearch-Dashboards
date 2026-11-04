/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capabilities } from '../../../../../core/public';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';

/**
 * Agent Evaluations (Evaluations app, eval columns, pills and marks in Agent Traces) show only
 * when both explore.agentTraces.enabled and explore.agentTraces.evaluations.enabled are on.
 * The server folds both into the agentTraces.agentEvalsEnabled capability.
 */
export const isAgentEvalsEnabled = (capabilities?: Partial<Capabilities> | null): boolean => {
  const agentTraces = (capabilities?.agentTraces ?? {}) as Record<string, unknown>;
  return !!agentTraces.agentTracesEnabled && !!agentTraces.agentEvalsEnabled;
};

/**
 * The same, from React. Without capabilities in the services (embedded use, unit tests that do
 * not provide them) the flag is off, so Evaluations never show by accident.
 */
export const useAgentEvalsEnabled = (): boolean => {
  const { services } = useOpenSearchDashboards<{
    capabilities?: Capabilities;
    application?: { capabilities?: Capabilities };
  }>();
  // Agent Traces services carry `capabilities`; the Evaluations app spreads CoreStart, where
  // they live under `application`.
  const capabilities = services?.capabilities ?? services?.application?.capabilities;
  return capabilities ? isAgentEvalsEnabled(capabilities) : false;
};
