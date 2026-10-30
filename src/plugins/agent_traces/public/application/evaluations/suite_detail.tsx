/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One test suite: its header (back to all suites, a switcher), KPI cards of the latest run
 * against the baseline, and the trend of its evaluations over its runs.
 */

import React, { useMemo } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import type { EvaluationsServices } from '.';
import { ChangeKind, RunSummary, suiteTrend } from './eval_aggregations';
import { SuiteTrendChart } from './eval_charts';
import { SectionHeader, formatDuration, formatTokens } from './eval_components';
import { ChangeDelta } from './compare_runs';
import { useEvalsIndexPattern, useSpansIndexPattern } from './eval_dataset';
import { RunKpis, SuiteKpisState, recentSuiteRuns, useSuiteKpis } from './use_suite_kpis';
import { AGENT_EVALS_INDEX_PATTERN } from '../../../common';

/** One KPI: how it reads a run, how it prints, and which way is better. */
export interface KpiSpec {
  id: string;
  label: string;
  value: (run: RunSummary, kpis?: RunKpis) => number | undefined;
  format: (v: number) => string;
  better: 'up' | 'down';
}

export const KPI_SPECS: KpiSpec[] = [
  {
    id: 'casesPassed',
    label: i18n.translate('agentTraces.evalsPage.kpiCases', { defaultMessage: 'Cases passed' }),
    value: (r) => (r.cases > 0 ? r.casesPassed : undefined),
    format: (v) => String(Math.round(v)),
    better: 'up',
  },
  {
    id: 'latencyP50',
    label: i18n.translate('agentTraces.evalsPage.kpiP50', { defaultMessage: 'Latency p50' }),
    value: (_r, k) => k?.latencyP50Ms,
    format: (v) => formatDuration(v),
    better: 'down',
  },
  {
    id: 'latencyP95',
    label: i18n.translate('agentTraces.evalsPage.kpiP95', { defaultMessage: 'Latency p95' }),
    value: (_r, k) => k?.latencyP95Ms,
    format: (v) => formatDuration(v),
    better: 'down',
  },
  {
    id: 'tokens',
    label: i18n.translate('agentTraces.evalsPage.kpiTokens', { defaultMessage: 'Tokens / case' }),
    value: (_r, k) => k?.tokensPerCase,
    format: (v) => formatTokens(Math.round(v)),
    better: 'down',
  },
  {
    id: 'toolCalls',
    label: i18n.translate('agentTraces.evalsPage.kpiTools', {
      defaultMessage: 'Tool calls / case',
    }),
    value: (_r, k) => k?.toolCallsPerCase,
    format: (v) => v.toFixed(1),
    better: 'up',
  },
  {
    id: 'evaluatorErrors',
    label: i18n.translate('agentTraces.evalsPage.kpiErrors', {
      defaultMessage: 'Evaluator errors',
    }),
    value: (_r, k) => k?.evaluatorErrors,
    format: (v) => String(Math.round(v)),
    better: 'down',
  },
];

/** The change from the baseline, colored by which way is better. */
export const kpiChange = (
  spec: KpiSpec,
  current?: number,
  baseline?: number
): { text?: string; change?: ChangeKind } => {
  if (current === undefined || baseline === undefined) return {};
  const d = current - baseline;
  if (Math.abs(d) < 1e-9) {
    return {
      text: i18n.translate('agentTraces.evalsPage.kpiSame', { defaultMessage: 'same' }),
      change: 'unchanged',
    };
  }
  const worse = spec.better === 'up' ? d < 0 : d > 0;
  return {
    text: `${d > 0 ? '↗' : '↘'} ${spec.format(Math.abs(d))}`,
    change: worse ? 'regressed' : 'improved',
  };
};

