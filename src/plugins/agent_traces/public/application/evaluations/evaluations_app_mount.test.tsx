/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryHistory, MemoryHistory } from 'history';
import { of } from 'rxjs';
import { I18nProvider } from '@osd/i18n/react';
import { OpenSearchDashboardsContextProvider } from '../../../../opensearch_dashboards_react/public';
import type { AppMountParameters } from '../../../../../core/public';
import { EvaluationsApp } from './evaluations_app';
import { fakePpl } from './eval_test_utils';

// The global `_g` sync: a stub (the real module pulls the whole data plugin in).
jest.mock('../../../../data/public', () => ({
  syncQueryStateWithUrl: () => ({ stop: jest.fn() }),
}));
const mockPpl = fakePpl();
jest.mock('./use_ppl_rows', () => ({
  ...jest.requireActual('./use_ppl_rows'),
  usePplRows: (...args: [unknown, string | undefined, unknown]) => mockPpl.hook(...args),
}));
interface MockDataset {
  status: string;
  config?: { index: string; tracesDataset: unknown; evaluationsDataset: unknown };
  configId?: string;
  workspaceId?: string;
  unavailable: boolean;
  error?: string;
  refresh: jest.Mock;
}
let mockDataset: MockDataset;
jest.mock('./eval_dataset', () => ({
  ...jest.requireActual('./eval_dataset'),
  useEvalsDataset: () => mockDataset,
}));
// The screens and dialogs have their own tests: stubs that show they are open.
jest.mock('./agents_home', () => ({ AgentsHome: () => <div data-test-subj="agentsHome" /> }));
jest.mock('./eval_settings_modal', () => ({
  ...jest.requireActual('./eval_settings_modal'),
  EvalSettingsModal: () => <div data-test-subj="settingsModal" />,
}));
const mockWizard = jest.fn();
jest.mock('./eval_setup_wizard', () => ({
  EvalSetupWizard: (props: { onClose: (saved?: boolean) => void }) => {
    mockWizard(props);
    return (
      <div data-test-subj="setupWizard">
        <button data-test-subj="wizardSaved" onClick={() => props.onClose(true)} />
      </div>
    );
  },
}));
jest.mock('./eval_onboarding', () => ({
  ...jest.requireActual('./eval_onboarding'),
  GettingStartedModal: (props: { onClose: () => void; onSetUp?: () => void }) => (
    <div data-test-subj="tour">
      {props.onSetUp && (
        <button
          data-test-subj="tourSetUp"
          onClick={() => {
            props.onClose();
            props.onSetUp?.();
          }}
        />
      )}
    </div>
  ),
}));

const CONFIG = {
  index: 'otel-v1-genai-evaluation*',
  tracesDataset: { id: 'tr', title: 'otel-v1-apm-span*' },
  evaluationsDataset: { id: 'ev', title: 'otel-v1-genai-evaluation*' },
};

const services = () => ({
  uiSettings: {
    get: (key: string, def?: unknown) =>
      key === 'dateFormat' ? 'MMM D, YYYY @ HH:mm:ss.SSS' : key === 'dateFormat:tz' ? 'UTC' : def,
    get$: () => of('UTC'),
  },
  data: {
    query: {
      timefilter: {
        timefilter: {
          getTime: () => ({ from: 'now-7d', to: 'now' }),
          setTime: jest.fn(),
          getTimeUpdate$: () => of(undefined),
          calculateBounds: () => ({
            min: { valueOf: () => Date.UTC(2026, 9, 21) },
            max: { valueOf: () => Date.UTC(2026, 9, 28) },
          }),
        },
      },
    },
  },
  chrome: {
    setBreadcrumbs: jest.fn(),
    docTitle: { change: jest.fn(), reset: jest.fn() },
    navGroup: { getNavGroupEnabled: () => false },
  },
  application: { navigateToApp: jest.fn(), getUrlForApp: jest.fn(() => '/app/x') },
});

const mount = (hash: string) => {
  window.history.replaceState(null, '', `/app/agentTraces/evaluations${hash}`);
  const history: MemoryHistory = createMemoryHistory({ initialEntries: [`/${hash}`] });
  render(
    <I18nProvider>
      <OpenSearchDashboardsContextProvider services={services()}>
        <EvaluationsApp params={{ history } as unknown as AppMountParameters} />
      </OpenSearchDashboardsContextProvider>
    </I18nProvider>
  );
  return history;
};

