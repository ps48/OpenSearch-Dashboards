/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import {
  GettingStartedModal,
  OnlineOfflineCards,
  SDK_PY_EVALS_DOC_URL,
  SDK_TS_EVALS_DOC_URL,
  Screenshot,
  SdkLinks,
} from './eval_onboarding';
import { AgentsEmptyState, DataIssuePrompt, NoEvalsDatasetPrompt } from './eval_empty_states';
import { EvalContext, defaultEvalContext } from './eval_context';
import { CODING_AGENT_PROMPT } from './coding_agent_prompt';
import { EvalGettingStartedButton, EvalHeader, ExperimentalBadge } from './eval_header';

const withServices = (ui: React.ReactElement, services: Record<string, unknown> = {}) =>
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services}>
        {ui}
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );

const STEPS = ['what', 'online', 'offline', 'traces', 'send'];

describe('Screenshot and links', () => {
  it('serves screenshots from the plugin assets, under the base path', () => {
    withServices(<Screenshot name="agents_home" alt="Agents" />, {
      http: { basePath: { prepend: (p: string) => `/base${p}` } },
    });
    const img = screen.getByTestId('agtEvlShot-agents_home');
    expect(img).toHaveAttribute(
      'src',
      '/base/plugins/agentTraces/assets/evaluations/agents_home.webp'
    );
    expect(img).toHaveAttribute('alt', 'Agents');
  });

  it('falls back to the plain asset path without http', () => {
    withServices(<Screenshot name="compare_runs" alt="Compare" />);
    expect(screen.getByTestId('agtEvlShot-compare_runs')).toHaveAttribute(
      'src',
      '/plugins/agentTraces/assets/evaluations/compare_runs.webp'
    );
  });

  it('links the Python and TypeScript SDK docs in a new tab', () => {
    withServices(<SdkLinks />);
    expect(screen.getByTestId('agtEvlSdkPy')).toHaveAttribute('href', SDK_PY_EVALS_DOC_URL);
    expect(screen.getByTestId('agtEvlSdkTs')).toHaveAttribute('href', SDK_TS_EVALS_DOC_URL);
    expect(screen.getByTestId('agtEvlSdkPy')).toHaveAttribute('target', '_blank');
  });

  it('shows online and offline evaluations side by side', () => {
    withServices(<OnlineOfflineCards />);
    expect(screen.getByTestId('agtEvlOnlineCard')).toHaveTextContent('Online evaluations');
    expect(screen.getByTestId('agtEvlOnlineCard')).toHaveTextContent('Grade live traffic');
    expect(screen.getByTestId('agtEvlOfflineCard')).toHaveTextContent('Offline evaluations');
    expect(screen.getByTestId('agtEvlOfflineCard')).toHaveTextContent('Test a version');
  });
});

