/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTableColumn,
  EuiButton,
  EuiButtonEmpty,
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiFilterButton,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingContent,
  EuiPanel,
  EuiPopover,
  EuiPopoverTitle,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import {
  CaseChange,
  CaseStatus,
  CompareCaseRow,
  CompareEvalRow,
  CompareSide,
  comparison,
  suiteRuns,
} from './eval_model';
import { NO_AGENT, buildCompareRunsQuery, buildSuiteRunsQuery } from './eval_ppl';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { TraceCompareFlyout } from './trace_compare_flyout';
import {
  DASH,
  DeltaCell,
  MetaItem,
  QueryErrorCallout,
  RUN_A,
  RUN_B,
  VerdictBadge,
  VersionBadge,
  agentLabel,
  formatTime,
  pct,
  shortId,
} from './eval_components';

const CHANGE_ORDER: Record<CaseChange, number> = { regressed: 0, changed: 1, fixed: 2, same: 3 };

const ChangeBadge: React.FC<{ change: CaseChange }> = ({ change }) =>
  change === 'regressed' ? (
    <EuiBadge color="danger">
      {i18n.translate('agentTraces.evals.compare.regressed', { defaultMessage: 'Regressed' })}
    </EuiBadge>
  ) : change === 'fixed' ? (
    <EuiBadge color="success">
      {i18n.translate('agentTraces.evals.compare.fixed', { defaultMessage: 'Fixed' })}
    </EuiBadge>
  ) : change === 'changed' ? (
    <EuiBadge color="default">
      {i18n.translate('agentTraces.evals.compare.changed', { defaultMessage: 'Changed' })}
    </EuiBadge>
  ) : (
    <span className="agtEvlDim">
      {i18n.translate('agentTraces.evals.compare.same', { defaultMessage: 'Same' })}
    </span>
  );

const statusCell = (s?: CaseStatus) =>
  s ? <VerdictBadge verdict={s} /> : <span className="agtEvlDim">{DASH}</span>;

/** "Change": pick another run of the suite for one side, read when the menu opens. */
const RunPicker: React.FC<{
  suite?: string;
  side: 'a' | 'b';
  other: string;
  onPick: (runId: string) => void;
}> = ({ suite, side, other, onPick }) => {
  const { dataset, index, timeRange, refreshKey } = useEvalContext();
  const [open, setOpen] = useState(false);
  const { rows, loading } = usePplRows(
    dataset,
    open && suite ? buildSuiteRunsQuery(index, suite) : undefined,
    timeRange,
    refreshKey
  );
  const runs = useMemo(
    () =>
      suiteRuns(rows)
        .filter((r) => r.runId !== other)
        .reverse(),
    [rows, other]
  );
  return (
    <EuiPopover
      isOpen={open}
      closePopover={() => setOpen(false)}
      panelPaddingSize="none"
      anchorPosition="downRight"
      button={
        <EuiButtonEmpty
          size="xs"
          iconType="arrowDown"
          iconSide="right"
          isDisabled={!suite}
          onClick={() => setOpen(!open)}
          data-test-subj={`agtEvlPickRun-${side}`}
        >
          {i18n.translate('agentTraces.evals.compare.change', { defaultMessage: 'Change' })}
        </EuiButtonEmpty>
      }
    >
      <EuiPopoverTitle paddingSize="s">
        {side === 'a'
          ? i18n.translate('agentTraces.evals.compare.pickA', { defaultMessage: 'Pick run A' })
          : i18n.translate('agentTraces.evals.compare.pickB', { defaultMessage: 'Pick run B' })}
      </EuiPopoverTitle>
      {loading && !runs.length ? (
        <EuiLoadingContent lines={2} />
      ) : (
        <EuiContextMenuPanel
          size="s"
          items={runs.map((r) => (
            <EuiContextMenuItem
              key={r.runId}
              onClick={() => {
                setOpen(false);
                onPick(r.runId);
              }}
            >
              <span className="agtEvlMono">{shortId(r.runId)}</span>{' '}
              <VersionBadge version={r.version} />{' '}
              <span className="agtEvlDim">{formatTime(r.started)}</span>
            </EuiContextMenuItem>
          ))}
        />
      )}
    </EuiPopover>
  );
};

