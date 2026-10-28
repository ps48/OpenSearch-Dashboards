/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { i18n } from '@osd/i18n';
import { schema } from '@osd/config-schema';
import { UiSettingsParams } from '../../../core/server';
import { AGENT_EVALS_INDEX_PATTERN, EVALS_INDEX_SETTING } from '../common';

export const agentTracesUiSettings: Record<string, UiSettingsParams> = {
  [EVALS_INDEX_SETTING]: {
    name: i18n.translate('agentTraces.advancedSettings.evaluationsIndexPatternTitle', {
      defaultMessage: 'Agent evaluations index pattern',
    }),
    value: AGENT_EVALS_INDEX_PATTERN,
    description: i18n.translate('agentTraces.advancedSettings.evaluationsIndexPatternText', {
      defaultMessage:
        'Index pattern of agent evaluation events (gen_ai.evaluation.result, ' +
        'opensearch.test_case.result and opensearch.test_suite_run.result). Read by the Agent ' +
        'Evaluations page, the Evaluations column of Agent Traces and the trace details flyout.',
    }),
    category: ['observability'],
    schema: schema.string({ minLength: 1 }),
  },
};
