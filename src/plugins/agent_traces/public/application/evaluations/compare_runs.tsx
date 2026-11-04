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
  EuiButtonIcon,
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
  EvalResult,
  comparison,
  recordsToResults,
  suiteRuns,
} from './eval_model';
import {
  NO_AGENT,
  buildCaseResultsQuery,
  buildCompareRunsQuery,
  buildSuiteRunsQuery,
} from './eval_ppl';
import { SpanIOView } from './span_io_view';
import { useRootSpans } from './eval_spans';
import {
  DASH,
  DeltaCell,
  EXPECTED_LABEL,
  INPUT_LABEL,
  ResultRows,
  MetaItem,
  OUTPUT_LABEL,
  QueryErrorCallout,
  RunSelectList,
  RUN_A,
  RUN_B,
  VerdictBadge,
  VersionBadge,
  agentLabel,
  expectedNote,
  expectedOf,
  formatTime,
  pct,
  shortId,
} from './eval_components';
import { useEvalContext } from './eval_context';
import { usePplRows } from './use_ppl_rows';
import { TraceCompareFlyout } from './trace_compare_flyout';

const CHANGE_ORDER: Record<CaseChange, number> = {
  regressed: 0,
  changed: 1,
  onlyB: 2,
  onlyA: 3,
  fixed: 4,
  same: 5,
};

export type CaseFilter = 'changed' | 'regressed' | 'fixed' | 'only' | 'all';

/** Cases shown for a filter: Changed (any change), Regressed, Fixed, Only in one run, All. */
export const filterCompareCases = (cases: CompareCaseRow[], f: CaseFilter) =>
  cases.filter((c) =>
    f === 'all'
      ? true
      : f === 'changed'
        ? c.change !== 'same'
        : f === 'only'
          ? c.change === 'onlyA' || c.change === 'onlyB'
          : c.change === f
  );

const NOT_IN_RUN = i18n.translate('agentTraces.evals.compare.notInRun', {
  defaultMessage: 'Not in run',
});

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
  ) : change === 'onlyA' ? (
    <EuiBadge color="hollow">
      {i18n.translate('agentTraces.evals.compare.onlyA', { defaultMessage: 'Only in A' })}
    </EuiBadge>
  ) : change === 'onlyB' ? (
    <EuiBadge color="hollow">
      {i18n.translate('agentTraces.evals.compare.onlyB', { defaultMessage: 'Only in B' })}
    </EuiBadge>
  ) : (
    <span className="agtEvlDim">
      {i18n.translate('agentTraces.evals.compare.same', { defaultMessage: 'Same' })}
    </span>
  );

const statusCell = (s?: CaseStatus) =>
  s ? <VerdictBadge verdict={s} /> : <span className="agtEvlDim">{NOT_IN_RUN}</span>;

const VERDICT_ORDER: Record<string, number> = { fail: 0, error: 1, pass: 2, scored: 3 };

/** A side's results, failing first, with their scores and explanations. */
const SideResults: React.FC<{ results: EvalResult[]; inRun: boolean; testId: string }> = ({
  results,
  inRun,
  testId,
}) => {
  const { openResult } = useEvalContext();
  if (!inRun)
    return (
      <EuiText size="xs" color="subdued">
        {NOT_IN_RUN}
      </EuiText>
    );
  const sorted = [...results].sort(
    (x, y) => VERDICT_ORDER[x.verdict] - VERDICT_ORDER[y.verdict] || x.name.localeCompare(y.name)
  );
  return <ResultRows results={sorted} onOpen={openResult} testId={testId} />;
};

/**
 * An expanded case: input, expected output, and each run's output with its failing results
 * side by side. One query for the case's results in both runs, one for both root spans.
 */