describe('GettingStartedModal', () => {
  it('offers the coding agent prompt in the footer on every step, described once on the first', () => {
    withServices(<GettingStartedModal onClose={jest.fn()} />);
    expect(screen.getByTestId('agtEvlGettingStarted')).toHaveClass('agtEvlTourModal');
    const what = screen.getByTestId('agtEvlTourScreen-what');
    // One copy button on the first step (the footer's); its description sits at the bottom.
    expect(screen.getAllByText('Copy prompt for your coding agent')).toHaveLength(1);
    expect(within(what).getByTestId('agtEvlTourQuickStart')).toHaveTextContent(
      'Quickest start: let your coding agent do it.'
    );
    expect(what.lastElementChild).toBe(within(what).getByTestId('agtEvlTourQuickStart'));
    STEPS.forEach((id, i) => {
      if (i > 0) fireEvent.click(screen.getByTestId('agtEvlTourNext'));
      expect(screen.getByTestId(`agtEvlTourScreen-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId('agtEvlTourCopyPrompt')).toHaveTextContent(
        'Copy prompt for your coding agent'
      );
      expect(screen.getByTestId('agtEvlTourBack')).toBeInTheDocument();
    });
  });

  it('the copy button copies the prompt and confirms', () => {
    const exec = jest.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    withServices(<GettingStartedModal onClose={jest.fn()} />);
    fireEvent.click(screen.getByTestId('agtEvlTourCopyPrompt'));
    expect(exec).toHaveBeenCalledWith('copy');
  });

  const renderTour = (props: Partial<React.ComponentProps<typeof GettingStartedModal>> = {}) => {
    const onClose = jest.fn();
    withServices(<GettingStartedModal onClose={onClose} {...props} />);
    return { onClose };
  };
  const screenId = () =>
    screen
      .getByTestId(/^agtEvlTourScreen-/)
      .getAttribute('data-test-subj')
      ?.replace('agtEvlTourScreen-', '');

  it('walks the five screens with Next and Back, then Done closes', () => {
    const { onClose } = renderTour();
    STEPS.forEach((id) => expect(screen.getByTestId(`agtEvlTourStep-${id}`)).toBeInTheDocument());
    expect(screenId()).toBe('what');
    // Back is always there (disabled on the first step): the footer never moves.
    expect(screen.getByTestId('agtEvlTourBack')).toBeDisabled();
    expect(screen.getByTestId('agtEvlTourScreen-what')).toHaveTextContent('Online evaluations');
    STEPS.slice(1).forEach((id) => {
      fireEvent.click(screen.getByTestId('agtEvlTourNext'));
      expect(screenId()).toBe(id);
    });
    // The last screen: no Next, Done; no Set up without onSetUp.
    expect(screen.queryByTestId('agtEvlTourNext')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agtEvlTourSetUp')).not.toBeInTheDocument();
    expect(screen.getByTestId('agtEvlTourScreen-send')).toHaveTextContent(
      'genai-evaluation-pipeline'
    );
    expect(
      within(screen.getByTestId('agtEvlTourScreen-send')).getByTestId('agtEvlSdkPy')
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId('agtEvlTourBack'));
    expect(screenId()).toBe('traces');
    expect(screen.getByTestId('agtEvlShot-agent_traces')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlTourNext'));
    fireEvent.click(screen.getByTestId('agtEvlTourDone'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Send results offers a copyable prompt for a coding agent', () => {
    renderTour();
    fireEvent.click(screen.getByTestId('agtEvlTourStep-send'));
    const block = within(screen.getByTestId('agtEvlTourScreen-send')).getByTestId(
      'agtEvlCodingAgentPrompt'
    );
    expect(block).toHaveTextContent('Copy prompt for your coding agent');
    expect(within(block).getByTestId('agtEvlCodingAgentPromptText')).toHaveTextContent(
      'Instrument this agent for OpenSearch Agent Traces and Agent Evaluations'
    );
    // The whole prompt, in a code block (its Copy button needs layout: checked in a browser).
    expect(within(block).getByTestId('agtEvlCodingAgentPromptText').textContent).toContain(
      'Checklist (confirm each with evidence)'
    );
  });

  it('the coding agent prompt is generic and vendor-neutral', () => {
    expect(CODING_AGENT_PROMPT).toContain('gen_ai.evaluation.result');
    expect(CODING_AGENT_PROMPT).toContain('<OTLP_ENDPOINT>');
    expect(CODING_AGENT_PROMPT).toContain('Checklist');
    expect(CODING_AGENT_PROMPT).not.toMatch(/sigv4|OSIS|Amazon|AWS/);
    expect(CODING_AGENT_PROMPT).not.toContain('\u2014');
  });

  it('the coding agent prompt pins the minimum SDK versions and keeps judge tracing optional', () => {
    expect(CODING_AGENT_PROMPT).toContain(
      'pip install "opensearch-genai-observability-sdk-py>=0.3.0"'
    );
    expect(CODING_AGENT_PROMPT).toContain(
      'npm install "@opensearch-project/genai-observability-sdk-ts@>=0.2.0"'
    );
    expect(CODING_AGENT_PROMPT).toContain(
      'its SDK install spec is `opensearch-genai-observability-sdk-py>=0.3.0`'
    );
    expect(CODING_AGENT_PROMPT).toContain('Tracing the judge is optional');
    expect(CODING_AGENT_PROMPT).not.toContain('Use an SDK release that has');
  });

  it('jumps to a screen from its step', () => {
    renderTour();
    fireEvent.click(screen.getByTestId('agtEvlTourStep-offline'));
    expect(screenId()).toBe('offline');
    expect(screen.getByTestId('agtEvlTourScreen-offline')).toHaveTextContent('evaluate(');
    expect(screen.getByTestId('agtEvlShot-compare_runs')).toBeInTheDocument();
  });

  it('offers Set up on the last screen only when onSetUp is given', () => {
    const onSetUp = jest.fn();
    const { onClose } = renderTour({ onSetUp });
    expect(screen.queryByTestId('agtEvlTourSetUp')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlTourStep-send'));
    expect(screen.queryByTestId('agtEvlTourDone')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlTourSetUp'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSetUp).toHaveBeenCalledTimes(1);
  });

  it('Close closes from any screen', () => {
    const { onClose } = renderTour();
    fireEvent.click(screen.getByTestId('agtEvlTourNext'));
    fireEvent.click(screen.getByTestId('agtEvlTourClose'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('NoEvalsDatasetPrompt', () => {
  it('shows the hero, Set up and Getting started, the two modes and the features', () => {
    const onSetUp = jest.fn();
    const onGettingStarted = jest.fn();
    withServices(<NoEvalsDatasetPrompt onSetUp={onSetUp} onGettingStarted={onGettingStarted} />);
    const prompt = screen.getByTestId('agtEvlNoDataset');
    expect(prompt).toHaveTextContent('Measure how well your agents do their job');
    expect(within(prompt).getAllByTestId('agtEvlShot-agents_home').length).toBeGreaterThan(0);
    expect(within(prompt).getByTestId('agtEvlOnlineCard')).toBeInTheDocument();
    expect(within(prompt).getByTestId('agtEvlOfflineCard')).toBeInTheDocument();
    const features = within(prompt).getByTestId('agtEvlFeatures');
    ['agents_home', 'agent_page', 'compare_runs', 'agent_traces'].forEach((shot) =>
      expect(within(features).getByTestId(`agtEvlShot-${shot}`)).toBeInTheDocument()
    );
    expect(within(prompt).queryByTestId('agtEvlEmptyIllustration')).not.toBeInTheDocument();
    expect(within(prompt).queryByTestId('agtEvlNoDatasetError')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agtEvlGetStarted'));
    expect(onSetUp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('agtEvlTour'));
    expect(onGettingStarted).toHaveBeenCalledTimes(1);
    // The coding agent prompt, next to Set up.
    expect(within(prompt).getByTestId('agtEvlCopyPromptHero')).toHaveTextContent(
      'Copy prompt for your coding agent'
    );
  });

  it('the Agents empty state (no results): Getting started and the coding agent prompt', () => {
    const openGettingStarted = jest.fn();
    withServices(
      <EvalContext.Provider
        value={{ ...defaultEvalContext('otel-v1-genai-evaluation*', ''), openGettingStarted }}
      >
        <AgentsEmptyState range="Last 24 hours" />
      </EvalContext.Provider>
    );
    const empty = screen.getByTestId('agtEvlAgentsEmpty');
    expect(within(empty).getByTestId('agtEvlAgentsEmptyCopyPrompt')).toBeInTheDocument();
    fireEvent.click(within(empty).getByTestId('agtEvlAgentsEmptyGettingStarted'));
    expect(openGettingStarted).toHaveBeenCalled();
  });

  it('shows a lookup error', () => {
    withServices(
      <NoEvalsDatasetPrompt onSetUp={jest.fn()} onGettingStarted={jest.fn()} error="Boom" />
    );
    expect(screen.getByTestId('agtEvlNoDatasetError')).toHaveTextContent('Boom');
  });
});

describe('EvalHeader', () => {
  it('Getting started button', () => {
    const onClick = jest.fn();
    withServices(<EvalGettingStartedButton onClick={onClick} />);
    fireEvent.click(screen.getByTestId('agtEvlGettingStartedButton'));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByTestId('agtEvlGettingStartedButton')).toHaveTextContent('Getting started');
  });

  it('Experimental badge: an icon badge labelled Experimental, with what that means', async () => {
    withServices(<ExperimentalBadge />);
    const badge = screen.getByTestId('agtEvlExperimental');
    expect(badge.querySelector('[data-euiicon-type="navExperiments"]')).toBeInTheDocument();
    // An icon badge with a tooltip: the label is the tooltip's title.
    fireEvent.mouseOver(badge.closest('.euiToolTipAnchor') ?? badge);
    const tip = await screen.findByText(/Agent Evaluations is experimental/, undefined, {
      timeout: 5000,
    });
    expect(tip.closest('.euiToolTip')).toHaveTextContent('Experimental');
  });

  it('legacy header: title, Experimental badge and controls in the page', () => {
    withServices(
      <EvalHeader
        title="Evaluations"
        description="What it does"
        controls={[<button key="a" data-test-subj="ctl" />]}
      />,
      { chrome: { navGroup: { getNavGroupEnabled: () => false } }, application: {} }
    );
    const header = screen.getByTestId('agtEvlInPageHeader');
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('Evaluations');
    expect(within(header).getByTestId('agtEvlExperimental')).toBeInTheDocument();
    expect(within(header).getByTestId('ctl')).toBeInTheDocument();
  });

  it('new navigation: the badge on the badge slot and the controls on the right', () => {
    const mounts: Array<{ setMountPoint: unknown; controls: unknown[] }> = [];
    const HeaderControl = (props: { setMountPoint: unknown; controls: unknown[] }) => {
      mounts.push(props);
      return null;
    };
    const application = { setAppBadgeControls: jest.fn(), setAppRightControls: jest.fn() };
    withServices(
      <EvalHeader
        title="Evaluations"
        description="What it does"
        controls={[<button key="a" data-test-subj="ctl" />]}
      />,
      {
        chrome: { navGroup: { getNavGroupEnabled: () => true } },
        navigation: { ui: { HeaderControl } },
        application,
      }
    );
    expect(screen.queryByTestId('agtEvlInPageHeader')).not.toBeInTheDocument();
    const badge = mounts.find((m) => m.setMountPoint === application.setAppBadgeControls);
    const right = mounts.find((m) => m.setMountPoint === application.setAppRightControls);
    expect(badge?.controls).toHaveLength(1);
    const badgeEl = (badge?.controls[0] as { renderComponent: React.ReactElement }).renderComponent;
    expect(badgeEl.type).toBe(ExperimentalBadge);
    expect(right?.controls).toHaveLength(1);
  });
});

describe('DataIssuePrompt', () => {
  const kinds: Array<[React.ComponentProps<typeof DataIssuePrompt>['issue'], string, string]> = [
    [{ kind: 'dataset-missing' }, 'The evaluations dataset was deleted', 'Settings'],
    [{ kind: 'index-missing' }, 'No index matches evals-*', 'evals-*'],
    [{ kind: 'no-results' }, 'No evaluation results in evals-* yet', 'gen_ai.evaluation.result'],
    [
      { kind: 'field-missing', field: 'attributes.error.type' },
      'The evaluation indices have no field attributes.error.type',
      'otel-v1-genai-evaluation-index-template',
    ],
    [
      { kind: 'data-source' },
      'The data source of the evaluations dataset is not available',
      'Data sources',
    ],
  ];
  it.each(kinds)('%p: what is missing, Settings and Getting started', (issue, title, body) => {
    const onSettings = jest.fn();
    const onGettingStarted = jest.fn();
    withServices(
      <DataIssuePrompt
        issue={issue}
        index="evals-*"
        onSettings={onSettings}
        onGettingStarted={onGettingStarted}
      />
    );
    const prompt = screen.getByTestId(`agtEvlDataIssue-${issue.kind}`);
    expect(prompt).toHaveTextContent(title);
    expect(prompt).toHaveTextContent(body);
    fireEvent.click(screen.getByTestId('agtEvlDataIssueSettings'));
    fireEvent.click(screen.getByTestId('agtEvlDataIssueGettingStarted'));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onGettingStarted).toHaveBeenCalledTimes(1);
    // Nothing sent yet: the coding agent prompt too.
    expect(!!screen.queryByTestId('agtEvlDataIssueCopyPrompt')).toBe(
      issue.kind === 'no-results' || issue.kind === 'index-missing'
    );
  });
});
