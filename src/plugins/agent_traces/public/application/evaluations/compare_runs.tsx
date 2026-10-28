/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFilterButton,
  EuiFilterGroup,
  EuiFlexGrid,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { EMPTY_RUN_EVENTS, EvalResult, RunEvents } from './eval_data';
import {
  CaseComparison,
  CaseStatus,
  ChangeKind,
  RunSummary,
  ValueComparison,
  compareRuns,
  parseEvalTime,
} from './eval_aggregations';
import { formatAggregate, formatDuration, formatEvalTime, shortId } from './eval_components';
import { CaseCompareFlyout, CaseStatusView } from './case_compare_flyout';
import { TraceCompareFlyout } from './trace_compare_flyout';

const CHANGE_TEXT: Record<ChangeKind, string> = {
  improved: i18n.translate('agentTraces.evalsPage.changeImproved', { defaultMessage: 'Improved' }),
  regressed: i18n.translate('agentTraces.evalsPage.changeRegressed', {
    defaultMessage: 'Regressed',
  }),
  unchanged: i18n.translate('agentTraces.evalsPage.changeUnchanged', {
    defaultMessage: 'Unchanged',
  }),
  new: i18n.translate('agentTraces.evalsPage.changeNew', { defaultMessage: 'New' }),
  missing: i18n.translate('agentTraces.evalsPage.changeMissing', { defaultMessage: 'Missing' }),
};

const CHANGE_COLOR: Record<ChangeKind, string> = {
  improved: 'secondary',
  regressed: 'danger',
  unchanged: 'hollow',
  new: 'primary',
  missing: 'default',
};

const CHANGE_ICON: Partial<Record<ChangeKind, string>> = {
  improved: 'sortUp',
  regressed: 'sortDown',
  new: 'plusInCircle',
};

/**
 * Signed difference in the evaluation's own unit: score points when both runs report
 * numbers, else pass-rate points.
 */
export const formatDelta = (v: ValueComparison): string | undefined => {
  const b = v.baseline;
  const c = v.candidate;
  if (!b || !c) return undefined;
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '+');
  if (b.mean !== undefined && c.mean !== undefined) {
    const d = c.mean - b.mean;
    return `${sign(d)}${Math.abs(d).toFixed(2)}`;
  }
  if (b.passRate !== undefined && c.passRate !== undefined) {
    const d = (c.passRate - b.passRate) * 100;
    return `${sign(d)}${Math.abs(d).toFixed(0)} pts`;
  }
  return undefined;
};

export const DeltaChip: React.FC<{ value: ValueComparison }> = ({ value }) => {
  const delta = formatDelta(value);
  return (
    <EuiBadge
      color={CHANGE_COLOR[value.change]}
      iconType={CHANGE_ICON[value.change]}
      data-test-subj={`agtEvlDeltaChip-${value.change}`}
    >
      {delta ?? CHANGE_TEXT[value.change]}
    </EuiBadge>
  );
};

/** Time to center a trace link on: the case event's time, else the run start. */
const timeOf = (eventTime: string | undefined, runStarted: number | undefined): number => {
  const t = parseEvalTime(eventTime);
  if (Number.isFinite(t)) return t;
  return runStarted !== undefined && Number.isFinite(runStarted) ? runStarted : Date.now();
};

type CaseFilter = 'all' | 'improved' | 'regressed' | 'new' | 'missing';

const RunHeader: React.FC<{ title: string; id: string; run?: RunSummary }> = ({
  title,
  id,
  run,
}) => (
  <EuiPanel hasBorder paddingSize="s">
    <EuiText size="xs" color="subdued">
      {title}
    </EuiText>
    <EuiText size="s" className="agtEvlMono">
      <strong>{shortId(id, 32)}</strong>
    </EuiText>
    {run && (
      <EuiText size="xs" color="subdued">
        {formatEvalTime(run.started, 'MMM D, YYYY HH:mm')} ·{' '}
        <FormattedMessage
          id="agentTraces.evalsPage.runCases"
          defaultMessage="{passed} of {cases} test cases passed"
          values={{ passed: run.casesPassed, cases: run.cases }}
        />
        {run.casesErrored > 0 && (
          <>
            {' · '}
            <FormattedMessage
              id="agentTraces.evalsPage.runCasesErrored"
              defaultMessage="{errored} errored"
              values={{ errored: run.casesErrored }}
            />
          </>
        )}
        {run.durationMs !== undefined && <> · {formatDuration(run.durationMs)}</>}
      </EuiText>
    )}
  </EuiPanel>
);

