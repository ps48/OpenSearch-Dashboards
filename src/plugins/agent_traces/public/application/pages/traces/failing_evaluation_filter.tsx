/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiSwitch,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { AgentTracesServices } from '../../../types';
import { executeQueries } from '../../utils/state_management/actions/query_actions';
import { useAgentEvalsEnabled } from '../../evaluations/eval_feature_flag';
import { useEvalsIndexPattern } from '../../evaluations/eval_dataset';
import { errorMessage } from '../../evaluations/use_ppl_rows';
import { FAILING_TRACES_LIMIT } from '../../evaluations/eval_ppl';
import {
  fetchFailingTraces,
  setFailingTracesFilter,
  useFailingTracesFilter,
} from '../../evaluations/failing_traces_filter';

/**
 * "Has a failing evaluation": lists only traces with a failing result in the range. Turning it
 * on runs one bounded query (at most the 500 most recent failing traces), then the traces
 * query again with `where traceId in (...)`.
 */
export const FailingEvaluationFilter: React.FC = () => {
  const { services } = useOpenSearchDashboards<AgentTracesServices>();
  const dispatch = useDispatch();
  const enabled = useAgentEvalsEnabled();
  const index = useEvalsIndexPattern();
  const filter = useFailingTracesFilter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>();

  const rerun = useCallback(() => {
    dispatch(executeQueries({ services }) as never);
  }, [dispatch, services]);

  const load = useCallback(() => {
    if (!index || !services?.data) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const timefilter = services.data.query.timefilter.timefilter;
    const bounds = timefilter.calculateBounds(timefilter.getTime());
    const from = bounds.min?.toISOString() ?? new Date(Date.now() - 24 * 3600e3).toISOString();
    // Results land after the traces they judge: look up to now.
    const to = new Date(Math.max(bounds.max?.valueOf() ?? Date.now(), Date.now())).toISOString();
    setLoading(true);
    setError(undefined);
    fetchFailingTraces(services.data, index, { from, to }, c.signal)
      .then((next) => {
        if (c.signal.aborted) return;
        setLoading(false);
        setFailingTracesFilter(next);
        rerun();
      })
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        setLoading(false);
        setError(errorMessage(e));
      });
  }, [index, services, rerun]);

  // A new range: the failing traces of that range.
  const on = !!filter;
  useEffect(() => {
    if (!on || !services?.data) return;
    const subscription = services.data.query.timefilter.timefilter
      .getTimeUpdate$()
      .subscribe(() => load());
    return () => subscription.unsubscribe();
  }, [on, services, load]);

  useEffect(() => () => controller.current?.abort(), []);

  if (!enabled || !index) return null;

  const toggle = () => {
    if (filter) {
      controller.current?.abort();
      setFailingTracesFilter(undefined);
      rerun();
    } else load();
  };

  return (
    <EuiFlexGroup
      gutterSize="s"
      alignItems="center"
      justifyContent="flexEnd"
      responsive={false}
      className="agentTracesFailingFilter"
      data-test-subj="agtEvlFailingFilterBar"
    >
      {filter?.capped && (
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued" data-test-subj="agtEvlFailingFilterCapped">
            {i18n.translate('agentTraces.evals.failingFilter.capped', {
              defaultMessage:
                'Showing the {max} most recent failing traces in the range; older ones are left out.',
              values: { max: FAILING_TRACES_LIMIT },
            })}
          </EuiText>
        </EuiFlexItem>
      )}
      {error && (
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="danger" data-test-subj="agtEvlFailingFilterError">
            {error}
          </EuiText>
        </EuiFlexItem>
      )}
      <EuiFlexItem grow={false}>
        <EuiToolTip
          content={i18n.translate('agentTraces.evals.failingFilter.tip', {
            defaultMessage: 'Only traces with at least one failing evaluation result',
          })}
        >
          <EuiSwitch
            compressed
            label={
              <span>
                {i18n.translate('agentTraces.evals.failingFilter.label', {
                  defaultMessage: 'Failing evaluations only',
                })}
                {filter && ` (${filter.traceIds.length.toLocaleString()})`}
              </span>
            }
            checked={on}
            disabled={loading}
            onChange={toggle}
            data-test-subj="agtEvlFailingFilter"
          />
        </EuiToolTip>
      </EuiFlexItem>
      {loading && (
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="s" />
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );
};
