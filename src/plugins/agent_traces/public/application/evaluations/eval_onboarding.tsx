/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLink,
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiOverlayMask,
  EuiPanel,
  EuiSpacer,
  EuiStepsHorizontal,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useOpenSearchDashboards } from '../../../../opensearch_dashboards_react/public';
import type { EvaluationsServices } from '.';

// ---------------------------------------------------------------------------------------
// Links, snippets and screenshots shared by Getting started, the setup and the empty screen
// ---------------------------------------------------------------------------------------

export const SDK_PY_URL = 'https://github.com/opensearch-project/genai-observability-sdk-py';
export const SDK_TS_URL = 'https://github.com/opensearch-project/genai-observability-sdk-ts';
export const SDK_PY_EVALS_DOC_URL = `${SDK_PY_URL}/blob/main/docs/agent-evaluations.md`;
export const SDK_TS_EVALS_DOC_URL = `${SDK_TS_URL}/blob/main/docs/agent-evaluations.md`;
export const DATA_PREPPER_URL = 'https://opensearch.org/docs/latest/data-prepper/';

export const ONLINE_SNIPPET = `from opensearch_genai_observability_sdk_py import score

# Grade a production trace: an LLM judge, a code check or user feedback.
score("helpfulness", 4.0, trace_id=trace_id, score_min=1, score_max=5,
      threshold=4, explanation="Answered with the tool results")`;

export const OFFLINE_SNIPPET = `from opensearch_genai_observability_sdk_py import evaluate, register

register(service_name="travel-agent", agent_name="travel_planner", agent_version="v3")

# Run a test suite: one trace per case, one result per case and scorer.
evaluate(name="travel-capitals", task=travel_planner,
         data=[{"input": "Capital of France?", "expected": "Paris", "case_id": "fr"}],
         scores=[exact_match, answer_quality])`;

export const DATA_PREPPER_SNIPPET = `genai-evaluation-pipeline:
  source:
    pipeline:
      name: "otlp-pipeline"   # route eventName == "gen_ai.evaluation.result" here
  processor:
    - copy_values:
        entries:
          - from_key: "time"
            to_key: "@timestamp"
  sink:
    - opensearch:
        hosts: ["https://opensearch:9200"]
        index_type: genai-evaluation-plain  # experimental`;

export type EvalScreenshot = 'agents_home' | 'agent_page' | 'compare_runs' | 'agent_traces';

/** A product screenshot served from the plugin's assets. */
export const useScreenshot = () => {
  const { services } = useOpenSearchDashboards<Partial<EvaluationsServices>>();
  return (name: EvalScreenshot) =>
    services?.http?.basePath.prepend(`/plugins/agentTraces/assets/evaluations/${name}.webp`) ??
    `/plugins/agentTraces/assets/evaluations/${name}.webp`;
};

export const Screenshot: React.FC<{ name: EvalScreenshot; alt: string }> = ({ name, alt }) => {
  const src = useScreenshot();
  return (
    <img
      src={src(name)}
      alt={alt}
      className="agtEvlShot"
      loading="lazy"
      data-test-subj={`agtEvlShot-${name}`}
    />
  );
};

export const SdkLinks: React.FC = () => (
  <EuiText size="xs">
    <p>
      <EuiLink href={SDK_PY_EVALS_DOC_URL} target="_blank" external data-test-subj="agtEvlSdkPy">
        {i18n.translate('agentTraces.evalsOnboarding.sdkPy', {
          defaultMessage: 'Python SDK: agent evaluations',
        })}
      </EuiLink>
      {' · '}
      <EuiLink href={SDK_TS_EVALS_DOC_URL} target="_blank" external data-test-subj="agtEvlSdkTs">
        {i18n.translate('agentTraces.evalsOnboarding.sdkTs', {
          defaultMessage: 'TypeScript SDK: agent evaluations',
        })}
      </EuiLink>
    </p>
  </EuiText>
);

// ---------------------------------------------------------------------------------------
// Online and offline evaluations, side by side
// ---------------------------------------------------------------------------------------

const ONLINE = {
  title: i18n.translate('agentTraces.evalsOnboarding.onlineTitle', {
    defaultMessage: 'Online evaluations',
  }),
  tagline: i18n.translate('agentTraces.evalsOnboarding.onlineTagline', {
    defaultMessage: 'Grade live traffic as it happens',
  }),
  points: [
    i18n.translate('agentTraces.evalsOnboarding.online1', {
      defaultMessage:
        'Evaluators score production spans, traces and sessions: an LLM judge, a code check or user feedback.',
    }),
    i18n.translate('agentTraces.evalsOnboarding.online2', {
      defaultMessage:
        'Watch the pass rate of each agent version over time, and compare two versions running side by side.',
    }),
    i18n.translate('agentTraces.evalsOnboarding.online3', {
      defaultMessage: 'Find the traces where an evaluation failed, right in Agent Traces.',
    }),
  ],
};