/** Small bars of the last runs: the latest filled, the baseline outlined. */
const KpiBars: React.FC<{
  values: Array<number | undefined>;
  latest: number;
  baseline?: number;
  worse?: boolean;
}> = ({ values, latest, baseline, worse }) => {
  const max = Math.max(1e-9, ...values.map((v) => v ?? 0)) * 1.1;
  const W = 160;
  const H = 32;
  const slot = W / Math.max(values.length, 1);
  return (
    <svg
      className="agtEvlKpiBars"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
      aria-hidden
    >
      {values.map((v, i) => {
        const h = v === undefined ? 2 : Math.max(2, (v / max) * H);
        const cls =
          i === latest
            ? worse
              ? 'agtEvlKpiBars__bar--worse'
              : 'agtEvlKpiBars__bar--latest'
            : 'agtEvlKpiBars__bar';
        return (
          <rect
            key={i}
            x={i * slot + slot * 0.15}
            y={H - h}
            width={slot * 0.7}
            height={h}
            rx={1.5}
            className={`${cls}${i === baseline ? ' agtEvlKpiBars__bar--baseline' : ''}`}
          />
        );
      })}
    </svg>
  );
};

export const KpiCards: React.FC<{
  /** The suite's last runs, oldest first. */
  runs: RunSummary[];
  kpis: SuiteKpisState;
}> = ({ runs, kpis }) => {
  const latestIndex = runs.length - 1;
  const latest = runs[latestIndex];
  const baselineIndex = latest?.previousRunId
    ? runs.findIndex((r) => r.runId === latest.previousRunId)
    : latestIndex - 1;
  const baseline = baselineIndex >= 0 ? runs[baselineIndex] : undefined;
  if (!latest) return null;
  const cards = KPI_SPECS.map((spec) => {
    const values = runs.map((r) => spec.value(r, kpis.byRun.get(r.runId)));
    return { spec, values, current: values[latestIndex] };
  }).filter(({ spec, values }) => {
    // Cards with nothing to show are left out (no case events, no span index).
    if (spec.id === 'casesPassed') return true;
    return !kpis.loading && values.some((v) => v !== undefined);
  });
  return (
    <EuiFlexGroup gutterSize="m" wrap responsive={false} data-test-subj="agtEvlSuiteKpis">
      {cards.map(({ spec, values, current }) => {
        const before = baselineIndex >= 0 ? values[baselineIndex] : undefined;
        const { text, change } = kpiChange(spec, current, before);
        const shown =
          spec.id === 'casesPassed' && current !== undefined
            ? `${spec.format(current)} / ${latest.cases}`
            : current === undefined
              ? '-'
              : spec.format(current);
        return (
          <EuiFlexItem key={spec.id} style={{ minWidth: 170 }}>
            <EuiPanel
              hasBorder
              paddingSize="s"
              className="agtEvlKpiCard"
              data-test-subj={`agtEvlKpi-${spec.id}`}
            >
              <EuiText size="xs" color="subdued">
                {spec.label}
              </EuiText>
              <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiTitle size="s">
                    <span className="agtEvlNum">{shown}</span>
                  </EuiTitle>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <ChangeDelta
                    text={text}
                    change={change}
                    data-test-subj={`agtEvlKpiDelta-${spec.id}`}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
              <KpiBars
                values={values}
                latest={latestIndex}
                baseline={baselineIndex >= 0 ? baselineIndex : undefined}
                worse={change === 'regressed'}
              />
              <EuiText size="xs" color="subdued">
                {before !== undefined
                  ? i18n.translate('agentTraces.evalsPage.kpiBaseline', {
                      defaultMessage: 'baseline {value} · last {count} runs',
                      values: {
                        value:
                          spec.id === 'casesPassed' && baseline
                            ? `${spec.format(before)} / ${baseline.cases}`
                            : spec.format(before),
                        count: runs.length,
                      },
                    })
                  : i18n.translate('agentTraces.evalsPage.kpiNoBaseline', {
                      defaultMessage: 'no earlier run',
                    })}
              </EuiText>
            </EuiPanel>
          </EuiFlexItem>
        );
      })}
    </EuiFlexGroup>
  );
};

