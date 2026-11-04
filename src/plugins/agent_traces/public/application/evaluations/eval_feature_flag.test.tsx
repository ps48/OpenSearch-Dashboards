/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderHook } from '@testing-library/react';
import { isAgentEvalsEnabled, useAgentEvalsEnabled } from './eval_feature_flag';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';

const ON = { agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: true } };

const hookWith = (services: Record<string, unknown>) =>
  renderHook(() => useAgentEvalsEnabled(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <OpenSearchDashboardsContextProvider services={services}>
        {children}
      </OpenSearchDashboardsContextProvider>
    ),
  }).result.current;

describe('isAgentEvalsEnabled', () => {
  it('needs both the Agent Traces and the Agent Evaluations flags', () => {
    expect(isAgentEvalsEnabled(ON)).toBe(true);
    expect(
      isAgentEvalsEnabled({ agentTraces: { agentTracesEnabled: false, agentEvalsEnabled: true } })
    ).toBe(false);
    expect(
      isAgentEvalsEnabled({ agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: false } })
    ).toBe(false);
    expect(isAgentEvalsEnabled({})).toBe(false);
    expect(isAgentEvalsEnabled(undefined)).toBe(false);
  });
});

describe('useAgentEvalsEnabled', () => {
  it('reads capabilities from the services (Agent Traces)', () => {
    expect(hookWith({ capabilities: ON })).toBe(true);
  });

  it('reads capabilities from application (the Evaluations app spreads CoreStart)', () => {
    expect(hookWith({ application: { capabilities: ON } })).toBe(true);
  });

  it('is off when no capabilities are available', () => {
    expect(hookWith({})).toBe(false);
  });
});
