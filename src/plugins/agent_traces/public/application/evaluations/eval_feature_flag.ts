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
 * The same, from React. Without capabilities in the services (unit tests, embedded use) the
 * flag is treated as on, so callers keep their behavior.
 */
export const useAgentEvalsEnabled = (): boolean => {
  const { services } = useOpenSearchDashboards<{ capabilities?: Capabilities }>();
  return services?.capabilities ? isAgentEvalsEnabled(services.capabilities) : true;
};
