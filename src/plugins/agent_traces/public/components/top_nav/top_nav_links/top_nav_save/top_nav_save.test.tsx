/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getSaveButtonRun, saveTopNavData } from './top_nav_save';
import { AgentTracesServices } from '../../../../types';
import { ExecutionContextSearch } from '../../../../../../expressions';
import { SavedAgentTraces } from '../../../../types/saved_agent_traces_types';

// Mock dependencies
jest.mock('../../../../helpers/save_agent_traces', () => ({
  saveSavedAgentTraces: jest.fn(() => Promise.resolve({ id: 'saved-id' })),
}));

jest.mock('../../../../saved_agent_traces/transforms', () => ({
  saveStateToSavedObject: jest.fn((obj) => obj),
}));

jest.mock('../../../../../../saved_objects/public', () => ({
  showSaveModal: jest.fn(),
}));

const mockVisConfig: { value: unknown } = { value: undefined };
jest.mock('../../../visualizations/visualization_builder_singleton', () => ({
  getVisualizationBuilder: () => ({ visConfig$: mockVisConfig }),
}));
const barChart = {
  type: 'bar',
  title: 'Tokens',
  description: 'Per model',
  axesMapping: { x: 'day', y: 'spans' },
  styles: { addLegend: false },
  splitField: 'model',
  splitLayout: 'grid',
  showSplitLabel: true,
};

const mockServices = {
  core: {
    i18n: {
      Context: React.Fragment,
    },
  },
} as unknown as AgentTracesServices;

const mockSearchContext: ExecutionContextSearch = {
  query: { query: 'test', language: 'PPL' },
  filters: [],
  timeRange: { from: 'now-15m', to: 'now' },
};

const mockSaveStateProps = {
  dataset: undefined,
  tabState: {
    logs: {},
    patterns: {
      patternsField: undefined,
      usingRegexPatterns: false,
    },
  },
  flavorId: 'logs',
  tabDefinition: {
    id: 'logs',
    name: 'Logs',
    label: 'Logs',
    flavor: 'logs' as any,
    supportedLanguages: ['PPL'],
    component: {} as any,
  },
  activeTabId: 'logs',
};

const mockSavedAgentTraces = {
  id: 'test-id',
  title: 'Test Agent Traces',
  type: 'logs',
  searchSource: {} as any,
  destroy: jest.fn(),
  save: jest.fn(),
  copyOnSave: false,
  lastSavedTitle: '',
  getEsType: jest.fn(),
  isSaved: jest.fn(() => true),
  getFullPath: jest.fn(),
  getOpenSearchType: jest.fn(),
} as unknown as SavedAgentTraces;

describe('top_nav_save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveTopNavData', () => {
    it('has correct configuration', () => {
      expect(saveTopNavData.tooltip).toBe('Save search');
      // Tooltip and aria-label are deliberately the same string.
      expect(saveTopNavData.ariaLabel).toBe(saveTopNavData.tooltip);
      expect(saveTopNavData.testId).toBe('discoverSaveButton');
      expect(saveTopNavData.iconType).toBe('save');
      // Labeled button (shows "Save search" at wide widths); the label collapses via CSS at narrow.
      expect(saveTopNavData.controlType).toBe('button');
      expect(saveTopNavData.label).toBe('Save search');
    });
  });

  describe('getSaveButtonRun', () => {
    it('returns early when no savedAgentTraces is provided', () => {
      const run = getSaveButtonRun(mockServices, jest.fn(), mockSearchContext, mockSaveStateProps);

      // Should not throw and should complete quickly
      const mockElement = document.createElement('button');
      const result = run(mockElement);
      expect(result).toBeUndefined();
    });

    it('calls showSaveModal when savedAgentTraces is provided', () => {
      const { showSaveModal } = jest.requireMock('../../../../../../saved_objects/public');

      const run = getSaveButtonRun(
        mockServices,
        jest.fn(),
        mockSearchContext,
        mockSaveStateProps,
        mockSavedAgentTraces
      );

      const mockElement = document.createElement('button');
      run(mockElement);

      expect(showSaveModal).toHaveBeenCalled();
    });

    const saveWith = async (saved: unknown) => {
      const { showSaveModal } = jest.requireMock('../../../../../../saved_objects/public');
      const { saveSavedAgentTraces } = jest.requireMock('../../../../helpers/save_agent_traces');
      showSaveModal.mockClear();
      saveSavedAgentTraces.mockClear();
      const run = getSaveButtonRun(
        mockServices,
        jest.fn(),
        mockSearchContext,
        mockSaveStateProps,
        saved as typeof mockSavedAgentTraces
      );
      run(document.createElement('button'));
      const modal = showSaveModal.mock.calls[0][0];
      await modal.props.onSave({
        newTitle: 'Tokens per day',
        newCopyOnSave: false,
        isTitleDuplicateConfirmed: false,
        onTitleDuplicate: jest.fn(),
      });
      return saveSavedAgentTraces.mock.calls[0][0].savedAgentTraces;
    };

    it('saves the chart as configured (type, axes, styles, split, title, description)', async () => {
      const { saveStateToSavedObject } = jest.requireMock(
        '../../../../saved_agent_traces/transforms'
      );
      saveStateToSavedObject.mockClear();
      mockVisConfig.value = barChart;
      await saveWith({ ...mockSavedAgentTraces });
      expect(saveStateToSavedObject.mock.calls[0][3]).toEqual({
        title: 'Tokens',
        description: 'Per model',
        chartType: 'bar',
        axesMapping: { x: 'day', y: 'spans' },
        styleOptions: { addLegend: false },
        splitField: 'model',
        splitLayout: 'grid',
        showSplitLabel: true,
      });
    });

    it('keeps the saved chart when saving from a tab without the chart', async () => {
      // The Visualization tab is not mounted: the builder was reset and holds no chart.
      const { saveStateToSavedObject } = jest.requireMock(
        '../../../../saved_agent_traces/transforms'
      );
      saveStateToSavedObject.mockImplementationOnce((obj: Record<string, unknown>) => {
        obj.visualization = '{"chartType":"line","params":{}}';
        return obj;
      });
      mockVisConfig.value = undefined;
      const chart = '{"chartType":"bar","axesMapping":{"x":"day"}}';
      const saved = await saveWith({ ...mockSavedAgentTraces, visualization: chart });
      expect(saved.visualization).toBe(chart);
    });
  });
});
