/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { osdAppSavedObjectType } from './osd_app';
import { SAVED_OBJECT_TYPE } from '../../common/constants';

describe('osdAppSavedObjectType', () => {
  it('has the correct name', () => {
    expect(osdAppSavedObjectType.name).toBe(SAVED_OBJECT_TYPE);
  });

  it('uses single namespace type for workspace scoping', () => {
    expect(osdAppSavedObjectType.namespaceType).toBe('single');
  });

  it('is not hidden', () => {
    expect(osdAppSavedObjectType.hidden).toBe(false);
  });

  it('is importable and exportable', () => {
    expect(osdAppSavedObjectType.management?.importableAndExportable).toBe(true);
  });

  it('returns title from attributes', () => {
    const obj = { id: 'test-id', attributes: { title: 'My App' } };
    expect(osdAppSavedObjectType.management?.getTitle?.(obj)).toBe('My App');
  });

  it('returns in-app URL containing the object id', () => {
    const obj = { id: 'test-id', attributes: { title: 'My App' } };
    const result = osdAppSavedObjectType.management?.getInAppUrl?.(obj);
    expect(result?.path).toContain('test-id');
    expect(result?.uiCapabilitiesPath).toBe('osdApps.show');
  });

  it('returns edit URL containing the object id', () => {
    const obj = { id: 'test-id', attributes: { title: 'My App' } };
    const result = osdAppSavedObjectType.management?.getEditUrl?.(obj);
    expect(result).toContain('test-id');
  });

  describe('mappings', () => {
    const { properties } = osdAppSavedObjectType.mappings;

    it('contains all expected fields', () => {
      const expectedFields = [
        'title',
        'description',
        'author',
        'version',
        'sourceCode',
        'dataSourceRefs',
        'promptHistory',
        'tags',
        'createdAt',
        'updatedAt',
      ];
      expect(Object.keys(properties)).toEqual(expect.arrayContaining(expectedFields));
    });

    it('does not index sourceCode', () => {
      expect(properties.sourceCode).toEqual({ type: 'text', index: false });
    });

    it('does not index dataSourceRefs', () => {
      expect(properties.dataSourceRefs).toEqual({ type: 'text', index: false });
    });

    it('does not index promptHistory', () => {
      expect(properties.promptHistory).toEqual({ type: 'text', index: false });
    });
  });
});