/** The header of one suite: back to all suites, and a switcher. */
export const SuiteHeader: React.FC<{
  suite: string;
  suites: string[];
  baseline?: RunSummary;
  onSelect: (suite?: string) => void;
}> = ({ suite, suites, baseline, onSelect }) => (
  <EuiFlexGroup alignItems="flexEnd" gutterSize="m" responsive={false}>
    <EuiFlexItem grow={false}>
      <EuiText size="xs" color="subdued">
        <EuiLink onClick={() => onSelect(undefined)} data-test-subj="agtEvlSuiteBack">
          {i18n.translate('agentTraces.evalsPage.suitesCrumb', { defaultMessage: 'Test suites' })}
        </EuiLink>{' '}
        /
      </EuiText>
      <EuiSelect
        compressed
        aria-label={i18n.translate('agentTraces.evalsPage.suitePicker', {
          defaultMessage: 'Test suite',
        })}
        options={suites.map((s) => ({ value: s, text: s }))}
        value={suite}
        onChange={(e) => onSelect(e.target.value)}
        data-test-subj="agtEvlSuitePicker"
      />
    </EuiFlexItem>
    <EuiFlexItem />
    {baseline && (
      <EuiFlexItem grow={false}>
        <EuiToolTip content={baseline.runId}>
          <EuiText size="xs" color="subdued" data-test-subj="agtEvlSuiteBaseline">
            {i18n.translate('agentTraces.evalsPage.latestVsBaseline', {
              defaultMessage: 'Latest run against the baseline (the run before it)',
            })}
          </EuiText>
        </EuiToolTip>
      </EuiFlexItem>
    )}
  </EuiFlexGroup>
);

/** KPI cards and the trend of one suite; reads its operational numbers while shown. */
export const SuiteDetail: React.FC<{
  suite: string;
  /** The suite's name as stored, undefined for runs without one. */
  suiteName?: string;
  suites: string[];
  runs: RunSummary[];
  onSelect: (suite?: string) => void;
  onOpenRun?: (runId: string) => void;
}> = ({ suite, suiteName, suites, runs, onSelect, onOpenRun }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const index = useEvalsIndexPattern() ?? AGENT_EVALS_INDEX_PATTERN;
  const spansIndex = useSpansIndexPattern();
  const recent = useMemo(() => recentSuiteRuns(runs, suiteName), [runs, suiteName]);
  const kpis = useSuiteKpis(services.data, recent, index, spansIndex);
  const points = useMemo(() => suiteTrend(runs, suiteName), [runs, suiteName]);
  const latest = recent[recent.length - 1];
  const baseline = latest?.previousRunId
    ? recent.find((r) => r.runId === latest.previousRunId)
    : recent[recent.length - 2];
  return (
    <div data-test-subj="agtEvlSuiteDetail">
      <SuiteHeader suite={suite} suites={suites} baseline={baseline} onSelect={onSelect} />
      <EuiSpacer size="m" />
      {kpis.loading && kpis.byRun.size === 0 ? (
        <EuiLoadingContent lines={3} />
      ) : (
        <KpiCards runs={recent} kpis={kpis} />
      )}
      <EuiSpacer size="m" />
      {points.length > 0 && latest && (
        <EuiPanel hasBorder paddingSize="m">
          <SectionHeader
            title={i18n.translate('agentTraces.evalsPage.suiteTimeline', {
              defaultMessage: 'Comparing {count} runs across {evaluations} evaluations',
              values: {
                count: points.length,
                evaluations: new Set(points.flatMap((p) => Object.keys(p.evaluators))).size,
              },
            })}
          />
          <EuiSpacer size="s" />
          <SuiteTrendChart points={points} currentRunId={latest.runId} onSelectRun={onOpenRun} />
        </EuiPanel>
      )}
    </div>
  );
};
