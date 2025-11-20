/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { i18n } from '@osd/i18n';
import { SavedObjectAttributes, SimpleSavedObject } from 'opensearch-dashboards/public';

import { UiActionsStart } from '../../../ui_actions/public';
// TODO: should not use getServices from legacy any more
import { getServices } from '../application/legacy/discover/opensearch_dashboards_services';
import {
  EmbeddableFactoryDefinition,
  Container,
  ErrorEmbeddable,
} from '../../../embeddable/public';
import { TimeRange } from '../../../data/public';
import { ExploreInput, ExploreOutput } from './types';
import { EXPLORE_EMBEDDABLE_TYPE } from './constants';
import { ExploreEmbeddable } from './explore_embeddable';
import { VisualizationRegistryService } from '../services/visualization_registry_service';
import { ExploreFlavor } from '../../common';

interface StartServices {
  executeTriggerActions: UiActionsStart['executeTriggerActions'];
  isEditable: () => boolean;
}

export class ExploreEmbeddableFactory
  implements EmbeddableFactoryDefinition<ExploreInput, ExploreOutput, ExploreEmbeddable> {
  public readonly type = EXPLORE_EMBEDDABLE_TYPE;
  public readonly savedObjectMetaData = {
    name: i18n.translate('explore.savedExplore.savedObjectName', {
      defaultMessage: 'Saved explore',
    }),
    type: 'explore',
    getIconForSavedObject: ({ attributes }: SimpleSavedObject<SavedObjectAttributes>) => {
      let iconType = '';
      try {
        const vis = JSON.parse(attributes.visualization as string);
        const chart = this.visualizationRegistryService
          .getRegistry()
          .getAvailableChartTypes()
          .find((t) => t.type === vis.chartType);
        if (chart) {
          iconType = chart.icon;
        }
      } catch (e) {
        iconType = '';
      }
      return iconType;
    },
    includeFields: ['kibanaSavedObjectMeta', 'visualization'],
  };

  constructor(
    private getStartServices: () => Promise<StartServices>,
    private readonly visualizationRegistryService: VisualizationRegistryService
  ) {}

  public canCreateNew() {
    return false;
  }

  public isEditable = async () => {
    return (await this.getStartServices()).isEditable();
  };

  public getDisplayName() {
    return i18n.translate('explore.embeddable.displayName', {
      defaultMessage: 'visualization in discover',
    });
  }

  public createFromSavedObject = async (
    savedObjectId: string,
    input: Partial<ExploreInput> & { id: string; timeRange: TimeRange },
    parent?: Container
  ): Promise<ExploreEmbeddable | ErrorEmbeddable> => {
    const services = getServices();
    const filterManager = services.filterManager;
    const url = await services.getSavedExploreUrlById(savedObjectId);

    try {
      const savedObject = await services.getSavedExploreById(savedObjectId);
      if (!savedObject) {
        throw new Error('Saved object not found');
      }
      const indexPattern = savedObject.searchSource.getField('index');
      const { executeTriggerActions } = await this.getStartServices();
      const { ExploreEmbeddable: ExploreEmbeddableClass } = await import('./explore_embeddable');
      const flavor = savedObject.type ?? ExploreFlavor.Logs;
      const editUrl = services.addBasePath(`/app/explore/${flavor}/${url}`);

      return new ExploreEmbeddableClass(
        {
          savedExplore: savedObject,
          editUrl,
          editPath: url,
          filterManager,
          editable: services.capabilities.discover?.save as boolean,
          indexPatterns: indexPattern ? [indexPattern] : [],
          services,
          editApp: `explore/${flavor}`,
        },
        input,
        executeTriggerActions,
        parent
      );
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      return new ErrorEmbeddable(e, input, parent);
    }
  };

  /**
   * Creates an explore embeddable.
   * Supports both by-reference (with savedObjectId) and by-value (with attributes) embeddables.
   *
   * @param input - Embeddable input configuration
   * @param parent - Optional parent container
   */
  public async create(
    input: ExploreInput & { attributes?: any; references?: any[] },
    parent?: Container
  ): Promise<ExploreEmbeddable | ErrorEmbeddable> {
    const services = getServices();
    const filterManager = services.filterManager;

    // Check if this is a by-value embeddable (contains attributes)
    if (input.attributes) {
      const attributes = input.attributes;
      const references = input.references || [];

      try {
        // Parse the search source JSON
        const searchSourceJSON = JSON.parse(attributes.kibanaSavedObjectMeta.searchSourceJSON);

        // Find the index pattern reference (optional for external data sources like Prometheus)
        const indexPatternRef = references.find(
          (ref: any) => ref.name === 'kibanaSavedObjectMeta.searchSourceJSON.index'
        );

        // Get the index pattern if reference exists (not needed for external data sources)
        let indexPattern;
        if (indexPatternRef) {
          indexPattern = await services.dataViews.get(indexPatternRef.id).catch();
        }

        // Create a search source
        const searchSource = await services.data.search.searchSource.create();

        // Set up the search source with the saved data
        if (indexPattern) {
          searchSource.setField('index', indexPattern);
        }
        if (searchSourceJSON.query) {
          searchSource.setField('query', searchSourceJSON.query);
        }
        if (searchSourceJSON.filter) {
          searchSource.setField('filter', searchSourceJSON.filter);
        }

        // Create a minimal SavedExplore-like object
        const savedExplore = {
          id: input.id,
          title: attributes.title,
          description: attributes.description || '',
          columns: attributes.columns || ['_source'],
          sort: attributes.sort || [],
          type: attributes.type || 'logs',
          visualization: attributes.visualization || '',
          uiState: attributes.uiState || '{}',
          searchSource,
        };

        const { executeTriggerActions } = await this.getStartServices();
        const { ExploreEmbeddable: ExploreEmbeddableClass } = await import('./explore_embeddable');
        const flavor = savedExplore.type;
        const editUrl = '';
        const editPath = '';

        return new ExploreEmbeddableClass(
          {
            savedExplore: savedExplore as any,
            editUrl,
            editPath,
            filterManager,
            editable: false,
            indexPatterns: indexPattern ? [indexPattern] : [],
            services,
            editApp: `explore/${flavor}`,
          },
          input,
          executeTriggerActions,
          parent
        );
      } catch (e) {
        return new ErrorEmbeddable(e, input, parent);
      }
    }

    // For by-reference embeddables (saved object ID), return error since we need createFromSavedObject
    return new ErrorEmbeddable(
      'Saved explores can only be created from a saved object using createFromSavedObject()',
      input,
      parent
    );
  }
}
