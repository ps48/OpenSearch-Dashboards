/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AGENT_EVALS_INDEX_PATTERN, EVALS_INDEX_SETTING } from '../../../common';
import { agentTracesUiSettings } from '../../../server/ui_settings';
import { getEvalsIndexPattern } from './eval_settings';
import {
  buildEvalFacetsQuery,
  buildEvalResultsQuery,
  buildRunDetailQuery,
  buildRunEventsQuery,
  buildTraceEvalsQuery,
  buildTracesEvalsQuery,
  evalsDataset,
} from './eval_data';
import { buildSameTargetQuery } from './result_flyout';
import { makeResult } from './eval_test_fixtures';

const settings = (value: unknown) => ({
  get: (key: string, fallback?: unknown) => (key === EVALS_INDEX_SETTING ? value : fallback),
});

describe('evaluations index setting', () => {
  it('is registered with the default index pattern', () => {
    const setting = agentTracesUiSettings[EVALS_INDEX_SETTING];
    expect(setting.value).toBe(AGENT_EVALS_INDEX_PATTERN);
    expect(setting.schema.validate('my-evals-*')).toBe('my-evals-*');
    expect(() => setting.schema.validate('')).toThrow();
  });

  it('reads the configured pattern and falls back to the default', () => {
    expect(getEvalsIndexPattern(settings(' my-evals-* '))).toBe('my-evals-*');
    expect(getEvalsIndexPattern(settings(undefined))).toBe(AGENT_EVALS_INDEX_PATTERN);
    expect(getEvalsIndexPattern(settings(''))).toBe(AGENT_EVALS_INDEX_PATTERN);
    expect(getEvalsIndexPattern(undefined)).toBe(AGENT_EVALS_INDEX_PATTERN);
    // Anything that could leave the PPL source clause is ignored.
    expect(getEvalsIndexPattern(settings('evals | where 1=1'))).toBe(AGENT_EVALS_INDEX_PATTERN);
    expect(
      getEvalsIndexPattern({
        get: () => {
          throw new Error('unknown setting');
        },
      })
    ).toBe(AGENT_EVALS_INDEX_PATTERN);
  });

  it('is the source of every evaluation query', () => {
    const index = 'my-evals-*';
    const queries = [
      buildEvalResultsQuery({}, 10, index),
      buildEvalFacetsQuery({}, index),
      buildTraceEvalsQuery('t1', undefined, 10, index),
      buildTracesEvalsQuery(['t1'], 10, index),
      buildRunEventsQuery(10, index),
      buildRunDetailQuery('run-1', 10, index),
      buildSameTargetQuery(makeResult({ traceId: 't1' }), 10, index) as string,
    ];
    queries.forEach((q) => expect(q.startsWith(`source = ${index} |`)).toBe(true));
    expect(evalsDataset(index).title).toBe(index);
  });
});
