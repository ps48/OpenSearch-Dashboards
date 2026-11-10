/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { TimeRange } from '../../../../data/common';
import { RunName, caseNamesOf, runNamesOf } from './eval_model';
import { RUN_NAMES_LIMIT, buildCaseNamesQuery, buildRunNamesQuery } from './ppl_queries';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';

const NONE = new Map<string, RunName>();
const NO_CASE_NAMES = new Map<string, string>();

/**
 * The optional names, descriptions and CI links of runs (the first `RUN_NAMES_LIMIT` ids), read
 * from one result document per run. Runs without any (or before it answers, or on an error)
 * are missing from the map: screens fall back to the short run id. `range`: where to look (the
 * screen's range by default); the run page passes one that covers the run before it too.
 */
export const useRunNames = (runIds: string[], range?: TimeRange): Map<string, RunName> => {
  const { dataset, index, timeRange, refreshKey } = useEvalContext();
  const key = runIds.slice(0, RUN_NAMES_LIMIT).join('\n');
  const query = useMemo(
    () => (key ? buildRunNamesQuery(index, key.split('\n')) : undefined),
    [index, key]
  );
  const { rows } = usePplRows(dataset, query, range ?? timeRange, refreshKey);
  return useMemo(() => (rows.length ? runNamesOf(rows) : NONE), [rows]);
};

/**
 * The names of the cases of one or two runs (`test.case.name`), read from one result document
 * per case. Cases without a name (or before it answers, or on an error) are missing from the
 * map: screens fall back to the case id.
 */
export const useCaseNames = (runIds: string[]): Map<string, string> => {
  const { dataset, index, timeRange, refreshKey } = useEvalContext();
  const key = runIds.join('\n');
  const query = useMemo(
    () => (key ? buildCaseNamesQuery(index, key.split('\n')) : undefined),
    [index, key]
  );
  const { rows } = usePplRows(dataset, query, timeRange, refreshKey);
  return useMemo(() => (rows.length ? caseNamesOf(rows) : NO_CASE_NAMES), [rows]);
};