const CompareCaseDetail: React.FC<{
  row: CompareCaseRow;
  runA: string;
  runB: string;
  versionA?: string;
  versionB?: string;
  onCompareTraces: () => void;
}> = ({ row, runA, runB, versionA, versionB, onCompareTraces }) => {
  const { dataset, index, timeRange, refreshKey } = useEvalContext();
  const { rows, loading, error } = usePplRows(
    dataset,
    buildCaseResultsQuery(index, [runA, runB], row.caseId),
    timeRange,
    refreshKey
  );
  const roots = useRootSpans([row.traceA, row.traceB]);
  const results = useMemo(() => recordsToResults(rows), [rows]);
  const ofRun = (runId: string) => results.filter((r) => r.runId === runId);
  const ioA = row.traceA ? roots.byTrace.get(row.traceA) : undefined;
  const ioB = row.traceB ? roots.byTrace.get(row.traceB) : undefined;
  const expected = expectedOf(results);
  if (error) return <QueryErrorCallout message={error} />;
  if (loading && !results.length) return <EuiLoadingContent lines={3} />;
  return (
    <div className="agtEvlCaseResults" data-test-subj={`agtEvlCompareCase-${row.caseId}`}>
      {/* A failed span read is an error, not missing input or output. */}
      {roots.error && <QueryErrorCallout message={roots.error} />}
      <SpanIOView
        idPrefix={`agtEvlCompareCase-${row.caseId}`}
        testId="agtEvlCompareIO"
        sections={[
          {
            key: 'input',
            label: INPUT_LABEL,
            value: ioA?.rawInput ?? ioB?.rawInput ?? ioA?.input ?? ioB?.input,
          },
          {
            key: 'expected',
            label: EXPECTED_LABEL,
            note: expectedNote(expected.truncated),
            value: expected.text,
          },
        ]}
      />
      <EuiSpacer size="m" />
      <div className="agtEvlSideBySide">
        {(
          [
            ['a', runA, ioA, versionA, RUN_A, !!row.a],
            ['b', runB, ioB, versionB, RUN_B, !!row.b],
          ] as const
        ).map(([side, runId, io, version, label, inRun]) => (
          <div key={side} data-test-subj={`agtEvlCompareSide-${side}`}>
            <SpanIOView
              idPrefix={`agtEvlCompareOut-${row.caseId}-${side}`}
              testId={`agtEvlCompareOutput${side.toUpperCase()}`}
              sections={[
                {
                  key: `output-${side}`,
                  label: `${OUTPUT_LABEL} · ${label} (${version ?? DASH})`,
                  value: io?.rawOutput ?? io?.output,
                },
              ]}
            />
            <EuiSpacer size="s" />
            <SideResults
              results={ofRun(runId)}
              inRun={inRun}
              testId={`agtEvlCompareResults-${side}`}
            />
          </div>
        ))}
      </div>
      {row.traceA && row.traceB && (
        <>
          <EuiSpacer size="s" />
          <EuiButtonEmpty
            size="xs"
            onClick={onCompareTraces}
            data-test-subj={`agtEvlCompareTracesDetail-${row.caseId}`}
          >
            {i18n.translate('agentTraces.evals.compare.compareTraces', {
              defaultMessage: 'Compare traces',
            })}
          </EuiButtonEmpty>
        </>
      )}
    </div>
  );
};