const OFFLINE = {
  title: i18n.translate('agentTraces.evalsOnboarding.offlineTitle', {
    defaultMessage: 'Offline evaluations',
  }),
  tagline: i18n.translate('agentTraces.evalsOnboarding.offlineTagline', {
    defaultMessage: 'Test a version before you ship it',
  }),
  points: [
    i18n.translate('agentTraces.evalsOnboarding.offline1', {
      defaultMessage:
        'Run a test suite (cases with inputs and expected outputs) against an agent version, in CI or a notebook.',
    }),
    i18n.translate('agentTraces.evalsOnboarding.offline2', {
      defaultMessage: 'Each run lists its cases: which passed, which failed and why.',
    }),
    i18n.translate('agentTraces.evalsOnboarding.offline3', {
      defaultMessage:
        'Compare two runs to see the cases that regressed or got fixed, with both traces side by side.',
    }),
  ],
};

const ModeCard: React.FC<{ mode: typeof ONLINE; icon: string; testId: string }> = ({
  mode,
  icon,
  testId,
}) => (
  <EuiPanel hasBorder hasShadow={false} paddingSize="m" data-test-subj={testId}>
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false}>
        <EuiIcon type={icon} size="l" color="primary" />
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiTitle size="xs">
          <h3>{mode.title}</h3>
        </EuiTitle>
        <EuiText size="xs" color="subdued">
          {mode.tagline}
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
    <EuiSpacer size="s" />
    <EuiText size="s">
      <ul>
        {mode.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </EuiText>
  </EuiPanel>
);

/** Online and offline evaluations, what each is for, side by side. */
export const OnlineOfflineCards: React.FC = () => (
  <EuiFlexGroup gutterSize="m" data-test-subj="agtEvlOnlineOffline">
    <EuiFlexItem>
      <ModeCard mode={ONLINE} icon="visLine" testId="agtEvlOnlineCard" />
    </EuiFlexItem>
    <EuiFlexItem>
      <ModeCard mode={OFFLINE} icon="beaker" testId="agtEvlOfflineCard" />
    </EuiFlexItem>
  </EuiFlexGroup>
);

// ---------------------------------------------------------------------------------------
// Getting started: a short tour, one screen per step
// ---------------------------------------------------------------------------------------

interface TourScreen {
  id: string;
  /** The step's short label. */
  step: string;
  title: string;
  body: React.ReactNode;
}