const RunCard: React.FC<{
  label: string;
  side: CompareSide;
  picker: React.ReactNode;
}> = ({ label, side, picker }) => {
  const { navigate } = useEvalContext();
  return (
    <EuiPanel paddingSize="m" hasShadow={false} hasBorder data-test-subj={`agtEvlRunCard-${label}`}>
      <EuiText size="xs" color="subdued">
        {label}
      </EuiText>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <EuiLink
              className="agtEvlMono"
              title={side.runId}
              onClick={() => navigate({ page: 'run', runId: side.runId })}
            >
              {shortId(side.runId)}
            </EuiLink>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <VersionBadge version={side.version} />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {formatTime(side.started)}
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem />
        <EuiFlexItem grow={false}>{picker}</EuiFlexItem>
      </EuiFlexGroup>
      <EuiText size="s">
        <p>
          {i18n.translate('agentTraces.evals.compare.cardLine', {
            defaultMessage: '{passed} / {cases} cases passed · {rate} result pass rate',
            values: { passed: side.casesPassed, cases: side.cases, rate: pct(side.rate) },
          })}
        </p>
      </EuiText>
    </EuiPanel>
  );
};

/** Two runs of a suite, Run A the baseline: per-case changes and per-evaluation pass rates. */
export const CompareRuns: React.FC<{ runA: string; runB: string }> = ({ runA, runB }) => {
  const { dataset, index, timeRange, refreshKey, navigate } = useEvalContext();
  const { rows, loading, error } = usePplRows(
    dataset,
    buildCompareRunsQuery(index, runA, runB),
    timeRange,
    refreshKey
  );
  const cmp = useMemo(() => comparison(runA, runB, rows), [runA, runB, rows]);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [traces, setTraces] = useState<CompareCaseRow>();
  const changed = cmp.cases.filter((c) => c.change !== 'same');
  const shown = onlyChanged ? changed : cmp.cases;
  const regressed = changed.filter((c) => c.change === 'regressed').length;
  const fixed = changed.filter((c) => c.change === 'fixed').length;
  const colA = `${RUN_A} · ${cmp.a.version ?? DASH}`;
  const colB = `${RUN_B} · ${cmp.b.version ?? DASH}`;

  const caseColumns: Array<EuiBasicTableColumn<CompareCaseRow>> = [
    {
      field: 'caseName',
      name: i18n.translate('agentTraces.evals.compare.case', { defaultMessage: 'Case' }),
      sortable: (c: CompareCaseRow) => c.caseName ?? c.caseId,
      render: (_: unknown, c: CompareCaseRow) => (
        <span>
          <strong>{c.caseName ?? c.caseId}</strong>{' '}
          <span className="agtEvlDim agtEvlSmall agtEvlMono">{c.caseId}</span>
        </span>
      ),
    },
    { field: 'a', name: colA, render: statusCell },
    { field: 'b', name: colB, render: statusCell },
    {
      field: 'change',
      name: i18n.translate('agentTraces.evals.compare.changeCol', { defaultMessage: 'Change' }),
      sortable: (c: CompareCaseRow) => CHANGE_ORDER[c.change],
      render: (change: CaseChange) => <ChangeBadge change={change} />,
    },
    {
      field: 'traceA',
      name: '',
      align: 'right',
      render: (_: unknown, c: CompareCaseRow) =>
        c.traceA && c.traceB ? (
          <EuiButtonEmpty
            size="xs"
            onClick={() => setTraces(c)}
            data-test-subj={`agtEvlCompareTraces-${c.caseId}`}
          >
            {i18n.translate('agentTraces.evals.compare.compareTraces', {
              defaultMessage: 'Compare traces',
            })}
          </EuiButtonEmpty>
        ) : null,
    },
  ];

  const evalColumns: Array<EuiBasicTableColumn<CompareEvalRow>> = [
    {
      field: 'name',
      name: i18n.translate('agentTraces.evals.compare.evaluation', {
        defaultMessage: 'Evaluation',
      }),
      sortable: true,
      render: (n: string) => <strong>{n}</strong>,
    },
    { field: 'a', name: colA, align: 'right', render: (x?: number) => pct(x) },
    { field: 'b', name: colB, align: 'right', render: (x?: number) => pct(x) },
    {
      field: 'delta',
      name: i18n.translate('agentTraces.evals.compare.changeCol', { defaultMessage: 'Change' }),
      align: 'right',
      sortable: (r: CompareEvalRow) => r.delta ?? Number.POSITIVE_INFINITY,
      render: (d?: number) => <DeltaCell delta={d} />,
    },
  ];

  if (error) return <QueryErrorCallout message={error} />;
  if (loading && !rows.length) return <EuiLoadingContent lines={8} />;

  return (
    <>
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem>
          <div className="agtEvlMeta" data-test-subj="agtEvlCompareMeta">
            <MetaItem
              label={i18n.translate('agentTraces.evals.compare.suite', { defaultMessage: 'Suite' })}
            >
              {cmp.suite ? (
                <EuiLink onClick={() => cmp.suite && navigate({ page: 'suite', suite: cmp.suite })}>
                  <strong>{cmp.suite}</strong>
                </EuiLink>
              ) : (
                DASH
              )}
            </MetaItem>
            <MetaItem
              label={i18n.translate('agentTraces.evals.compare.agent', { defaultMessage: 'Agent' })}
            >
              <EuiLink
                onClick={() =>
                  navigate({ page: 'agent', agent: cmp.agent ?? NO_AGENT, tab: 'suites' })
                }
              >
                <strong>{agentLabel(cmp.agent)}</strong>
              </EuiLink>
            </MetaItem>
            <span className="agtEvlDim">
              {i18n.translate('agentTraces.evals.compare.baseline', {
                defaultMessage: 'Run A is the baseline',
              })}
            </span>
          </div>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton
            size="s"
            iconType="merge"
            onClick={() => navigate({ page: 'compare', runA: runB, runB: runA })}
            data-test-subj="agtEvlSwapRuns"
          >
            {i18n.translate('agentTraces.evals.compare.swap', { defaultMessage: 'Swap A and B' })}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      <EuiFlexGroup gutterSize="m">
        <EuiFlexItem>
          <RunCard
            label={RUN_A}
            side={cmp.a}
            picker={
              <RunPicker
                suite={cmp.suite}
                side="a"
                other={runB}
                onPick={(id) => navigate({ page: 'compare', runA: id, runB })}
              />
            }
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <RunCard
            label={RUN_B}
            side={cmp.b}
            picker={
              <RunPicker
                suite={cmp.suite}
                side="b"
                other={runA}
                onPick={(id) => navigate({ page: 'compare', runA, runB: id })}
              />
            }
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <EuiFlexGroup alignItems="center" responsive={false}>
          <EuiFlexItem>
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('agentTraces.evals.compare.cases', { defaultMessage: 'Cases' })}
              </h3>
            </EuiTitle>
            <EuiText size="xs" color="subdued">
              <p>
                {i18n.translate('agentTraces.evals.compare.casesSub', {
                  defaultMessage:
                    '{regressed} regressed (passed in A, not in B) · {fixed} fixed. Compare traces shows both runs of a case side by side.',
                  values: { regressed, fixed },
                })}
              </p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFilterGroup data-test-subj="agtEvlChangedToggle">
              <EuiFilterButton
                hasActiveFilters={onlyChanged}
                numFilters={changed.length}
                onClick={() => setOnlyChanged(true)}
                data-test-subj="agtEvlOnlyChanged"
              >
                {i18n.translate('agentTraces.evals.compare.changedFilter', {
                  defaultMessage: 'Changed',
                })}
              </EuiFilterButton>
              <EuiFilterButton
                hasActiveFilters={!onlyChanged}
                numFilters={cmp.cases.length}
                onClick={() => setOnlyChanged(false)}
                data-test-subj="agtEvlAllCases"
              >
                {i18n.translate('agentTraces.evals.compare.all', { defaultMessage: 'All' })}
              </EuiFilterButton>
            </EuiFilterGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiInMemoryTable<CompareCaseRow>
          items={shown}
          itemId="caseId"
          columns={caseColumns}
          sorting={{ sort: { field: 'change', direction: 'asc' } }}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          message={i18n.translate('agentTraces.evals.compare.noChange', {
            defaultMessage: 'No case changed between the two runs.',
          })}
          data-test-subj="agtEvlCompareCases"
        />
      </EuiPanel>
      <EuiSpacer size="m" />
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
        <EuiTitle size="xs">
          <h3>
            {i18n.translate('agentTraces.evals.compare.evaluations', {
              defaultMessage: 'Evaluations',
            })}
          </h3>
        </EuiTitle>
        <EuiText size="xs" color="subdued">
          <p>
            {i18n.translate('agentTraces.evals.compare.evaluationsSub', {
              defaultMessage: 'Result pass rate per evaluation in each run.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiInMemoryTable<CompareEvalRow>
          items={cmp.evaluations}
          itemId="name"
          columns={evalColumns}
          sorting={{ sort: { field: 'delta', direction: 'asc' } }}
          data-test-subj="agtEvlCompareEvaluations"
        />
      </EuiPanel>
      {traces?.traceA && traces.traceB && (
        <TraceCompareFlyout
          caseId={traces.caseId}
          traceA={traces.traceA}
          traceB={traces.traceB}
          versionA={cmp.a.version}
          versionB={cmp.b.version}
          onClose={() => setTraces(undefined)}
        />
      )}
    </>
  );
};
