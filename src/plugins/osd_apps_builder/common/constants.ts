/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export const PLUGIN_ID = 'osdAppsBuilder';
export const PLUGIN_NAME = 'OSD Apps';
export const SAVED_OBJECT_TYPE = 'osd-app';

export const APP_ID = 'osd-apps';
export const BUILDER_APP_ID = 'osd-apps-builder';

export const API_BASE = '/api/osd-apps';
export const ROUTES = {
  GENERATE: `${API_BASE}/generate`,
  REFINE: `${API_BASE}/refine`,
  VALIDATE: `${API_BASE}/validate`,
} as const;
