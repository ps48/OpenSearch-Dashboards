/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../types';
import { executeQueries } from '../../utils/state_management/actions/query_actions';
import {
  EvalTraceFilterPill,
  ShowTracesContext,
  TraceCondition,
  fetchConditionTraces,
} from '../../evaluations/eval_trace_filter';
import { setEvalTraceFilter, useEvalTraceFilter } from '../../evaluations/eval_trace_filter_store';
import { getEvalsIndexPattern } from '../../evaluations/eval_settings';

/**
 * On Agent Traces, "Show traces where this fails" filters the page itself: the matching
 * trace ids become a `where traceId in (...)` on the Traces and Spans tabs, shown as a
 * removable pill above them.
 */
export const TracesEvalFilterProvider: React.FC = ({ children }) => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const dispatch = useDispatch();
  const activeFilter = useEvalTraceFilter();
  const rerun = useCallback(() => {
    dispatch(executeQueries({ services }) as never);
  }, [dispatch, services]);

  const showTraces = useCallback(
    (condition: TraceCondition) => {
      const timefilter = services.data.query.timefilter.timefilter;
      const bounds = timefilter.calculateBounds(timefilter.getTime());
      const from = bounds.min?.valueOf() ?? Date.now() - 24 * 3600 * 1000;
      // Results arrive after the traces they judge: look up to now.
      const to = Math.max(bounds.max?.valueOf() ?? Date.now(), Date.now());
      fetchConditionTraces(
        services.data,
        condition,
        { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        getEvalsIndexPattern(services.uiSettings)
      )
        .then((filter) => {
          setEvalTraceFilter(filter);
          rerun();
        })
        .catch((error: unknown) =>
          services.notifications?.toasts.addDanger({
            title: i18n.translate('agentTraces.evals.showTracesError', {
              defaultMessage: 'Could not list the traces',
            }),
            text: error instanceof Error ? error.message : String(error),
          })
        );
    },
    [services, rerun]
  );

  return (
    <ShowTracesContext.Provider value={showTraces}>
      {activeFilter && (
        <EuiFlexGroup gutterSize="s" responsive={false} className="agtEvlFilterBar">
          <EuiFlexItem grow={false}>
            <EvalTraceFilterPill onRemove={rerun} />
          </EuiFlexItem>
        </EuiFlexGroup>
      )}
      {children}
    </ShowTracesContext.Provider>
  );
};
