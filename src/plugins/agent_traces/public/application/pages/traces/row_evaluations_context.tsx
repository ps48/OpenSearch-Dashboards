/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../types';
import {
  PplRecord,
  Tally,
  addToTally,
  emptyTally,
  get,
  num,
  str,
} from '../../evaluations/eval_model';
import { F, buildTracesTallyQuery } from '../../evaluations/eval_ppl';
import { useEvalsDataSource, useEvalsIndexPattern } from '../../evaluations/eval_dataset';
import { evalsDataset, runPpl } from '../../evaluations/use_ppl_rows';

export interface RowEvaluations {
  /** Tally per trace id (trace rows). */
  byTraceId: Map<string, Tally>;
  /** Tally per span id (span rows). */
  bySpanId: Map<string, Tally>;
  /** `trace`: rows are traces. `span`: every row is a span. */
  mode: 'trace' | 'span';
}

const EMPTY: RowEvaluations = { byTraceId: new Map(), bySpanId: new Map(), mode: 'trace' };

const RowEvaluationsContext = createContext<RowEvaluations>(EMPTY);

export const useRowEvaluations = () => useContext(RowEvaluationsContext);

/**
 * At most this many trace ids per lookup. The table can list more rows (`discover:sampleSize`,
 * and a page of spans covers many traces), so the ids are looked up in chunks: one query per
 * chunk, never one per row.
 */
export const TRACE_IDS_PER_QUERY = 200;

/** The distinct ids, sorted, in chunks of `size`. */
export const chunkTraceIds = (ids: string[], size = TRACE_IDS_PER_QUERY): string[][] => {
  const distinct = Array.from(new Set(ids.filter(Boolean))).sort();
  const chunks: string[][] = [];
  for (let i = 0; i < distinct.length; i += size) chunks.push(distinct.slice(i, i + size));
  return chunks;
};

/** Tallies from `buildTracesTallyQuery` rows. */
export const indexRowTallies = (
  rows: PplRecord[],
  mode: RowEvaluations['mode'] = 'trace'
): RowEvaluations => {
  const byTraceId = new Map<string, Tally>();
  const bySpanId = new Map<string, Tally>();
  rows.forEach((row) => {
    const n = num(row.n) ?? 0;
    const traceId = str(get(row, F.traceId));
    const spanId = str(get(row, F.spanId));
    if (traceId)
      byTraceId.set(traceId, addToTally(byTraceId.get(traceId) ?? emptyTally(), row.verdict, n));
    if (spanId)
      bySpanId.set(spanId, addToTally(bySpanId.get(spanId) ?? emptyTally(), row.verdict, n));
  });
  return { byTraceId, bySpanId, mode };
};

/**
 * The Evaluations column: one aggregation (count by trace id, or by span id, and verdict) for
 * the traces of the visible page, from the start of the range to now (results land after the
 * traces). A missing eval index or a failed lookup leaves the column empty.
 */
export const RowEvaluationsProvider: React.FC<{
  traceIds: string[];
  mode?: RowEvaluations['mode'];
}> = ({ traceIds, mode = 'trace', children }) => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const index = useEvalsIndexPattern();
  const dataSource = useEvalsDataSource();
  const [value, setValue] = useState<RowEvaluations>(EMPTY);
  const key = useMemo(() => Array.from(new Set(traceIds)).sort().join(','), [traceIds]);

  useEffect(() => {
    if (!key || !services?.data || !index) {
      setValue({ ...EMPTY, mode });
      return;
    }
    const controller = new AbortController();
    const timefilter = services.data.query.timefilter.timefilter;
    const from = timefilter.calculateBounds(timefilter.getTime()).min?.toISOString() ?? 'now-7d';
    const range = { from, to: new Date().toISOString() };
    Promise.all(
      chunkTraceIds(key.split(',')).map((ids) =>
        runPpl(
          services.data,
          evalsDataset(index, dataSource),
          buildTracesTallyQuery(index, ids, mode === 'span'),
          range,
          controller.signal
        )
      )
    )
      .then(
        (chunks) => !controller.signal.aborted && setValue(indexRowTallies(chunks.flat(), mode))
      )
      .catch(() => !controller.signal.aborted && setValue({ ...EMPTY, mode }));
    return () => controller.abort();
  }, [key, mode, services?.data, index, dataSource]);

  return <RowEvaluationsContext.Provider value={value}>{children}</RowEvaluationsContext.Provider>;
};
