/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import {
  aiRootCondition,
  aiRootsOf,
  aiRootWithFallbackOf,
  isAiRootRow,
  dropShadowedAiRoots,
  ensureAiRootFieldChecked,
  GENAI_ROOT_CONDITION,
  hasAiRootField,
  isMarkedAiRoot,
  resetAiRootFieldChecks,
  setAiRootFieldPresent,
  useAiRootFieldVersion,
} from './ai_root';
import { prepareRootSpansQuery } from '../tab_queries';

const dataset = { id: 'ds-1', title: 'otel-v1-apm-span*', type: 'INDEX_PATTERN' };

describe('ai_root', () => {
  beforeEach(() => resetAiRootFieldChecks());

  it('only lists GenAI roots until the marker is known to be mapped', () => {
    expect(aiRootCondition('ds-1')).toBe(GENAI_ROOT_CONDITION);

    setAiRootFieldPresent('ds-1', true);
    expect(aiRootCondition('ds-1')).toBe(
      `(${GENAI_ROOT_CONDITION}) OR \`attributes.derived.gen_ai.is_root\` = true`
    );
    expect(aiRootCondition('ds-2')).toBe(GENAI_ROOT_CONDITION);
  });

  it('puts the condition in the Traces query', () => {
    const query = { query: '', language: 'PPL', dataset } as any;
    expect(prepareRootSpansQuery(query)).toContain(`where ${GENAI_ROOT_CONDITION}`);
    setAiRootFieldPresent('ds-1', true);
    expect(prepareRootSpansQuery(query)).toContain('`attributes.derived.gen_ai.is_root` = true');
  });

  it('probes the mapping once per dataset', async () => {
    const executeQuery = jest.fn().mockResolvedValue({});
    const ppl = { executeQuery };
    await Promise.all([
      ensureAiRootFieldChecked(ppl, dataset as any, 'source = otel-v1-apm-span*'),
      ensureAiRootFieldChecked(ppl, dataset as any, 'source = otel-v1-apm-span*'),
    ]);
    await ensureAiRootFieldChecked(ppl, dataset as any, 'source = otel-v1-apm-span*');

    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0][1]).toBe(
      'source = otel-v1-apm-span* | where isnotnull(`attributes.derived.gen_ai.is_root`) | head 1'
    );
    expect(hasAiRootField('ds-1')).toBe(true);
  });

  it('treats a failed probe (unmapped field) as absent', async () => {
    const ppl = { executeQuery: jest.fn().mockRejectedValue(new Error("can't resolve Symbol")) };
    await ensureAiRootFieldChecked(ppl, dataset as any, 'source = otel-v1-apm-span*');
    expect(hasAiRootField('ds-1')).toBe(false);
  });

  it('reads the marker from flat, nested and top-level forms', () => {
    expect(isMarkedAiRoot({ attributes: { 'derived.gen_ai.is_root': true } })).toBe(true);
    expect(isMarkedAiRoot({ attributes: { derived: { gen_ai: { is_root: 'true' } } } })).toBe(true);
    expect(isMarkedAiRoot({ 'attributes.derived.gen_ai.is_root': true })).toBe(true);
    expect(isMarkedAiRoot({ attributes: { derived: { fault: 'false' } } })).toBe(false);
    expect(isMarkedAiRoot(undefined)).toBe(false);
  });

  it('drops a marked span whose trace is listed through its GenAI root', () => {
    const hits = [
      { _source: { traceId: 't1', parentSpanId: '' } },
      { _source: { traceId: 't1', parentSpanId: 'p' } },
      { _source: { traceId: 't2', parentSpanId: 'http' } },
      { _source: { traceId: 't2', parentSpanId: 'http' } },
    ];
    // t1 keeps only its root; t2 has no GenAI root, so both parallel agents stay.
    expect(dropShadowedAiRoots(hits)).toEqual([hits[0], hits[2], hits[3]]);
  });

  it('bumps the version only when a check changes the condition', () => {
    const { result } = renderHook(() => useAiRootFieldVersion());
    const start = result.current;
    act(() => setAiRootFieldPresent('ds-1', true));
    expect(result.current).toBe(start + 1);
    act(() => setAiRootFieldPresent('ds-1', true));
    expect(result.current).toBe(start + 1);
  });

  describe('aiRootsOf', () => {
    const marked = { attributes: { 'derived.gen_ai.is_root': true } };
    const genAi = { attributes: { 'gen_ai.operation.name': 'invoke_agent' } };
    const row = (spanId: string, parentSpanId: string, doc: object, startTime = '1') => ({
      spanId,
      parentSpanId,
      rawDocument: { ...doc, startTime },
    });

    it('prefers a GenAI root over a span marked below it', () => {
      const rows = [row('root', '', genAi), row('inner', 'root', marked)];
      expect(aiRootsOf(rows).map((r) => r.spanId)).toEqual(['root']);
    });

    it('keeps every marked span under a non-GenAI root, earliest first', () => {
      const rows = [
        row('http', '', {}),
        row('events', 'http', marked, '2'),
        row('weather', 'http', marked, '1'),
      ];
      expect(aiRootsOf(rows).map((r) => r.spanId)).toEqual(['weather', 'events']);
    });

    it('is empty without a GenAI root or a marker', () => {
      expect(aiRootsOf([row('http', '', {})])).toEqual([]);
    });

    describe('aiRootWithFallbackOf (the evaluation views and the trace flyout)', () => {
      it('the AI root first', () => {
        const rows = [
          row('http', '', {}),
          row('c', 'http', genAi, '1'),
          row('m', 'http', marked, '2'),
        ];
        expect(aiRootWithFallbackOf(rows)?.spanId).toBe('m');
        expect(aiRootWithFallbackOf([row('r', '', genAi), row('m', 'r', marked)])?.spanId).toBe(
          'r'
        );
      });

      it('an unmarked HTTP root with a GenAI child: the GenAI span, not the handler', () => {
        const rows = [row('http', '', {}, '0'), row('agent', 'http', genAi, '1')];
        expect(aiRootWithFallbackOf(rows)?.spanId).toBe('agent');
      });

      it('the outermost GenAI span, even when a child starts in the same millisecond', () => {
        const rows = [
          row('http', '', {}, '1'),
          row('chat', 'agent', genAi, '1'),
          row('agent', 'http', genAi, '1'),
        ];
        expect(aiRootWithFallbackOf(rows)?.spanId).toBe('agent');
      });

      it('the earliest of sibling GenAI spans', () => {
        const rows = [
          row('http', '', {}),
          row('b', 'http', genAi, '2'),
          row('a', 'http', genAi, '1'),
        ];
        expect(aiRootWithFallbackOf(rows)?.spanId).toBe('a');
      });

      it('else the root, else the first row; nothing for no rows', () => {
        expect(aiRootWithFallbackOf([row('c', 'http', {}), row('http', '', {})])?.spanId).toBe(
          'http'
        );
        expect(aiRootWithFallbackOf([row('orphan', 'gone', {})])?.spanId).toBe('orphan');
        expect(aiRootWithFallbackOf([])).toBeUndefined();
      });
    });

    it('treats a marked span, or a GenAI root, as an AI root row', () => {
      expect(isAiRootRow(row('a', 'p', marked))).toBe(true);
      expect(isAiRootRow(row('r', '', genAi))).toBe(true);
      expect(isAiRootRow(row('c', 'p', genAi))).toBe(false);
    });
  });

  it('caches an unmapped field, but retries after other failures', async () => {
    const transient = { executeQuery: jest.fn().mockRejectedValue(new Error('Request timed out')) };
    await ensureAiRootFieldChecked(transient, dataset as any, 'source = x');
    await ensureAiRootFieldChecked(transient, dataset as any, 'source = x');
    expect(transient.executeQuery).toHaveBeenCalledTimes(2);

    const missing = {
      executeQuery: jest
        .fn()
        .mockRejectedValue(new Error('Field [attributes.derived.gen_ai.is_root] not found.')),
    };
    await ensureAiRootFieldChecked(missing, { ...dataset, id: 'ds-2' } as any, 'source = x');
    await ensureAiRootFieldChecked(missing, { ...dataset, id: 'ds-2' } as any, 'source = x');
    expect(missing.executeQuery).toHaveBeenCalledTimes(1);
    expect(hasAiRootField('ds-2')).toBe(false);
  });
});
