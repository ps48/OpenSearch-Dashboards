/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCodeBlock,
  EuiComboBox,
  EuiDescriptionList,
  EuiCompressedFormRow,
  EuiLoadingContent,
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiOverlayMask,
  EuiSpacer,
  EuiStepsHorizontal,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import {
  DataSourceRef,
  DatasetRef,
  EVALS_DATASET_TIME_FIELD,
  EVALS_DATASET_TITLE,
  datasetLabel,
  defaultEvalsDatasets,
  listDatasets,
  saveEvalsConfig,
  sortDatasets,
} from './eval_dataset';
import {
  agentTracesDatasetId,
  countEvaluationResults,
  createEvalsDataset,
  toOption,
} from './eval_settings_modal';
import { errorMessage } from './use_ppl_rows';
import {
  DATA_PREPPER_SNIPPET,
  OFFLINE_SNIPPET,
  ONLINE_SNIPPET,
  OnlineOfflineCards,
  SdkLinks,
} from './eval_onboarding';
import type { EvaluationsServices } from '.';

/** What the setup found: datasets, and whether the evaluation indices hold results. */
export interface EvalsDetection {
  traces: DatasetRef[];
  logs: DatasetRef[];
  /** An existing logs dataset over the evaluation events. */
  evaluationsDataset?: DatasetRef;
  /** The traces dataset to propose (Agent Traces' one, else the first). */
  tracesDataset?: DatasetRef;
  /** Results in the evaluation indices (any time); undefined: no such index. */
  results?: number;
  /** The data source the results were counted on (undefined: local). */
  resultsDataSource?: DataSourceRef;
}

export { countEvaluationResults };

/**
 * Counts the results on each candidate data source in turn and keeps the first that has some,
 * else the first where the index exists. With several data sources the evaluation indices may
 * be on any of them, so one that can't be read (no local cluster, say) only fails the detection
 * when none of the others could be read either.
 */
const countOnDataSources = async (
  services: EvaluationsServices,
  index: string,
  candidates: Array<DataSourceRef | undefined>
): Promise<{ results?: number; dataSource?: DataSourceRef }> => {
  const seen = new Set<string>();
  let exists: { results: number; dataSource?: DataSourceRef } | undefined;
  let failure: unknown;
  let read = false;
  for (const dataSource of candidates) {
    const key = dataSource?.id ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const results = await countEvaluationResults(services, index, dataSource);
      read = true;
      if (results !== undefined && results > 0) return { results, dataSource };
      if (results !== undefined && !exists) exists = { results, dataSource };
    } catch (e) {
      failure = failure ?? e;
    }
  }
  if (exists) return exists;
  if (!read && failure) throw failure;
  return { results: undefined, dataSource: candidates[0] };
};

/** Auto-detect: the workspace's datasets and the evaluation indices' results. */
export const detectEvals = async (services: EvaluationsServices): Promise<EvalsDetection> => {
  const all = await listDatasets(services.savedObjects.client);
  const tracesAll = all.filter((d) => d.signalType === 'traces');
  const logsAll = all.filter((d) => d.signalType === 'logs');
  // The defaults come from the unsorted lists, as Settings picks them (Agent Traces' order).
  const defaults = defaultEvalsDatasets(tracesAll, logsAll, agentTracesDatasetId(services));
  const traces = sortDatasets(tracesAll);
  const logs = sortDatasets(logsAll);
  // No logs dataset over the results, but an index pattern with the evaluations title (made in
  // Dashboards Management, or by an earlier setup): the setup uses it rather than failing to
  // create a duplicate.
  const sameTitle =
    defaults.evaluations ??
    all.find(
      (d) =>
        d.title === EVALS_DATASET_TITLE &&
        (d.dataSource?.id ?? '') === (defaults.traces?.dataSource?.id ?? '')
    );
  const index = sameTitle?.title ?? EVALS_DATASET_TITLE;
  // The results sit on the evaluations dataset's data source when there is one. Else they are
  // looked for next to the spans, then on each data source the workspace's index patterns read:
  // with multiple data sources (as on a workspace without a traces dataset yet) there may be no
  // local cluster to ask, and the first pattern's data source may not hold the results.
  const candidates: Array<DataSourceRef | undefined> = sameTitle
    ? [sameTitle.dataSource]
    : [
        ...(defaults.traces ? [defaults.traces.dataSource] : []),
        ...all.filter((d) => d.dataSource).map((d) => d.dataSource),
      ];
  const { results, dataSource } = await countOnDataSources(
    services,
    index,
    candidates.length ? candidates : [undefined]
  );
  return {
    traces,
    logs,
    evaluationsDataset: sameTitle,
    tracesDataset: defaults.traces,
    results,
    resultsDataSource: dataSource,
  };
};

