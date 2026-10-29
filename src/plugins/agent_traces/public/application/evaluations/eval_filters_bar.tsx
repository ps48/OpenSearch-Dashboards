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
import { EvalOutcome, LEVEL_LABEL, SOURCE_LABEL } from './eval_data';
import { EvalAppState, hasActiveFilters } from './eval_url_state';
import { Facet } from './use_eval_data';
import { OUTCOME_TEXT, levelLabel, shortId, sourceLabel } from './eval_components';

const VERDICT_OPTIONS: Array<EuiComboBoxOptionOption<string>> = (
  ['fail', 'pass', 'error', 'neutral'] as EvalOutcome[]
).map((o) => ({ label: OUTCOME_TEXT[o], value: o }));

type Patch = Partial<EvalAppState>;

/** Options from the data plus the known values and the current selection, deduplicated. */
const optionsFor = (
  values: string[],
  counts: Map<string, number>,
  label: (v: string) => string
): Array<EuiComboBoxOptionOption<string>> =>
  Array.from(new Set(values))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
    .map((value) => ({
      label: counts.has(value) ? `${label(value)} (${counts.get(value)})` : label(value),
      value,
    }));

const countBy = (facets: Facet[], key: keyof Pick<Facet, 'name' | 'level' | 'source'>) => {
  const counts = new Map<string, number>();
  facets.forEach((f) => counts.set(f[key], (counts.get(f[key]) ?? 0) + f.count));
  return counts;
};

const selected = (
  options: Array<EuiComboBoxOptionOption<string>>,
  values: string[]
): Array<EuiComboBoxOptionOption<string>> =>
  values.map((v) => options.find((o) => o.value === v) ?? { label: v, value: v });

export const EvalFiltersBar: React.FC<{
  state: EvalAppState;
  facets: Facet[];
  onChange: (patch: Patch) => void;
}> = ({ state, facets, onChange }) => {
  const [search, setSearch] = useState(state.q);
  useEffect(() => setSearch(state.q), [state.q]);

  const { nameOptions, levelOptions, sourceOptions } = useMemo(() => {
    const names = countBy(facets, 'name');
    const levels = countBy(facets, 'level');
    const sources = countBy(facets, 'source');
    return {
      nameOptions: optionsFor([...names.keys(), ...state.names], names, (v) => v),
      levelOptions: optionsFor(
        [...Object.keys(LEVEL_LABEL), ...levels.keys(), ...state.levels].filter(Boolean),
        levels,
        levelLabel
      ),
      sourceOptions: optionsFor(
        [...Object.keys(SOURCE_LABEL), ...sources.keys(), ...state.sources].filter(Boolean),
        sources,
        sourceLabel
      ),
    };
  }, [facets, state.names, state.levels, state.sources]);

  const values = (options: Array<EuiComboBoxOptionOption<string>>) =>
    options.map((o) => o.value ?? o.label);

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
          options={VERDICT_OPTIONS}
          selectedOptions={selected(VERDICT_OPTIONS, state.verdicts)}
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