/** "Change": pick another run of the suite for one side, read when the menu opens. */
const RunPicker: React.FC<{
  suite?: string;
  side: 'a' | 'b';
  other: string;
  onPick: (runId: string) => void;
}> = ({ suite, side, other, onPick }) => {
  const { dataset, index, browseRange, refreshKey } = useEvalContext();
  const [open, setOpen] = useState(false);
  const { rows, loading } = usePplRows(
    dataset,
    open && suite ? buildSuiteRunsQuery(index, suite) : undefined,
    browseRange,
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
        <RunSelectList
          runs={runs}
          loading={loading}
          testId={`agtEvlPickRunList-${side}`}
          onPick={(picked) => {
            setOpen(false);
            onPick(picked);
          }}
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
  const [filter, setFilter] = useState<CaseFilter>('changed');
  const [traces, setTraces] = useState<CompareCaseRow>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const shown = filterCompareCases(cmp.cases, filter);
  const count = (f: CaseFilter) => filterCompareCases(cmp.cases, f).length;
  const toggle = (caseId: string) => setExpanded((e) => ({ ...e, [caseId]: !e[caseId] }));
  const expandedMap = Object.fromEntries(
    shown
      .filter((c) => expanded[c.caseId])
      .map((c) => [
        c.caseId,
        <CompareCaseDetail
          row={c}
          runA={runA}
          runB={runB}
          versionA={cmp.a.version}
          versionB={cmp.b.version}
          onCompareTraces={() => setTraces(c)}
        />,
      ])
  );
  const filters: Array<[CaseFilter, string]> = [
    [
      'changed',
      i18n.translate('agentTraces.evals.compare.changedFilter', { defaultMessage: 'Changed' }),
    ],
    [
      'regressed',
      i18n.translate('agentTraces.evals.compare.regressed', { defaultMessage: 'Regressed' }),
    ],
    ['fixed', i18n.translate('agentTraces.evals.compare.fixed', { defaultMessage: 'Fixed' })],
    ...(count('only')
      ? ([
          [
            'only',
            i18n.translate('agentTraces.evals.compare.onlyOne', {
              defaultMessage: 'Only in one run',
            }),
          ],
        ] as Array<[CaseFilter, string]>)
      : []),
    ['all', i18n.translate('agentTraces.evals.compare.all', { defaultMessage: 'All' })],
  ];
  const colA = `${RUN_A} · ${cmp.a.version ?? DASH}`;
  const colB = `${RUN_B} · ${cmp.b.version ?? DASH}`;

  const caseColumns: Array<EuiBasicTableColumn<CompareCaseRow>> = [
    {
      width: '32px',
      isExpander: true,
      render: (c: CompareCaseRow) => (
        <EuiButtonIcon
          onClick={() => toggle(c.caseId)}
          aria-label={i18n.translate('agentTraces.evals.compare.expand', {
            defaultMessage: 'Show the case',
          })}
          iconType={expanded[c.caseId] ? 'arrowDown' : 'arrowRight'}
        />
      ),
    },
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
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setTraces(c);
            }}
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
      render: (d: number | undefined, r: CompareEvalRow) => (
        <DeltaCell delta={d} na={r.nA} nb={r.nB} exact />
      ),
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
                    'Regressed: passed in A, not in B. Fixed: the reverse. Click a case for its expected output and both outputs side by side.',
                })}
              </p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFilterGroup data-test-subj="agtEvlCaseFilter">
              {filters.map(([key, label]) => (
                <EuiFilterButton
                  key={key}
                  hasActiveFilters={filter === key}
                  numFilters={count(key)}
                  onClick={() => setFilter(key)}
                  data-test-subj={`agtEvlCaseFilter-${key}`}
                >
                  {label}
                </EuiFilterButton>
              ))}
            </EuiFilterGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiInMemoryTable<CompareCaseRow>
          items={shown}
          itemId="caseId"
          columns={caseColumns}
          isExpandable
          itemIdToExpandedRowMap={expandedMap}
          sorting={{ sort: { field: 'change', direction: 'asc' } }}
          pagination={{ initialPageSize: 20, pageSizeOptions: [20, 50] }}
          rowProps={(c: CompareCaseRow) => ({
            className: 'agtEvlClickRow',
            onClick: (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest('a,button')) return;
              toggle(c.caseId);
            },
            'data-test-subj': `agtEvlCompareRow-${c.caseId}`,
          })}
          message={i18n.translate('agentTraces.evals.compare.noMatch', {
            defaultMessage: 'No case matches this filter.',
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
              defaultMessage:
                'Result pass rate per evaluation in each run. n = results with a pass rule.',
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
