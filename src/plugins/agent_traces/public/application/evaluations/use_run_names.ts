/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { RunName, runNamesOf } from './eval_model';
import { RUN_NAMES_LIMIT, buildRunNamesQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';

const NONE = new Map<string, RunName>();

/**
 * The optional names and descriptions of runs (the first `RUN_NAMES_LIMIT` ids), read from one
 * result document per run. Runs without a name (or before it answers, or on an error) are
 * missing from the map: screens fall back to the short run id.
 */
export const useRunNames = (runIds: string[]): Map<string, RunName> => {
  const { dataset, index, timeRange, refreshKey } = useEvalContext();
  const key = runIds.slice(0, RUN_NAMES_LIMIT).join('\n');
  const query = useMemo(
    () => (key ? buildRunNamesQuery(index, key.split('\n')) : undefined),
    [index, key]
  );
  const { rows } = usePplRows(dataset, query, timeRange, refreshKey);
  return useMemo(() => (rows.length ? runNamesOf(rows) : NONE), [rows]);
};
