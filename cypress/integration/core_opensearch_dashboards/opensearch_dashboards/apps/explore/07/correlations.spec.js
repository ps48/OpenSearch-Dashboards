/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DATASOURCE_NAME,
  TRACE_INDEX_PATTERN,
  TRACE_TIME_FIELD,
  TRACE_INDEX,
  LOG_INDEX_1,
  LOG_INDEX_2,
  LOG_TIME_FIELD,
  TEST_FIELD_MAPPINGS,
} from '../../../../../../utils/apps/explore/constants';
import { getRandomizedWorkspaceName } from '../../../../../../utils/apps/explore/shared';
import { prepareTestSuite } from '../../../../../../utils/helpers';
import { PATHS } from '../../../../../../utils/constants';

const workspaceName = getRandomizedWorkspaceName();
const TRACE_DATASET_NAME = TRACE_INDEX_PATTERN; // Dataset name will be the pattern with wildcard
const LOG_DATASET_NAME_1 = `${LOG_INDEX_1}*`; // Dataset name has wildcard appended
const LOG_DATASET_NAME_2 = `${LOG_INDEX_2}*`; // Dataset name has wildcard appended

const correlationTestSuite = () => {
  before(() => {
    // Setup trace dataset
    cy.explore.setupWorkspaceAndDataSourceWithTraces(workspaceName, [TRACE_INDEX]);
    cy.explore.createWorkspaceDataSets({
      workspaceName,
      indexPattern: TRACE_INDEX_PATTERN.replace('*', ''),
      timefieldName: TRACE_TIME_FIELD,
      dataSource: DATASOURCE_NAME,
      isEnhancement: true,
      signalType: 'traces',
    });

    // Setup log datasets
    cy.osd.setupTestData(
      PATHS.SECONDARY_ENGINE,
      [
        'cypress/fixtures/query_enhancements/data_logs_1/data_logs_small_time_1.mapping.json',
        'cypress/fixtures/query_enhancements/data_logs_1/data_logs_small_time_2.mapping.json',
      ],
      [
        'cypress/fixtures/query_enhancements/data_logs_1/data_logs_small_time_1.data.ndjson',
        'cypress/fixtures/query_enhancements/data_logs_1/data_logs_small_time_2.data.ndjson',
      ]
    );

    // Create first log dataset
    cy.explore.createWorkspaceDataSets({
      workspaceName,
      indexPattern: LOG_INDEX_1.replace('*', ''),
      timefieldName: LOG_TIME_FIELD,
      dataSource: DATASOURCE_NAME,
      isEnhancement: true,
      signalType: 'logs',
    });

    // Create second log dataset
    cy.explore.createWorkspaceDataSets({
      workspaceName,
      indexPattern: LOG_INDEX_2.replace('*', ''),
      timefieldName: LOG_TIME_FIELD,
      dataSource: DATASOURCE_NAME,
      isEnhancement: true,
      signalType: 'logs',
    });
  });

  after(() => {
    cy.explore.cleanupWorkspaceAndDataSourceAndTraces(workspaceName, [TRACE_INDEX]);
    cy.osd.deleteIndex(LOG_INDEX_1);
    cy.osd.deleteIndex(LOG_INDEX_2);
  });

  describe('Navigation and Setup', () => {
    it('should navigate to Correlated datasets tab', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.getElementByTestId('correlatedDatasetsTab').should('have.class', 'euiTab-isSelected');
      cy.getElementByTestId('emptyStatePrompt').should('be.visible');
      cy.getElementByTestId('createCorrelationButton').should('be.visible');
    });

    it('should show empty state when no correlations exist', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.getElementByTestId('emptyStatePrompt').should('be.visible');
      cy.contains('There are no correlated datasets').should('be.visible');
    });
  });

  describe('Correlation Creation', () => {
    it('should open create correlation modal', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();
      cy.getElementByTestId('configureCorrelationModal').should('be.visible');
    });

    it('should create correlation with 2 log datasets', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();

      // Select 2 log datasets
      cy.explore.selectLogDatasets([LOG_DATASET_NAME_1, LOG_DATASET_NAME_2]);

      // Configure field mappings for both datasets
      cy.explore.configureFieldMappings(LOG_DATASET_NAME_1, TEST_FIELD_MAPPINGS.LOG_DATASET_1);
      cy.explore.configureFieldMappings(LOG_DATASET_NAME_2, TEST_FIELD_MAPPINGS.LOG_DATASET_2);

      // Create correlation
      cy.explore.createCorrelation();

      // Verify correlation appears in table
      cy.getElementByTestId('correlationsTable')
        .should('be.visible')
        .should('contain', LOG_INDEX_1)
        .should('contain', LOG_INDEX_2);
    });
  });

  describe('Field Mapping Configuration', () => {
    beforeEach(() => {
      // Navigate to clean state
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();
      cy.explore.selectLogDatasets([LOG_DATASET_NAME_1]);
    });

    it('should show warning when field mappings are missing', () => {
      // Don't configure mappings
      cy.getElementByTestId('manageFieldMappingsAccordion').click();

      // Should show error callout
      cy.getElementByTestId('missingMappingsCallout')
        .should('be.visible')
        .should('contain', 'Missing field mappings');

      // Save button should be disabled
      cy.getElementByTestId('createCorrelationConfirmButton').should('be.disabled');
    });

    it('should validate required fields before saving mappings', () => {
      cy.getElementByTestId('manageFieldMappingsAccordion').click();

      // Start editing
      cy.contains('tr', LOG_DATASET_NAME_1).find('[data-test-subj^="editDataset-"]').click();

      // Fill only some fields
      cy.get('[data-test-subj*="fieldSelector-timestamp"]')
        .find('[data-test-subj="comboBoxSearchInput"]')
        .type('timestamp{enter}');

      cy.get('[data-test-subj*="fieldSelector-traceId"]')
        .find('[data-test-subj="comboBoxSearchInput"]')
        .type('agent{enter}');

      // Try to save without all fields
      cy.contains('tr', LOG_DATASET_NAME_1).find('[data-test-subj^="saveDataset-"]').click();

      // Should show validation error
      cy.getElementByTestId('euiToastHeader')
        .contains('Missing required fields')
        .should('be.visible');

      // Fields should be highlighted as invalid
      cy.get('[data-test-subj*="fieldSelector-spanId"]').should(
        'have.class',
        'euiComboBox-isInvalid'
      );
    });

    it('should cancel field mapping edits and revert changes', () => {
      cy.getElementByTestId('manageFieldMappingsAccordion').click();

      // Start editing
      cy.contains('tr', LOG_DATASET_NAME_1).find('[data-test-subj^="editDataset-"]').click();

      // Make changes
      cy.get('[data-test-subj*="fieldSelector-traceId"]')
        .find('[data-test-subj="comboBoxSearchInput"]')
        .type('agent{enter}');

      // Cancel
      cy.contains('tr', LOG_DATASET_NAME_1).find('[data-test-subj^="cancelEdit-"]').click();

      // Changes should be reverted
      cy.contains('tr', LOG_DATASET_NAME_1)
        .find('[data-test-subj*="traceId"]')
        .should('contain', '—');
    });
  });

  describe('Multiple Dataset Field Mapping', () => {
    it('should revert changes when editing different dataset without saving', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();
      cy.explore.selectLogDatasets([LOG_DATASET_NAME_1, LOG_DATASET_NAME_2]);

      cy.getElementByTestId('manageFieldMappingsAccordion').click();

      // Edit dataset 1
      cy.contains('tr', LOG_DATASET_NAME_1).find('[data-test-subj^="editDataset-"]').click();

      cy.get('[data-test-subj*="fieldSelector-traceId"]')
        .find('[data-test-subj="comboBoxSearchInput"]')
        .type('agent{enter}');

      // Switch to dataset 2 without saving
      cy.contains('tr', LOG_DATASET_NAME_2).find('[data-test-subj^="editDataset-"]').click();

      // Dataset 1 should no longer be in edit mode
      cy.contains('tr', LOG_DATASET_NAME_1)
        .find('[data-test-subj^="saveDataset-"]')
        .should('not.exist');

      // Dataset 1 changes should be reverted (field should be empty)
      cy.contains('tr', LOG_DATASET_NAME_1)
        .find('[data-test-subj*="traceId"]')
        .should('contain', '—');
    });
  });

  describe('Correlation Management', () => {
    before(() => {
      // Create a correlation for management tests
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();
      cy.explore.selectLogDatasets([LOG_DATASET_NAME_1, LOG_DATASET_NAME_2]);
      cy.explore.configureFieldMappings(LOG_DATASET_NAME_1, TEST_FIELD_MAPPINGS.LOG_DATASET_1);
      cy.explore.configureFieldMappings(LOG_DATASET_NAME_2, TEST_FIELD_MAPPINGS.LOG_DATASET_2);
      cy.explore.createCorrelation();
    });

    it('should display correlation details in table', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);

      cy.getElementByTestId('correlationsTable')
        .should('be.visible')
        .within(() => {
          cy.contains('Trace-to-logs').should('be.visible');
          cy.contains(TRACE_INDEX).should('be.visible');
          cy.contains(LOG_INDEX_1).should('be.visible');
          cy.contains(LOG_INDEX_2).should('be.visible');
          cy.getElementByTestId('editCorrelationButton').should('be.visible');
          cy.getElementByTestId('deleteCorrelationButton').should('be.visible');
        });
    });

    it('should delete correlation after confirmation', () => {
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);

      cy.getElementByTestId('deleteCorrelationButton').click();
      cy.getElementByTestId('confirmModalConfirmButton').click();

      cy.getElementByTestId('euiToastHeader').contains('deleted').should('be.visible');

      // Should show empty state again
      cy.getElementByTestId('emptyStatePrompt').should('be.visible');
    });
  });

  describe('Integration and Persistence', () => {
    it('should persist configured field mappings after reload', () => {
      // Create correlation with field mappings
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();
      cy.explore.selectLogDatasets([LOG_DATASET_NAME_1]);
      cy.explore.configureFieldMappings(LOG_DATASET_NAME_1, TEST_FIELD_MAPPINGS.LOG_DATASET_1);
      cy.explore.createCorrelation();

      // Reload page
      cy.reload();

      // Navigate back to tab
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);

      // Edit correlation to check mappings
      cy.getElementByTestId('editCorrelationButton').click();
      cy.getElementByTestId('manageFieldMappingsAccordion').click();

      // Verify mappings are preserved
      cy.contains('tr', LOG_DATASET_NAME_1).within(() => {
        cy.get('[data-test-subj*="timestamp"]').should('contain', 'timestamp');
        cy.get('[data-test-subj*="traceId"]').should('contain', 'agent');
        cy.get('[data-test-subj*="spanId"]').should('contain', 'clientip');
        cy.get('[data-test-subj*="serviceName"]').should('contain', 'extension');
      });
    });

    it('should auto-expand accordion when validation errors exist', () => {
      // Delete any existing correlation first
      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);

      cy.get('body').then(($body) => {
        if ($body.find('[data-test-subj="deleteCorrelationButton"]').length > 0) {
          cy.getElementByTestId('deleteCorrelationButton').click();
          cy.getElementByTestId('confirmModalConfirmButton').click();
          cy.wait(1000);
        }
      });

      cy.explore.navigateToCorrelatedDatasetsTab(workspaceName, TRACE_DATASET_NAME);
      cy.explore.openCreateCorrelationModal();
      cy.explore.selectLogDatasets([LOG_DATASET_NAME_1]);

      // Don't configure mappings
      cy.wait(1000);

      // Accordion should auto-open due to errors
      cy.getElementByTestId('manageFieldMappingsAccordion').should(
        'have.attr',
        'aria-expanded',
        'true'
      );

      cy.getElementByTestId('missingMappingsCallout').should('be.visible');
    });
  });
};

prepareTestSuite('Correlations', correlationTestSuite);
