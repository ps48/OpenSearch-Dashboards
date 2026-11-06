/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import {
  EuiBasicTableColumn,
  EuiButton,
  EuiButtonEmpty,
  EuiCheckbox,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { RunRow } from './eval_model';
import { runLabel, shortId } from './eval_components';

/** Two runs in time order: the older is A, the baseline. */
export const compareOrder = (runs: Array<Pick<RunRow, 'runId' | 'started'>>): [string, string] => {
  const [x, y] = [...runs].sort((p, q) => p.started - q.started);
  return [x.runId, y.runId];
};

type Pickable = Pick<RunRow, 'runId' | 'suite' | 'agent' | 'started'> & { name?: string };

export const NOT_COMPARABLE_TIP = i18n.translate('agentTraces.evals.runSelection.notComparable', {
  defaultMessage: 'Compare runs of the same test suite and agent',
});

export const TWO_PICKED_TIP = i18n.translate('agentTraces.evals.runSelection.twoPicked', {
  defaultMessage: 'Two runs are selected. Clear the selection to pick others.',
});

export interface RunSelection<T extends Pickable> {
  selected: T[];
  isSelected: (r: T) => boolean;
  toggle: (r: T) => void;
  clear: () => void;
  /** Why a run cannot be picked now (another test suite or agent, or two picked), if so. */
  blockedReason: (r: T) => string | undefined;
}

/**
 * Up to two runs to compare. After the first pick, only runs of the same test suite and agent
 * can be picked (as Compare runs requires).
 */
export const useRunSelection = <T extends Pickable>(): RunSelection<T> => {
  const [selected, setSelected] = useState<T[]>([]);
  const isSelected = useCallback((r: T) => selected.some((s) => s.runId === r.runId), [selected]);
  const toggle = useCallback(
    (r: T) =>
      setSelected((cur) =>
        cur.some((s) => s.runId === r.runId)
          ? cur.filter((s) => s.runId !== r.runId)
          : cur.length >= 2
            ? cur
            : [...cur, r]
      ),
    []
  );
  const clear = useCallback(() => setSelected([]), []);
  const blockedReason = (r: T) => {
    if (isSelected(r) || selected.length === 0) return undefined;
    const first = selected[0];
    if (r.suite !== first.suite || r.agent !== first.agent) return NOT_COMPARABLE_TIP;
    if (selected.length >= 2) return TWO_PICKED_TIP;
    return undefined;
  };
  return { selected, isSelected, toggle, clear, blockedReason };
};

/** The checkbox column (no select-all: at most two runs compare). */
export const runSelectColumn = <T extends Pickable>(
  sel: RunSelection<T>
): EuiBasicTableColumn<T> => ({
  name: '',
  width: '32px',
  render: (r: T) => {
    const reason = sel.blockedReason(r);
    const box = (
      <EuiCheckbox
        id={`agtEvlSelect-${r.runId}`}
        checked={sel.isSelected(r)}
        disabled={!!reason}
        onChange={() => sel.toggle(r)}
        aria-label={i18n.translate('agentTraces.evals.runSelection.select', {
          defaultMessage: 'Select run {run}',
          values: { run: runLabel(r) },
        })}
        data-test-subj={`agtEvlSelectRun-${r.runId}`}
      />
    );
    // Clicks on the checkbox (and its tooltip anchor) do not reach the row, which opens the run.
    return (
      <span onClick={(e) => e.stopPropagation()} role="presentation">
        {reason ? <EuiToolTip content={reason}>{box}</EuiToolTip> : box}
      </span>
    );
  },
});

/** The table toolbar's bulk action: "Compare 2 runs" (older run as A) and Clear. */
export const CompareSelectionBar = <T extends Pickable>({
  sel,
  onCompare,
}: {
  sel: RunSelection<T>;
  onCompare: (runA: string, runB: string) => void;
}) => {
  const n = sel.selected.length;
  const hint =
    n === 0
      ? i18n.translate('agentTraces.evals.runSelection.selectTwo', {
          defaultMessage: 'Select two runs to compare',
        })
      : n === 1
        ? i18n.translate('agentTraces.evals.runSelection.selectOneMore', {
            defaultMessage: 'Select one more run of {run}',
            values: { run: sel.selected[0].suite ?? runLabel(sel.selected[0]) },
          })
        : '';
  return (
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap={false}>
      {hint && (
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued" data-test-subj="agtEvlCompareHint">
            {hint}
          </EuiText>
        </EuiFlexItem>
      )}
      {n > 0 && (
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty size="s" onClick={sel.clear} data-test-subj="agtEvlCompareClear">
            {i18n.translate('agentTraces.evals.runSelection.clear', { defaultMessage: 'Clear' })}
          </EuiButtonEmpty>
        </EuiFlexItem>
      )}
      <EuiFlexItem grow={false}>
        <EuiButton
          size="s"
          iconType="merge"
          fill={n === 2}
          isDisabled={n !== 2}
          onClick={() => {
            const [runA, runB] = compareOrder(sel.selected);
            onCompare(runA, runB);
          }}
          data-test-subj="agtEvlCompareButton"
        >
          {i18n.translate('agentTraces.evals.runSelection.compare', {
            defaultMessage: 'Compare 2 runs',
          })}
        </EuiButton>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

/**
 * A run's cell: its name (else its short id) as a link to the run, the short id under a name,
 * and the description (when there is one) in a tooltip.
 */
export const RunNameCell: React.FC<{
  run: Pick<RunRow, 'runId'> & { name?: string; description?: string };
  onOpen: () => void;
  testId?: string;
}> = ({ run, onOpen, testId }) => {
  const link = (
    <EuiLink
      className={run.name ? undefined : 'agtEvlMono'}
      title={run.description ? undefined : run.runId}
      onClick={onOpen}
      data-test-subj={testId}
    >
      {runLabel(run)}
    </EuiLink>
  );
  return (
    <div>
      {run.description ? (
        <EuiToolTip content={run.description} title={run.name}>
          {link}
        </EuiToolTip>
      ) : (
        link
      )}
      {run.name && (
        <div className="agtEvlMono agtEvlDim" title={run.runId}>
          <small>{shortId(run.runId)}</small>
        </div>
      )}
    </div>
  );
};
