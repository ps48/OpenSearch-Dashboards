/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../types';
import {
  EvalResult,
  buildSessionsEvalsQuery,
  createEvalsPplService,
  fetchEvalResults,
} from '../../evaluations/eval_data';
import { useEvalsIndexPattern } from '../../evaluations/eval_dataset';

/** Sessions looked up at once; the table renders its rows lazily. */
const MAX_SESSION_IDS = 200;

/** Session-level results by session id, for the Sessions table's Evaluations column. */
export const groupBySession = (results: EvalResult[]): Map<string, EvalResult[]> => {
  const out = new Map<string, EvalResult[]>();
  results.forEach((r) => {
    if (r.level !== 'session' || !r.sessionId) return;
    out.set(r.sessionId, [...(out.get(r.sessionId) ?? []), r]);
  });
  return out;
};

/**
 * Session-level evaluation results of the listed sessions, in one PPL query. Not bound to the
 * time filter: session evaluations land after the session ends. A missing index or a failed
 * lookup leaves the column empty.
 */
export const useSessionEvaluations = (sessionIds: string[]): Map<string, EvalResult[]> => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const index = useEvalsIndexPattern();
  const [value, setValue] = useState<Map<string, EvalResult[]>>(new Map());
  const key = useMemo(
    () => Array.from(new Set(sessionIds)).slice(0, MAX_SESSION_IDS).sort().join('\u0000'),
    [sessionIds]
  );
  useEffect(() => {
    if (!key || !services?.data || !index) {
      setValue(new Map());
      return;
    }
    const controller = new AbortController();
    const ppl = createEvalsPplService(
      services.data,
      { from: 'now-90d', to: 'now+1d' },
      controller.signal
    );
    fetchEvalResults(ppl, buildSessionsEvalsQuery(key.split('\u0000'), 1000, index), index)
      .then((results) => !controller.signal.aborted && setValue(groupBySession(results)))
      .catch(() => !controller.signal.aborted && setValue(new Map()));
    return () => controller.abort();
  }, [key, services?.data, index]);
  return value;
};
