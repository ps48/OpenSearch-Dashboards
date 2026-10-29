/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiCallOut,
  EuiCodeBlock,
  EuiComboBox,
  EuiComboBoxOptionOption,
  EuiForm,
  EuiFormRow,
  EuiLink,
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiOverlayMask,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import { EVALS_RULES_SETTING } from '../../../common';
import {
  DatasetRef,
  EVALS_DATASET_DISPLAY_NAME,
  EVALS_DATASET_TIME_FIELD,
  EVALS_DATASET_TITLE,
  EVALS_SCHEMA_MAPPINGS,
  EvalsDatasetConfig,
  datasetLabel,
  isPplSafeIndex,
  listDatasets,
  saveEvalsCorrelation,
} from './eval_dataset';
import { errorMessage } from './use_eval_data';
import type { EvaluationsServices } from '.';

type Option = EuiComboBoxOptionOption<DatasetRef>;

const toOption = (d: DatasetRef): Option => ({ label: datasetLabel(d), value: d });

/** An index pattern over the evaluation events, whatever its exact wildcard. */
export const looksLikeEvalsDataset = (d: DatasetRef) => /genai-evaluation/.test(d.title);

/** The pass rules setting as shown in the modal: pretty JSON, `{}` when unset or invalid. */
export const rulesText = (value: unknown): string => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : (value ?? {});
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value);
  }
};

const MODAL_TITLE = i18n.translate('agentTraces.evalsSettings.title', {
  defaultMessage: 'Agent evaluations settings',
});

/**
 * Agent Evaluations settings, styled like the APM settings: the traces dataset and the
 * evaluations dataset (a logs dataset over the evaluation events), saved as a
 * `trace-to-evaluations-*` correlation; the pass rules setting, read-only.
 */
