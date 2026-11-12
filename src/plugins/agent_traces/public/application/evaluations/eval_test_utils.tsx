/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { EvalContext, EvalScreenContext, defaultEvalContext } from './eval_context';
import { PplRecord } from './eval_model';
import type { PplRows } from './use_ppl_rows';

/** Test-only helpers for the screens: a context and a fake `usePplRows`. */

export const TEST_INDEX = 'evals-*';

export const testContext = (patch: Partial<EvalScreenContext> = {}): EvalScreenContext => ({
  ...defaultEvalContext(TEST_INDEX, 'spans-*'),
  navigate: jest.fn(),
  setState: jest.fn(),
  openResult: jest.fn(),
  openTrace: jest.fn(),
  ...patch,
});

export const renderWithContext = (ui: React.ReactElement, ctx = testContext()) => ({
  ctx,
  ...render(
    <I18nProvider>
      <EvalContext.Provider value={ctx}>{ui}</EvalContext.Provider>
    </I18nProvider>
  ),
});

/** A fake `usePplRows`: records every query run and answers from `answer`. */
export const fakePpl = () => {
  const queries: string[] = [];
  /** The time range each query ran with. */
  const ranges = new Map<string, unknown>();
  let answer: (query: string) => PplRecord[] = () => [];
  let refreshing: (query: string) => boolean = () => false;
  return {
    queries,
    ranges,
    answer: (fn: (query: string) => PplRecord[]) => {
      answer = fn;
    },
    /**
     * After a Refresh (`refreshKey` > 0), the queries `fn` accepts are still running, in the
     * state `usePplRows` keeps then for an answered query: loaded, loading, no error, the rows of
     * the last answer (none after a failure).
     */
    refreshing: (fn: (query: string) => boolean) => {
      refreshing = fn;
    },
    reset: () => {
      queries.length = 0;
      ranges.clear();
      answer = () => [];
      refreshing = () => false;
    },
    hook: (
      _dataset: unknown,
      query: string | undefined,
      timeRange?: unknown,
      refreshKey = 0
    ): PplRows => {
      if (!query) return { rows: [], loading: false, loaded: false };
      queries.push(query);
      ranges.set(query, timeRange);
      if (refreshKey > 0 && refreshing(query)) return { rows: [], loading: true, loaded: true };
      // An answer that throws is the query failing with that message.
      try {
        return { rows: answer(query), loading: false, loaded: true };
      } catch (e) {
        return { rows: [], loading: false, loaded: true, error: (e as Error).message };
      }
    },
  };
};
