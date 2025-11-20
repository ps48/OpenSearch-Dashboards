/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Embeddable,
  EmbeddableInput,
  EmbeddableOutput,
  SavedObjectEmbeddableInput,
} from '../../../embeddable/public';
import { Filter, IIndexPattern, TimeRange } from '../../../data/public';
import { QueryState } from '../application/utils/state_management/slices';
import { SortOrder } from '../types/saved_explore_types';

export interface ExploreInput extends EmbeddableInput {
  timeRange: TimeRange;
  query?: QueryState;
  filters?: Filter[];
  hidePanelTitles?: boolean;
  columns?: string[];
  sort?: SortOrder[];
}

export interface ExploreOutput extends EmbeddableOutput {
  editUrl: string;
  indexPatterns?: IIndexPattern[];
  editable: boolean;
}

export interface ExploreEmbeddable extends Embeddable<ExploreInput, ExploreOutput> {
  type: string;
}

/**
 * Attributes for a saved explore object
 */
export interface ExploreSavedObjectAttributes {
  title: string;
  description?: string;
  hits?: number;
  columns?: string[];
  sort?: SortOrder[];
  version?: number;
  type?: string;
  visualization?: string;
  uiState?: string;
  kibanaSavedObjectMeta: {
    searchSourceJSON: string;
  };
}

/**
 * By-reference input: references a saved explore by ID
 */
export type ExploreByReferenceInput = SavedObjectEmbeddableInput & ExploreInput;

/**
 * By-value input: contains explore attributes directly
 */
export interface ExploreByValueInput extends ExploreInput {
  attributes: ExploreSavedObjectAttributes;
  references?: Array<{ name: string; type: string; id: string }>;
}