type StepId = 'overview' | 'evaluations' | 'traces' | 'create';
const STEPS: StepId[] = ['overview', 'evaluations', 'traces', 'create'];

const STEP_TITLE: Record<StepId, string> = {
  overview: i18n.translate('agentTraces.evalsSetup.stepOverview', { defaultMessage: 'Overview' }),
  evaluations: i18n.translate('agentTraces.evalsSetup.stepEvaluations', {
    defaultMessage: 'Evaluation results',
  }),
  traces: i18n.translate('agentTraces.evalsSetup.stepTraces', { defaultMessage: 'Agent traces' }),
  create: i18n.translate('agentTraces.evalsSetup.stepCreate', { defaultMessage: 'Create' }),
};

/**
 * First-time setup, like the APM setup: detects the evaluation results and the agent traces,
 * proposes the datasets, and creates the evaluations dataset and the workspace's settings in
 * one step. With nothing found, it shows how to send results (SDK, Data Prepper).
 */
export const EvalSetupWizard: React.FC<{
  workspaceId?: string;
  configId?: string;
  onClose: (saved?: boolean) => void;
}> = ({ workspaceId, configId, onClose }) => {
  const { services } = useOpenSearchDashboards<EvaluationsServices>();
  const [step, setStep] = useState<StepId>('overview');
  const [detection, setDetection] = useState<EvalsDetection>();
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string>();
  const [traces, setTraces] = useState<DatasetRef>();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  // The dataset this setup created (or found) before a later step failed: a retry uses it.
  const [createdEvals, setCreatedEvals] = useState<DatasetRef>();

  const detect = useCallback(async () => {
    setDetecting(true);
    setDetectError(undefined);
    try {
      const found = await detectEvals(services);
      setDetection(found);
      setTraces((current) => current ?? found.tracesDataset);
    } catch (e) {
      setDetectError(errorMessage(e));
    } finally {
      setDetecting(false);
    }
  }, [services]);

  useEffect(() => {
    detect();
  }, [detect]);

  const index = step === 'overview' ? 0 : STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  const back = () => setStep(STEPS[Math.max(0, index - 1)]);

  const create = async () => {
    if (!traces) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      // The evaluations dataset goes on the data source the results were counted on; with no
      // evaluation index found, next to the spans.
      const evalsDataSource =
        detection?.results !== undefined ? detection.resultsDataSource : traces.dataSource;
      const reusable =
        createdEvals && (createdEvals.dataSource?.id ?? '') === (evalsDataSource?.id ?? '')
          ? createdEvals
          : undefined;
      let evaluations = detection?.evaluationsDataset ?? reusable;
      if (!evaluations) {
        // No index yet (nothing detected): save the pattern without reading its fields.
        evaluations = (
          await createEvalsDataset(services, evalsDataSource, {
            indexExists: detection?.results !== undefined,
          })
        ).dataset;
        setCreatedEvals(evaluations);
      }
      await saveEvalsConfig(services.savedObjects.client, traces, evaluations, {
        existingId: configId,
        workspaceId,
      });
      services.notifications.toasts.addSuccess(
        i18n.translate('agentTraces.evalsSetup.done', {
          defaultMessage: 'Agent Evaluations is set up',
        })
      );
      onClose(true);
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const found = detection?.results !== undefined && detection.results > 0;

  const evaluationsStep = () => {
    if (detecting && !detection) return <EuiLoadingContent lines={4} />;
    if (detectError)
      return (
        <EuiCallOut
          color="danger"
          iconType="alert"
          size="s"
          title={i18n.translate('agentTraces.evalsSetup.detectError', {
            defaultMessage: 'Detection failed',
          })}
        >
          <p>{detectError}</p>
        </EuiCallOut>
      );
    return (
      <>
        {found ? (
          <EuiCallOut
            color="success"
            iconType="check"
            size="s"
            title={i18n.translate('agentTraces.evalsSetup.found', {
              defaultMessage: 'Found {n} evaluation results in {index}',
              values: {
                n: (detection?.results ?? 0).toLocaleString(),
                index: detection?.evaluationsDataset?.title ?? EVALS_DATASET_TITLE,
              },
            })}
            data-test-subj="agtEvlSetupFound"
          >
            <p>
              {detection?.evaluationsDataset
                ? i18n.translate('agentTraces.evalsSetup.foundDataset', {
                    defaultMessage: 'The setup reads them through the dataset {dataset}.',
                    values: { dataset: datasetLabel(detection.evaluationsDataset) },
                  })
                : i18n.translate('agentTraces.evalsSetup.foundNoDataset', {
                    defaultMessage:
                      'The setup creates a logs dataset over {index} to read them (time field {time}).',
                    values: { index: EVALS_DATASET_TITLE, time: EVALS_DATASET_TIME_FIELD },
                  })}
            </p>
          </EuiCallOut>
        ) : (
          <EuiCallOut
            iconType="iInCircle"
            size="s"
            title={i18n.translate('agentTraces.evalsSetup.notFound', {
              defaultMessage: 'No evaluation results yet',
            })}
            data-test-subj="agtEvlSetupNotFound"
          >
            <p>
              <FormattedMessage
                id="agentTraces.evalsSetup.notFoundText"
                defaultMessage="Nothing in {index} yet. Send results with the SDK and route them with Data Prepper, then select Detect again. You can also finish the setup now: the pages fill in as results arrive."
                values={{ index: <code>{EVALS_DATASET_TITLE}</code> }}
              />
            </p>
          </EuiCallOut>
        )}
        {!found && (
          <>
            <EuiSpacer size="m" />
            <EuiText size="s">
              <h4>
                {i18n.translate('agentTraces.evalsSetup.onlineSnippet', {
                  defaultMessage: 'Online: grade live traffic',
                })}
              </h4>
            </EuiText>
            <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable>
              {ONLINE_SNIPPET}
            </EuiCodeBlock>
            <EuiSpacer size="s" />
            <EuiText size="s">
              <h4>
                {i18n.translate('agentTraces.evalsSetup.offlineSnippet', {
                  defaultMessage: 'Offline: run a test suite',
                })}
              </h4>
            </EuiText>
            <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable>
              {OFFLINE_SNIPPET}
            </EuiCodeBlock>
            <EuiSpacer size="s" />
            <EuiText size="s">
              <h4>
                {i18n.translate('agentTraces.evalsSetup.dataPrepper', {
                  defaultMessage: 'Data Prepper: route the results to their index',
                })}
              </h4>
            </EuiText>
            <EuiCodeBlock language="yaml" fontSize="s" paddingSize="s" isCopyable>
              {DATA_PREPPER_SNIPPET}
            </EuiCodeBlock>
            <EuiSpacer size="s" />
            <SdkLinks />
          </>
        )}
        <EuiSpacer size="s" />
        <EuiButtonEmpty
          size="s"
          iconType="refresh"
          onClick={detect}
          isLoading={detecting}
          data-test-subj="agtEvlSetupDetect"
        >
          {i18n.translate('agentTraces.evalsSetup.detect', { defaultMessage: 'Detect again' })}
        </EuiButtonEmpty>
      </>
    );
  };

  const tracesStep = () => (
    <>
      <EuiText size="s">
        <p>
          {i18n.translate('agentTraces.evalsSetup.tracesText', {
            defaultMessage:
              'Results link to the agent spans they judge by trace and span id. Pick the traces dataset that holds your agent spans (the one Agent Traces uses).',
          })}
        </p>
      </EuiText>
      <EuiSpacer size="s" />
      {detection && detection.traces.length === 0 ? (
        <EuiCallOut
          color="warning"
          iconType="alert"
          size="s"
          title={i18n.translate('agentTraces.evalsSetup.noTraces', {
            defaultMessage: 'No traces dataset in this workspace',
          })}
          data-test-subj="agtEvlSetupNoTraces"
        >
          <p>
            {i18n.translate('agentTraces.evalsSetup.noTracesText', {
              defaultMessage:
                'Set up a traces dataset over your span indices (for example in Agent Traces), then select Detect again.',
            })}
          </p>
        </EuiCallOut>
      ) : (
        <EuiCompressedFormRow
          label={i18n.translate('agentTraces.evalsSetup.tracesLabel', {
            defaultMessage: 'Traces dataset',
          })}
          fullWidth
        >
          <EuiComboBox<DatasetRef>
            compressed
            fullWidth
            singleSelection={{ asPlainText: true }}
            isLoading={detecting}
            options={(detection?.traces ?? []).map(toOption)}
            selectedOptions={traces ? [toOption(traces)] : []}
            onChange={(selected) => setTraces(selected[0]?.value)}
            data-test-subj="agtEvlSetupTraces"
          />
        </EuiCompressedFormRow>
      )}
    </>
  );

  const createStep = () => (
    <>
      <EuiDescriptionList
        compressed
        type="column"
        listItems={[
          {
            title: i18n.translate('agentTraces.evalsSetup.reviewEvals', {
              defaultMessage: 'Evaluations dataset',
            }),
            description:
              (detection?.evaluationsDataset ?? createdEvals)
                ? datasetLabel((detection?.evaluationsDataset ?? createdEvals) as DatasetRef)
                : i18n.translate('agentTraces.evalsSetup.reviewCreate', {
                    defaultMessage: 'Create {index} (logs, time field {time})',
                    values: { index: EVALS_DATASET_TITLE, time: EVALS_DATASET_TIME_FIELD },
                  }),
          },
          {
            title: i18n.translate('agentTraces.evalsSetup.reviewTraces', {
              defaultMessage: 'Traces dataset',
            }),
            description: traces ? datasetLabel(traces) : '-',
          },
          {
            title: i18n.translate('agentTraces.evalsSetup.reviewResults', {
              defaultMessage: 'Results found',
            }),
            description: (detection?.results ?? 0).toLocaleString(),
          },
        ]}
        data-test-subj="agtEvlSetupReview"
      />
      {createError && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut
            color="danger"
            iconType="alert"
            size="s"
            title={i18n.translate('agentTraces.evalsSetup.createError', {
              defaultMessage: 'Could not finish the setup',
            })}
            data-test-subj="agtEvlSetupCreateError"
          >
            <p>{createError}</p>
          </EuiCallOut>
        </>
      )}
    </>
  );

  return (
    <EuiOverlayMask>
      <EuiModal
        onClose={() => onClose()}
        style={{ width: 820, maxWidth: '92vw' }}
        data-test-subj="agtEvlSetupWizard"
      >
        <EuiModalHeader>
          <EuiModalHeaderTitle>
            {i18n.translate('agentTraces.evalsSetup.title', {
              defaultMessage: 'Set up Agent Evaluations',
            })}
          </EuiModalHeaderTitle>
        </EuiModalHeader>
        <EuiModalBody>
          <EuiStepsHorizontal
            steps={STEPS.map((s, i) => ({
              title: STEP_TITLE[s],
              status: i < index ? 'complete' : i === index ? 'current' : 'incomplete',
              onClick: () => setStep(s),
              'data-test-subj': `agtEvlSetupStep-${s}`,
            }))}
          />
          <EuiSpacer size="m" />
          <div data-test-subj={`agtEvlSetupScreen-${step}`}>
            {step === 'overview' && (
              <>
                <EuiText size="s">
                  <p>
                    {i18n.translate('agentTraces.evalsSetup.overviewText', {
                      defaultMessage:
                        'Agent Evaluations reads evaluation results (OpenTelemetry gen_ai.evaluation.result log events) and links them to your agent traces. The setup finds both and saves them for this workspace.',
                    })}
                  </p>
                </EuiText>
                <EuiSpacer size="m" />
                <OnlineOfflineCards />
              </>
            )}
            {step === 'evaluations' && evaluationsStep()}
            {step === 'traces' && tracesStep()}
            {step === 'create' && createStep()}
          </div>
        </EuiModalBody>
        <EuiModalFooter>
          <EuiButtonEmpty size="s" onClick={() => onClose()} data-test-subj="agtEvlSetupCancel">
            {i18n.translate('agentTraces.evalsSetup.cancel', { defaultMessage: 'Cancel' })}
          </EuiButtonEmpty>
          {index > 0 && (
            <EuiButton size="s" onClick={back} data-test-subj="agtEvlSetupBack">
              {i18n.translate('agentTraces.evalsSetup.back', { defaultMessage: 'Back' })}
            </EuiButton>
          )}
          {step !== 'create' ? (
            <EuiButton size="s" fill onClick={next} data-test-subj="agtEvlSetupNext">
              {i18n.translate('agentTraces.evalsSetup.next', { defaultMessage: 'Next' })}
            </EuiButton>
          ) : (
            <EuiButton
              size="s"
              fill
              onClick={create}
              isLoading={creating}
              isDisabled={!traces}
              data-test-subj="agtEvlSetupCreate"
            >
              {i18n.translate('agentTraces.evalsSetup.create', {
                defaultMessage: 'Create and open',
              })}
            </EuiButton>
          )}
        </EuiModalFooter>
      </EuiModal>
    </EuiOverlayMask>
  );
};