export const CompareRuns: React.FC<{
  results: EvalResult[];
  /** Test case events of the runs, when they emitted them. */
  events?: RunEvents;
  baselineId: string;
  candidateId: string;
  baseline?: RunSummary;
  candidate?: RunSummary;
  onBack: () => void;
  /** Back link text; the runs list by default. */
  backLabel?: string;
  onSwap: () => void;
  onOpenTrace: (traceId: string, aroundMs: number) => void;
}> = ({
  results,
  events = EMPTY_RUN_EVENTS,
  baselineId,
  candidateId,
  baseline,
  candidate,
  onBack,
  backLabel,
  onSwap,
  onOpenTrace,
}) => {
  const comparison = useMemo(
    () => compareRuns(results, baselineId, candidateId, events),
    [results, baselineId, candidateId, events]
  );
  const [openCaseId, setOpenCaseId] = useState<string | undefined>();
  const openCase = comparison.cases.find((c) => c.caseId === openCaseId);
  const [tracesOpen, setTracesOpen] = useState(false);
  const [filter, setFilter] = useState<CaseFilter>('all');
  const cases = useMemo(
    () =>
      filter === 'all' ? comparison.cases : comparison.cases.filter((c) => c.change === filter),
    [comparison, filter]
  );

  const missing = !baseline || !candidate;

  const columns: Array<EuiBasicTableColumn<CaseComparison>> = [
    {
      field: 'caseId',
      name: i18n.translate('agentTraces.evalsPage.colCase', { defaultMessage: 'Test case' }),
      render: (caseId: string, c: CaseComparison) => (
        <div>
          <EuiText size="xs">
            <EuiLink onClick={() => setOpenCaseId(caseId)} data-test-subj="agtEvlCompareCaseOpen">
              <strong>{c.caseName ?? caseId}</strong>
            </EuiLink>
          </EuiText>
          {c.caseName && (
            <EuiText size="xs" color="subdued" className="agtEvlMono">
              {shortId(caseId, 24)}
            </EuiText>
          )}
        </div>
      ),
    },
    {
      field: 'change',
      name: i18n.translate('agentTraces.evalsPage.colChange', { defaultMessage: 'Change' }),
      width: '130px',
      render: (change: ChangeKind) => (
        <EuiBadge color={CHANGE_COLOR[change]} iconType={CHANGE_ICON[change]}>
          {CHANGE_TEXT[change]}
        </EuiBadge>
      ),
    },
    {
      field: 'candidateStatus',
      name: i18n.translate('agentTraces.evalsPage.colStatus', {
        defaultMessage: 'Baseline, candidate',
      }),
      render: (_s: CaseStatus | undefined, c: CaseComparison) => (
        <div data-test-subj="agtEvlCompareCaseStatus">
          <CaseStatusView status={c.baselineStatus} errorType={c.baselineCase?.errorType} />
          <CaseStatusView status={c.candidateStatus} errorType={c.candidateCase?.errorType} />
        </div>
      ),
    },
    ...comparison.evaluatorNames.map((name): EuiBasicTableColumn<CaseComparison> => ({
      name,
      render: (c: CaseComparison) => {
        const v = c.evaluators[name];
        if (!v) {
          return (
            <EuiText size="xs" color="subdued">
              -
            </EuiText>
          );
        }
        return (
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
            <EuiFlexItem grow={false}>
              <EuiText size="xs">
                {formatAggregate(v.baseline)} → {formatAggregate(v.candidate)}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <DeltaChip value={v} />
            </EuiFlexItem>
          </EuiFlexGroup>
        );
      },
    })),
    {
      name: i18n.translate('agentTraces.evalsPage.colTraces', { defaultMessage: 'Traces' }),
      render: (c: CaseComparison) => (
        <EuiFlexGroup gutterSize="s" responsive={false}>
          {c.baselineTraceId && (
            <EuiFlexItem grow={false}>
              <EuiLink
                onClick={() =>
                  onOpenTrace(
                    c.baselineTraceId as string,
                    timeOf(c.baselineCase?.time, baseline?.started)
                  )
                }
                data-test-subj="agtEvlCompareBaselineTrace"
              >
                {i18n.translate('agentTraces.evalsPage.baselineTrace', {
                  defaultMessage: 'Baseline',
                })}
              </EuiLink>
            </EuiFlexItem>
          )}
          {c.candidateTraceId && (
            <EuiFlexItem grow={false}>
              <EuiLink
                onClick={() =>
                  onOpenTrace(
                    c.candidateTraceId as string,
                    timeOf(c.candidateCase?.time, candidate?.started)
                  )
                }
                data-test-subj="agtEvlCompareCandidateTrace"
              >
                {i18n.translate('agentTraces.evalsPage.candidateTrace', {
                  defaultMessage: 'Candidate',
                })}
              </EuiLink>
            </EuiFlexItem>
          )}
          {c.baselineTraceId && c.candidateTraceId && (
            <EuiFlexItem grow={false}>
              <EuiToolTip
                content={i18n.translate('agentTraces.evalsPage.compareTracesTip', {
                  defaultMessage: 'Both agent traces side by side',
                })}
              >
                <EuiLink
                  onClick={() => {
                    setOpenCaseId(c.caseId);
                    setTracesOpen(true);
                  }}
                  data-test-subj="agtEvlCompareTracesLink"
                >
                  {i18n.translate('agentTraces.evalsPage.compareTracesShort', {
                    defaultMessage: 'Compare',
                  })}
                </EuiLink>
              </EuiToolTip>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      ),
    },
  ];

  const filters: Array<{ id: CaseFilter; label: string; count: number }> = [
    {
      id: 'all',
      label: i18n.translate('agentTraces.evalsPage.filterAll', { defaultMessage: 'All' }),
      count: comparison.cases.length,
    },
    { id: 'improved', label: CHANGE_TEXT.improved, count: comparison.counts.improved },
    { id: 'regressed', label: CHANGE_TEXT.regressed, count: comparison.counts.regressed },
    { id: 'new', label: CHANGE_TEXT.new, count: comparison.counts.new },
    { id: 'missing', label: CHANGE_TEXT.missing, count: comparison.counts.missing },
  ];

  return (
    <div data-test-subj="agtEvlCompare">
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            iconType="arrowLeft"
            size="s"
            flush="left"
            onClick={onBack}
            data-test-subj="agtEvlCompareBack"
          >
            {backLabel ??
              i18n.translate('agentTraces.evalsPage.backToRuns', {
                defaultMessage: 'Evaluation runs',
              })}
          </EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiTitle size="s">
            <h2>
              <FormattedMessage
                id="agentTraces.evalsPage.compareTitle"
                defaultMessage="Compare runs{suite}"
                values={{ suite: baseline?.suiteName ? `: ${baseline.suiteName}` : '' }}
              />
            </h2>
          </EuiTitle>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {missing && (
        <>
          <EuiCallOut
            size="s"
            color="warning"
            iconType="alert"
            data-test-subj="agtEvlCompareMissing"
            title={i18n.translate('agentTraces.evalsPage.compareMissing', {
              defaultMessage:
                'One of the runs has no results in this time range. Widen the time range to compare them.',
            })}
          />
          <EuiSpacer size="s" />
        </>
      )}
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem>
          <RunHeader
            title={i18n.translate('agentTraces.evalsPage.baseline', { defaultMessage: 'Baseline' })}
            id={baselineId}
            run={baseline}
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiToolTip
            content={i18n.translate('agentTraces.evalsPage.swap', {
              defaultMessage: 'Swap baseline and candidate',
            })}
          >
            <EuiButtonEmpty
              iconType="merge"
              size="s"
              onClick={onSwap}
              data-test-subj="agtEvlCompareSwap"
            >
              {i18n.translate('agentTraces.evalsPage.swapShort', { defaultMessage: 'Swap' })}
            </EuiButtonEmpty>
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem>
          <RunHeader
            title={i18n.translate('agentTraces.evalsPage.candidate', {
              defaultMessage: 'Candidate',
            })}
            id={candidateId}
            run={candidate}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiFlexGrid columns={4} gutterSize="s">
        {comparison.evaluators.map((e) => (
          <EuiFlexItem key={e.name}>
            <EuiPanel hasBorder paddingSize="s" data-test-subj="agtEvlCompareEvaluator">
              <EuiText size="xs" className="eui-textTruncate">
                <strong title={e.name}>{e.name}</strong>
              </EuiText>
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiText size="s">
                    {formatAggregate(e.baseline)} → <strong>{formatAggregate(e.candidate)}</strong>
                  </EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <DeltaChip value={e} />
                </EuiFlexItem>
              </EuiFlexGroup>
              <EuiText size="xs" color="subdued">
                <FormattedMessage
                  id="agentTraces.evalsPage.compareCounts"
                  defaultMessage="{improved} improved, {regressed} regressed, {unchanged} unchanged"
                  values={{
                    improved: e.improved,
                    regressed: e.regressed,
                    unchanged: e.unchanged,
                  }}
                />
              </EuiText>
            </EuiPanel>
          </EuiFlexItem>
        ))}
      </EuiFlexGrid>
      <EuiSpacer size="m" />
      <EuiFilterGroup>
        {filters.map((f) => (
          <EuiFilterButton
            key={f.id}
            hasActiveFilters={filter === f.id}
            numFilters={f.count}
            onClick={() => setFilter(f.id)}
            data-test-subj={`agtEvlCaseFilter-${f.id}`}
          >
            {f.label}
          </EuiFilterButton>
        ))}
      </EuiFilterGroup>
      <EuiSpacer size="s" />
      <EuiInMemoryTable<CaseComparison>
        items={cases}
        itemId="caseId"
        columns={columns}
        pagination={{ initialPageSize: 25, pageSizeOptions: [25, 50, 100] }}
        message={i18n.translate('agentTraces.evalsPage.noCases', {
          defaultMessage: 'No test cases in this group.',
        })}
        data-test-subj="agtEvlCompareCases"
      />
      {openCase && tracesOpen && openCase.baselineTraceId && openCase.candidateTraceId && (
        <TraceCompareFlyout
          caseName={openCase.caseName ?? openCase.caseId}
          baseline={{
            label: baselineId,
            traceId: openCase.baselineTraceId,
            aroundMs: timeOf(openCase.baselineCase?.time, baseline?.started),
          }}
          candidate={{
            label: candidateId,
            traceId: openCase.candidateTraceId,
            aroundMs: timeOf(openCase.candidateCase?.time, candidate?.started),
          }}
          onBack={() => setTracesOpen(false)}
          onClose={() => {
            setTracesOpen(false);
            setOpenCaseId(undefined);
          }}
          onOpenTrace={onOpenTrace}
        />
      )}
      {openCase && !tracesOpen && (
        <CaseCompareFlyout
          comparison={openCase}
          baselineStartedMs={baseline?.started ?? Date.now()}
          candidateStartedMs={candidate?.started ?? Date.now()}
          onClose={() => setOpenCaseId(undefined)}
          onOpenTrace={onOpenTrace}
          onCompareTraces={() => setTracesOpen(true)}
        />
      )}
    </div>
  );
};
