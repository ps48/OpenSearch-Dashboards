/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { isAgentEvalsEnabled } from './eval_feature_flag';

describe('isAgentEvalsEnabled', () => {
  it('needs both the Agent Traces and the Agent Evaluations flags', () => {
    expect(
      isAgentEvalsEnabled({ agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: true } })
    ).toBe(true);
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