const controlIds = () =>
  within(screen.getByTestId('agtEvlInPageHeader'))
    .getAllByRole('button')
    .map((b) => b.getAttribute('data-test-subj'))
    .filter((id) => id === 'agtEvlGettingStartedButton' || id === 'agtEvlSettingsButton');

describe('EvaluationsApp', () => {
  beforeEach(() => {
    mockPpl.reset();
    mockWizard.mockClear();
    mockDataset = { status: 'ready', config: CONFIG, unavailable: false, refresh: jest.fn() };
  });

  it('with a config: the date picker, Getting started and Settings', () => {
    mount('#/agents');
    expect(screen.getByTestId('agentsHome')).toBeInTheDocument();
    const header = screen.getByTestId('agtEvlInPageHeader');
    // EuiSuperDatePicker does not pass data-test-subj to its root.
    expect(header.querySelector('.euiSuperDatePicker')).toBeInTheDocument();
    expect(within(header).getByTestId('agtEvlExperimental')).toBeInTheDocument();
    expect(controlIds()).toEqual(['agtEvlGettingStartedButton', 'agtEvlSettingsButton']);
    expect(screen.queryByTestId('agtEvlRefresh')).not.toBeInTheDocument();
  });

  it('Getting started opens the tour, without Set up when a config exists', () => {
    mount('#/agents');
    fireEvent.click(screen.getByTestId('agtEvlGettingStartedButton'));
    expect(screen.getByTestId('tour')).toBeInTheDocument();
    expect(screen.queryByTestId('tourSetUp')).not.toBeInTheDocument();
  });

  it('a run page: Refresh instead of the date picker', () => {
    mockPpl.answer((q) =>
      q.includes('as first, max')
        ? [{ first: '2026-10-28 07:00:00', last: '2026-10-28 07:05:00' }]
        : []
    );
    mount('#/runs/run_1');
    const header = screen.getByTestId('agtEvlInPageHeader');
    expect(within(header).getByTestId('agtEvlRefresh')).toBeInTheDocument();
    expect(header.querySelector('.euiSuperDatePicker')).not.toBeInTheDocument();
    expect(controlIds()).toEqual(['agtEvlGettingStartedButton', 'agtEvlSettingsButton']);
  });

  it('no config: the showcase, Getting started and Settings; Set up opens the wizard', () => {
    mockDataset = {
      status: 'ready',
      unavailable: false,
      configId: 'c1',
      workspaceId: 'ws1',
      refresh: jest.fn(),
    };
    mount('#/agents');
    expect(screen.getByTestId('agtEvlNoDataset')).toBeInTheDocument();
    expect(document.querySelector('.euiSuperDatePicker')).not.toBeInTheDocument();
    expect(controlIds()).toEqual(['agtEvlGettingStartedButton', 'agtEvlSettingsButton']);
    fireEvent.click(screen.getByTestId('agtEvlGetStarted'));
    expect(screen.getByTestId('setupWizard')).toBeInTheDocument();
    expect(mockWizard).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'c1', workspaceId: 'ws1' })
    );
    // Saved: the wizard closes and the config is read again.
    fireEvent.click(screen.getByTestId('wizardSaved'));
    expect(screen.queryByTestId('setupWizard')).not.toBeInTheDocument();
    expect(mockDataset.refresh).toHaveBeenCalledTimes(1);
  });

  it('no config: the tour offers Set up, which opens the wizard', () => {
    mockDataset = { status: 'ready', unavailable: false, refresh: jest.fn() };
    mount('#/agents');
    fireEvent.click(screen.getByTestId('agtEvlTour'));
    fireEvent.click(screen.getByTestId('tourSetUp'));
    expect(screen.queryByTestId('tour')).not.toBeInTheDocument();
    expect(screen.getByTestId('setupWizard')).toBeInTheDocument();
  });

  it('openSettings=true in the hash opens Settings once and leaves the URL', () => {
    mount('#/agents?openSettings=true');
    expect(screen.getByTestId('settingsModal')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/agents');
  });

  it('openSettings=true on a later navigation opens Settings too', () => {
    const history = mount('#/agents');
    expect(screen.queryByTestId('settingsModal')).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState(
        null,
        '',
        '/app/agentTraces/evaluations#/agents?openSettings=true'
      );
      history.push('/#/agents?openSettings=true');
    });
    expect(screen.getByTestId('settingsModal')).toBeInTheDocument();
  });
});
