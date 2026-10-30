/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButtonEmpty,
  EuiComboBox,
  EuiComboBoxOptionOption,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSwitch,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { EvalOutcome } from './eval_data';
import { EvalAppState, hasActiveFilters } from './eval_url_state';
import { Facet } from './use_eval_data';
import { OUTCOME_TEXT, levelLabel, shortId, sourceLabel } from './eval_components';

/** Verdicts in their usual order: failures first. */
const OUTCOME_ORDER: EvalOutcome[] = ['fail', 'pass', 'error', 'neutral'];

type Patch = Partial<EvalAppState>;
type Option = EuiComboBoxOptionOption<string>;
type FacetKey = keyof Pick<Facet, 'name' | 'level' | 'source' | 'outcome'>;

/**
 * Options from the data of the range (`stats ... by` the field), most results first, each
 * with its count; a selected value the range does not hold stays listed, with 0.
 */
export const optionsFor = (
  counts: Map<string, number>,
  selectedValues: string[],
  label: (v: string) => string,
  order?: (a: string, b: string) => number
): Option[] =>
  Array.from(new Set([...counts.keys(), ...selectedValues]))
    .filter((v) => v !== '')
    .sort(
      (a, b) =>
        (order ? order(a, b) : 0) ||
        (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
        a.localeCompare(b)
    )
    .map((value) => ({ label: `${label(value)} (${counts.get(value) ?? 0})`, value }));

export const countBy = (facets: Facet[], key: FacetKey) => {
  const counts = new Map<string, number>();
  facets.forEach((f) => {
    const v = f[key];
    if (v) counts.set(v, (counts.get(v) ?? 0) + f.count);
  });
  return counts;
};

const selected = (options: Option[], values: string[]): Option[] =>
  values.map((v) => options.find((o) => o.value === v) ?? { label: v, value: v });

const outcomeLabel = (v: string) => OUTCOME_TEXT[v as EvalOutcome] ?? v;
const byOutcomeOrder = (a: string, b: string) =>
  OUTCOME_ORDER.indexOf(a as EvalOutcome) - OUTCOME_ORDER.indexOf(b as EvalOutcome);

export const EvalFiltersBar: React.FC<{
  state: EvalAppState;
  facets: Facet[];
  onChange: (patch: Patch) => void;
}> = ({ state, facets, onChange }) => {
  const [search, setSearch] = useState(state.q);
  useEffect(() => setSearch(state.q), [state.q]);

  // Every option comes from the range's data, with its count; nothing is a fixed list.
  const { nameOptions, levelOptions, sourceOptions, verdictOptions } = useMemo(
    () => ({
      nameOptions: optionsFor(countBy(facets, 'name'), state.names, (v) => v),
      levelOptions: optionsFor(countBy(facets, 'level'), state.levels, levelLabel),
      sourceOptions: optionsFor(countBy(facets, 'source'), state.sources, sourceLabel),
      verdictOptions: optionsFor(
        countBy(facets, 'outcome'),
        state.verdicts,
        outcomeLabel,
        byOutcomeOrder
      ),
    }),
    [facets, state.names, state.levels, state.sources, state.verdicts]
  );

  const values = (options: Option[]) => options.map((o) => o.value ?? o.label);

  return (
    <EuiFlexGroup gutterSize="s" alignItems="center" wrap responsive={false}>
      <EuiFlexItem grow={3} style={{ minWidth: 240 }}>
        <EuiComboBox<string>
          compressed
          fullWidth
          placeholder={i18n.translate('agentTraces.evalsPage.filterNames', {
            defaultMessage: 'All evaluations',
          })}
          aria-label={i18n.translate('agentTraces.evalsPage.filterNamesLabel', {
            defaultMessage: 'Evaluation names',
          })}
          options={nameOptions}
          selectedOptions={selected(nameOptions, state.names)}
          onChange={(options) => onChange({ names: values(options) })}
          data-test-subj="agtEvlFilterNames"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={2} style={{ minWidth: 160 }}>
        <EuiComboBox<string>
          compressed
          fullWidth
          placeholder={i18n.translate('agentTraces.evalsPage.filterLevels', {
            defaultMessage: 'All levels',
          })}
          aria-label={i18n.translate('agentTraces.evalsPage.filterLevelsLabel', {
            defaultMessage: 'Level',
          })}
          options={levelOptions}
          selectedOptions={selected(levelOptions, state.levels)}
          onChange={(options) => onChange({ levels: values(options) })}
          data-test-subj="agtEvlFilterLevels"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={2} style={{ minWidth: 160 }}>
        <EuiComboBox<string>
          compressed
          fullWidth
          placeholder={i18n.translate('agentTraces.evalsPage.filterSources', {
            defaultMessage: 'All sources',
          })}
          aria-label={i18n.translate('agentTraces.evalsPage.filterSourcesLabel', {
            defaultMessage: 'Source',
          })}
          options={sourceOptions}
          selectedOptions={selected(sourceOptions, state.sources)}
          onChange={(options) => onChange({ sources: values(options) })}
          data-test-subj="agtEvlFilterSources"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={2} style={{ minWidth: 150 }}>
        <EuiComboBox<string>
          compressed
          fullWidth
          placeholder={i18n.translate('agentTraces.evalsPage.filterVerdicts', {
            defaultMessage: 'All verdicts',
          })}
          aria-label={i18n.translate('agentTraces.evalsPage.filterVerdictsLabel', {
            defaultMessage: 'Verdict',
          })}
          options={verdictOptions}
          selectedOptions={selected(verdictOptions, state.verdicts)}
          onChange={(options) => onChange({ verdicts: values(options) as EvalOutcome[] })}
          data-test-subj="agtEvlFilterVerdicts"
        />
      </EuiFlexItem>
      {state.runIds.length > 0 && (
        <EuiFlexItem grow={false}>
          <EuiBadge
            color="hollow"
            iconType="cross"
            iconSide="right"
            iconOnClick={() => onChange({ runIds: [] })}
            iconOnClickAriaLabel={i18n.translate('agentTraces.evalsPage.removeRunFilter', {
              defaultMessage: 'Remove the run filter',
            })}
            title={state.runIds.join(', ')}
            data-test-subj="agtEvlRunFilterPill"
          >
            {i18n.translate('agentTraces.evalsPage.runFilter', {
              defaultMessage: 'Run: {runs}',
              values: { runs: state.runIds.map((id) => shortId(id, 28)).join(', ') },
            })}
          </EuiBadge>
        </EuiFlexItem>
      )}
      <EuiFlexItem grow={3} style={{ minWidth: 200 }}>
        <EuiFieldSearch
          compressed
          fullWidth
          value={search}
          placeholder={i18n.translate('agentTraces.evalsPage.search', {
            defaultMessage: 'Search name, label or explanation',
          })}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(value) => onChange({ q: value.trim() })}
          onBlur={() => search.trim() !== state.q && onChange({ q: search.trim() })}
          data-test-subj="agtEvlSearch"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiSwitch
          compressed
          label={i18n.translate('agentTraces.evalsPage.failingOnly', {
            defaultMessage: 'Failing only',
          })}
          checked={state.failing}
          onChange={(e) => onChange({ failing: e.target.checked })}
          data-test-subj="agtEvlFailingOnly"
        />
      </EuiFlexItem>
      {hasActiveFilters(state) && (
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="xs"
            iconType="cross"
            onClick={() =>
              onChange({
                names: [],
                levels: [],
                sources: [],
                failing: false,
                verdicts: [],
                runIds: [],
                q: '',
              })
            }
            data-test-subj="agtEvlClearFilters"
          >
            {i18n.translate('agentTraces.evalsPage.clearFilters', {
              defaultMessage: 'Clear filters',
            })}
          </EuiButtonEmpty>
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );
};
