/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { i18n } from '@osd/i18n';
import { schema } from '@osd/config-schema';
import { UiSettingsParams } from '../../../core/server';
import { EVALS_RULES_SETTING } from '../common';

export const agentTracesUiSettings: Record<string, UiSettingsParams> = {
  [EVALS_RULES_SETTING]: {
    name: i18n.translate('agentTraces.advancedSettings.evaluationRulesTitle', {
      defaultMessage: 'Agent evaluation pass rules',
    }),
    value: '{}',
    type: 'json',
    description: i18n.translate('agentTraces.advancedSettings.evaluationRulesText', {
      defaultMessage:
        'Pass rules by evaluation name (gen_ai.evaluation.name; a trailing * matches a prefix). ' +
        'Each rule may set direction (maximize or minimize), threshold, min, max, passLabels and ' +
        'failLabels, for example {example}. A rule here wins over the assessment or threshold ' +
        'the evaluator sent. Results no rule decides show as Scored and are left out of pass ' +
        'rates. Invalid entries are ignored.',
      values: {
        example:
          '<code>{ "answer_quality": { "threshold": 4 }, "latency_*": { "direction": "minimize", "threshold": 10 }, "tone": { "passLabels": ["friendly"] } }</code>',
      },
    }),
    category: ['observability'],
    // Entries are validated in the browser: a bad entry is skipped, the others still apply.
    schema: schema.recordOf(schema.string(), schema.any()),
  },
};