export const EvalSettingsModal: React.FC<{
  config?: EvalsDatasetConfig;
  onClose: (saved?: boolean) => void;
}> = ({ config, onClose }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const client = services.savedObjects.client;
  const [traces, setTraces] = useState<DatasetRef[]>([]);
  const [logs, setLogs] = useState<DatasetRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [selectedTraces, setSelectedTraces] = useState<DatasetRef | undefined>(
    config?.tracesDataset
  );
  const [selectedEvals, setSelectedEvals] = useState<DatasetRef | undefined>(
    config?.evaluationsDataset
  );
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const [t, l] = await Promise.all([
        listDatasets(client, 'traces'),
        listDatasets(client, 'logs'),
      ]);
      setTraces(t);
      setLogs(l);
      // Defaults: the traces dataset Agent Traces opens on (the first traces dataset), and
      // an existing dataset over the evaluation events.
      setSelectedTraces((current) => current ?? t[0]);
      setSelectedEvals((current) => current ?? l.find(looksLikeEvalsDataset));
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const hasEvalsDataset = logs.some(looksLikeEvalsDataset);

  const createDataset = async () => {
    setCreating(true);
    try {
      const pattern = await services.data.indexPatterns.createAndSave({
        title: EVALS_DATASET_TITLE,
        timeFieldName: EVALS_DATASET_TIME_FIELD,
        signalType: 'logs',
        displayName: EVALS_DATASET_DISPLAY_NAME,
        schemaMappings: EVALS_SCHEMA_MAPPINGS,
      });
      const created: DatasetRef = {
        id: pattern.id as string,
        title: EVALS_DATASET_TITLE,
        displayName: EVALS_DATASET_DISPLAY_NAME,
        signalType: 'logs',
        timeFieldName: EVALS_DATASET_TIME_FIELD,
      };
      setLogs((l) => [...l, created]);
      setSelectedEvals(created);
      services.notifications.toasts.addSuccess(
        i18n.translate('agentTraces.evalsSettings.created', {
          defaultMessage: 'Created the evaluations dataset {title}',
          values: { title: EVALS_DATASET_TITLE },
        })
      );
    } catch (e) {
      services.notifications.toasts.addDanger({
        title: i18n.translate('agentTraces.evalsSettings.createError', {
          defaultMessage: 'Could not create the evaluations dataset',
        }),
        text: errorMessage(e),
      });
    } finally {
      setCreating(false);
    }
  };

  const evalsInvalid = !!selectedEvals && !isPplSafeIndex(selectedEvals.title);
  const errors = {
    traces: !selectedTraces
      ? [
          i18n.translate('agentTraces.evalsSettings.tracesRequired', {
            defaultMessage: 'Select a traces dataset',
          }),
        ]
      : [],
    evals: !selectedEvals
      ? [
          i18n.translate('agentTraces.evalsSettings.evalsRequired', {
            defaultMessage: 'Select or create an evaluations dataset',
          }),
        ]
      : evalsInvalid
        ? [
            i18n.translate('agentTraces.evalsSettings.evalsInvalid', {
              defaultMessage: 'The index pattern must not contain spaces, quotes or |',
            }),
          ]
        : [],
  };

  const save = async () => {
    if (!selectedTraces || !selectedEvals || evalsInvalid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await saveEvalsCorrelation(client, selectedTraces, selectedEvals, config?.correlationId);
      services.notifications.toasts.addSuccess(
        i18n.translate('agentTraces.evalsSettings.saved', {
          defaultMessage: 'Agent evaluations settings saved',
        })
      );
      onClose(true);
    } catch (e) {
      services.notifications.toasts.addDanger({
        title: i18n.translate('agentTraces.evalsSettings.saveError', {
          defaultMessage: 'Could not save the settings',
        }),
        text: errorMessage(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const rules = useMemo(() => {
    try {
      return rulesText(services.uiSettings.get(EVALS_RULES_SETTING));
    } catch {
      return '{}';
    }
  }, [services.uiSettings]);
  const advancedSettingsHref = services.application.getUrlForApp('management', {
    path: `opensearch-dashboards/settings?query=${encodeURIComponent(EVALS_RULES_SETTING)}`,
  });

  const refreshButton = (
    <EuiButtonIcon
      iconType="refresh"
      onClick={load}
      isDisabled={loading}
      aria-label={i18n.translate('agentTraces.evalsSettings.refresh', {
        defaultMessage: 'Refresh datasets',
      })}
    />
  );

  return (
    <EuiOverlayMask>
      <EuiModal
        onClose={() => onClose()}
        style={{ width: 700, maxWidth: '90vw' }}
        data-test-subj="agtEvlSettingsModal"
      >
        <EuiModalHeader>
          <EuiModalHeaderTitle>{MODAL_TITLE}</EuiModalHeaderTitle>
        </EuiModalHeader>
        <EuiModalBody>
          <EuiText size="xs" color="subdued">
            <p>
              <FormattedMessage
                id="agentTraces.evalsSettings.intro"
                defaultMessage="Evaluation results are OpenTelemetry log events ({event}) that judge your agents' spans, traces and sessions. Select the logs dataset that holds them and the traces dataset they judge. The two are saved as a correlation, so the trace details flyout lists a trace's evaluation events with its logs, and Explore Logs can query them with PPL."
                values={{ event: <code>gen_ai.evaluation.result</code> }}
              />
            </p>
          </EuiText>
          <EuiSpacer size="m" />
          {config && !showErrors && (
            <>
              <EuiCallOut
                size="s"
                color="success"
                iconType="check"
                title={i18n.translate('agentTraces.evalsSettings.active', {
                  defaultMessage: 'Active configuration exists',
                })}
                data-test-subj="agtEvlSettingsActive"
              >
                <p>
                  {i18n.translate('agentTraces.evalsSettings.activeText', {
                    defaultMessage:
                      'Agent Evaluations reads {evals}. Change the datasets below and select Update.',
                    values: { evals: datasetLabel(config.evaluationsDataset) },
                  })}
                </p>
              </EuiCallOut>
              <EuiSpacer size="m" />
            </>
          )}
          {loadError && (
            <>
              <EuiCallOut
                size="s"
                color="danger"
                iconType="alert"
                title={i18n.translate('agentTraces.evalsSettings.loadError', {
                  defaultMessage: 'Could not list the datasets',
                })}
              >
                <p>{loadError}</p>
              </EuiCallOut>
              <EuiSpacer size="m" />
            </>
          )}
          <EuiForm component="form" isInvalid={showErrors}>
            <EuiFormRow
              label={i18n.translate('agentTraces.evalsSettings.traces', {
                defaultMessage: 'Traces dataset',
              })}
              helpText={i18n.translate('agentTraces.evalsSettings.tracesHelp', {
                defaultMessage:
                  'The agent spans the evaluations judge, joined on trace and span id.',
              })}
              isInvalid={showErrors && errors.traces.length > 0}
              error={errors.traces}
              fullWidth
            >
              <EuiComboBox<DatasetRef>
                compressed
                fullWidth
                singleSelection={{ asPlainText: true }}
                isLoading={loading}
                options={traces.map(toOption)}
                selectedOptions={selectedTraces ? [toOption(selectedTraces)] : []}
                onChange={(selected) => setSelectedTraces(selected[0]?.value)}
                append={refreshButton}
                isInvalid={showErrors && errors.traces.length > 0}
                data-test-subj="agtEvlSettingsTraces"
              />
            </EuiFormRow>
            <EuiFormRow
              label={i18n.translate('agentTraces.evalsSettings.evals', {
                defaultMessage: 'Evaluations dataset',
              })}
              helpText={
                <FormattedMessage
                  id="agentTraces.evalsSettings.evalsHelp"
                  defaultMessage="A logs dataset over the evaluation events, {pattern} with time field {time} by default."
                  values={{
                    pattern: <code>{EVALS_DATASET_TITLE}</code>,
                    time: <code>{EVALS_DATASET_TIME_FIELD}</code>,
                  }}
                />
              }
              isInvalid={showErrors && errors.evals.length > 0}
              error={errors.evals}
              fullWidth
            >
              <EuiComboBox<DatasetRef>
                compressed
                fullWidth
                singleSelection={{ asPlainText: true }}
                isLoading={loading || creating}
                options={logs.map(toOption)}
                selectedOptions={selectedEvals ? [toOption(selectedEvals)] : []}
                onChange={(selected) => setSelectedEvals(selected[0]?.value)}
                append={refreshButton}
                isInvalid={showErrors && errors.evals.length > 0}
                data-test-subj="agtEvlSettingsEvals"
              />
            </EuiFormRow>
            {!loading && !hasEvalsDataset && (
              <>
                <EuiSpacer size="s" />
                <EuiCallOut
                  size="s"
                  iconType="iInCircle"
                  title={i18n.translate('agentTraces.evalsSettings.noDataset', {
                    defaultMessage: 'No evaluations dataset yet',
                  })}
                  data-test-subj="agtEvlSettingsNoDataset"
                >
                  <p>
                    <FormattedMessage
                      id="agentTraces.evalsSettings.noDatasetText"
                      defaultMessage="Create a logs dataset over {pattern} (time field {time}, trace and span ids mapped for correlation)."
                      values={{
                        pattern: <code>{EVALS_DATASET_TITLE}</code>,
                        time: <code>{EVALS_DATASET_TIME_FIELD}</code>,
                      }}
                    />
                  </p>
                  <EuiButton
                    size="s"
                    iconType="plusInCircle"
                    onClick={createDataset}
                    isLoading={creating}
                    data-test-subj="agtEvlSettingsCreateDataset"
                  >
                    {i18n.translate('agentTraces.evalsSettings.create', {
                      defaultMessage: 'Create evaluations dataset',
                    })}
                  </EuiButton>
                </EuiCallOut>
              </>
            )}
            <EuiSpacer size="m" />
            <EuiFormRow
              label={i18n.translate('agentTraces.evalsSettings.rules', {
                defaultMessage: 'Pass rules',
              })}
              helpText={
                <FormattedMessage
                  id="agentTraces.evalsSettings.rulesHelp"
                  defaultMessage="Read only here. Edit {setting} in {link}."
                  values={{
                    setting: <code>{EVALS_RULES_SETTING}</code>,
                    link: (
                      <EuiLink href={advancedSettingsHref} data-test-subj="agtEvlSettingsRulesLink">
                        {i18n.translate('agentTraces.evalsSettings.advancedSettings', {
                          defaultMessage: 'Advanced settings',
                        })}
                      </EuiLink>
                    ),
                  }}
                />
              }
              fullWidth
            >
              <EuiCodeBlock
                language="json"
                fontSize="s"
                paddingSize="s"
                overflowHeight={160}
                isCopyable
                data-test-subj="agtEvlSettingsRules"
              >
                {rules}
              </EuiCodeBlock>
            </EuiFormRow>
          </EuiForm>
        </EuiModalBody>
        <EuiModalFooter>
          <EuiButtonEmpty onClick={() => onClose()} data-test-subj="agtEvlSettingsCancel">
            {i18n.translate('agentTraces.evalsSettings.cancel', { defaultMessage: 'Cancel' })}
          </EuiButtonEmpty>
          <EuiButton
            fill
            onClick={save}
            isLoading={saving}
            isDisabled={loading}
            data-test-subj="agtEvlSettingsSave"
          >
            {config
              ? i18n.translate('agentTraces.evalsSettings.update', { defaultMessage: 'Update' })
              : i18n.translate('agentTraces.evalsSettings.save', { defaultMessage: 'Save' })}
          </EuiButton>
        </EuiModalFooter>
      </EuiModal>
    </EuiOverlayMask>
  );
};
