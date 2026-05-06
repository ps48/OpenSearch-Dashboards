/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedObjectsType } from 'opensearch-dashboards/server';
import { SAVED_OBJECT_TYPE } from '../../common/constants';

export const osdAppSavedObjectType: SavedObjectsType = {
  name: SAVED_OBJECT_TYPE,
  hidden: false,
  namespaceType: 'single',
  management: {
    icon: 'apps',
    defaultSearchField: 'title',
    importableAndExportable: true,
    getTitle(obj) {
      return obj.attributes.title;
    },
    getEditUrl(obj) {
      return `/management/opensearch-dashboards/objects/savedCanvas/${encodeURIComponent(obj.id)}`;
    },
    getInAppUrl(obj) {
      return {
        path: `/app/osd-apps/view/${encodeURIComponent(obj.id)}`,
        uiCapabilitiesPath: 'osdApps.show',
      };
    },
  },
  mappings: {
    properties: {
      title: { type: 'text' },
      description: { type: 'text' },
      author: { type: 'keyword' },
      version: { type: 'integer' },
      sourceCode: { type: 'text', index: false },
      dataSourceRefs: { type: 'text', index: false },
      promptHistory: { type: 'text', index: false },
      tags: { type: 'keyword' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
    },
  },
  migrations: {},
};