const TOUR_SCREENS: TourScreen[] = [
  {
    id: 'what',
    step: i18n.translate('agentTraces.evalsTour.step_what', { defaultMessage: 'Overview' }),
    title: i18n.translate('agentTraces.evalsTour.whatTitle', {
      defaultMessage: 'Measure how well your agents do their job',
    }),
    body: (
      <>
        <EuiText size="s">
          <p>
            {i18n.translate('agentTraces.evalsTour.whatBody', {
              defaultMessage:
                'An evaluation result is a verdict on one piece of your agent’s work: a single LLM or tool call (a span), a whole request (a trace) or a conversation (a session). Results are OpenTelemetry log events (gen_ai.evaluation.result) stored next to your traces, so every verdict links to the work it judged. Your code or the judge decides pass or fail; Dashboards shows the verdict it was given.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="m" />
        <OnlineOfflineCards />
      </>
    ),
  },
  {
    id: 'online',
    step: i18n.translate('agentTraces.evalsTour.step_online', { defaultMessage: 'Online' }),
    title: ONLINE.title,
    body: (
      <>
        <EuiText size="s">
          <p>
            {i18n.translate('agentTraces.evalsTour.onlineBody', {
              defaultMessage:
                'Score live traffic with score(). The Agents page shows one row per agent version with its pass rate; open an agent to see the pass rate over time per version, compare two versions evaluation by evaluation, and drill into the failing results.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable>
          {ONLINE_SNIPPET}
        </EuiCodeBlock>
        <EuiSpacer size="s" />
        <Screenshot
          name="agent_page"
          alt={i18n.translate('agentTraces.evalsTour.agentPageAlt', {
            defaultMessage: 'An agent page: pass rate over time per version and evaluations',
          })}
        />
      </>
    ),
  },
  {
    id: 'offline',
    step: i18n.translate('agentTraces.evalsTour.step_offline', { defaultMessage: 'Offline' }),
    title: OFFLINE.title,
    body: (
      <>
        <EuiText size="s">
          <p>
            {i18n.translate('agentTraces.evalsTour.offlineBody', {
              defaultMessage:
                'Run a test suite with evaluate(). Each run is tagged with the suite, the run and the case (test.suite.name, test.suite.run.id, test.case.id). Open a suite to see its runs, open a run to see its cases, and compare two runs to find what regressed.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable>
          {OFFLINE_SNIPPET}
        </EuiCodeBlock>
        <EuiSpacer size="s" />
        <Screenshot
          name="compare_runs"
          alt={i18n.translate('agentTraces.evalsTour.compareAlt', {
            defaultMessage: 'Compare two runs: regressed cases with both outputs side by side',
          })}
        />
      </>
    ),
  },
  {
    id: 'traces',
    step: i18n.translate('agentTraces.evalsTour.step_traces', { defaultMessage: 'Traces' }),
    title: i18n.translate('agentTraces.evalsTour.tracesTitle', {
      defaultMessage: 'Debug with your traces',
    }),
    body: (
      <>
        <EuiText size="s">
          <p>
            {i18n.translate('agentTraces.evalsTour.tracesBody', {
              defaultMessage:
                'Every result links to what it judged. In Agent Traces, the Evaluations column counts each trace’s results and the trace flyout marks the judged spans; the session view lists a session’s own results. A result’s flyout shows what the judge saw and, when the judge is traced, its own prompt and response.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <Screenshot
          name="agent_traces"
          alt={i18n.translate('agentTraces.evalsTour.tracesAlt', {
            defaultMessage: 'Agent Traces with the Evaluations column',
          })}
        />
      </>
    ),
  },
  {
    id: 'send',
    step: i18n.translate('agentTraces.evalsTour.step_send', { defaultMessage: 'Send results' }),
    title: i18n.translate('agentTraces.evalsTour.sendTitle', {
      defaultMessage: 'Send your results',
    }),
    body: (
      <>
        <EuiText size="s">
          <p>
            {i18n.translate('agentTraces.evalsTour.sendBody', {
              defaultMessage:
                'The OpenSearch GenAI observability SDKs (Python and TypeScript) emit the results with the right attributes. Any OpenTelemetry producer works too. Route the events to their own index with Data Prepper, then select that index in Settings.',
            })}
          </p>
        </EuiText>
        <EuiSpacer size="s" />
        <SdkLinks />
        <EuiSpacer size="s" />
        <EuiCodeBlock language="yaml" fontSize="s" paddingSize="s" isCopyable>
          {DATA_PREPPER_SNIPPET}
        </EuiCodeBlock>
      </>
    ),
  },
];

/**
 * Getting started: what evaluations are, online and offline evaluations, debugging with
 * traces, and how to send results. `onSetUp`: offered on the last screen when nothing is set up.
 */
export const GettingStartedModal: React.FC<{
  onClose: () => void;
  onSetUp?: () => void;
}> = ({ onClose, onSetUp }) => {
  const [step, setStep] = useState(0);
  const screen = TOUR_SCREENS[step];
  const last = step === TOUR_SCREENS.length - 1;
  return (
    <EuiOverlayMask>
      <EuiModal
        onClose={onClose}
        style={{ width: 880, maxWidth: '92vw' }}
        data-test-subj="agtEvlGettingStarted"
      >
        <EuiModalHeader>
          <EuiModalHeaderTitle>
            {i18n.translate('agentTraces.evalsTour.title', {
              defaultMessage: 'Getting started with Agent Evaluations',
            })}
          </EuiModalHeaderTitle>
        </EuiModalHeader>
        <EuiModalBody>
          <EuiStepsHorizontal
            steps={TOUR_SCREENS.map((s, i) => ({
              title: s.step,
              status: i < step ? 'complete' : i === step ? 'current' : 'incomplete',
              onClick: () => setStep(i),
              'data-test-subj': `agtEvlTourStep-${s.id}`,
            }))}
          />
          <EuiSpacer size="m" />
          <EuiTitle size="s">
            <h2 data-test-subj="agtEvlTourTitle">{screen.title}</h2>
          </EuiTitle>
          <EuiSpacer size="s" />
          <div data-test-subj={`agtEvlTourScreen-${screen.id}`}>{screen.body}</div>
        </EuiModalBody>
        <EuiModalFooter>
          <EuiButtonEmpty size="s" onClick={onClose} data-test-subj="agtEvlTourClose">
            {i18n.translate('agentTraces.evalsTour.close', { defaultMessage: 'Close' })}
          </EuiButtonEmpty>
          {step > 0 && (
            <EuiButton size="s" onClick={() => setStep(step - 1)} data-test-subj="agtEvlTourBack">
              {i18n.translate('agentTraces.evalsTour.back', { defaultMessage: 'Back' })}
            </EuiButton>
          )}
          {!last ? (
            <EuiButton
              size="s"
              fill
              onClick={() => setStep(step + 1)}
              data-test-subj="agtEvlTourNext"
            >
              {i18n.translate('agentTraces.evalsTour.next', { defaultMessage: 'Next' })}
            </EuiButton>
          ) : onSetUp ? (
            <EuiButton
              size="s"
              fill
              iconType="gear"
              onClick={() => {
                onClose();
                onSetUp();
              }}
              data-test-subj="agtEvlTourSetUp"
            >
              {i18n.translate('agentTraces.evalsTour.setUp', {
                defaultMessage: 'Set up evaluations',
              })}
            </EuiButton>
          ) : (
            <EuiButton size="s" fill onClick={onClose} data-test-subj="agtEvlTourDone">
              {i18n.translate('agentTraces.evalsTour.done', { defaultMessage: 'Done' })}
            </EuiButton>
          )}
        </EuiModalFooter>
      </EuiModal>
    </EuiOverlayMask>
  );
};
