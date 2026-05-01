/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppSavedObjectClient } from './app_saved_object_client';
import { SAVED_OBJECT_TYPE } from '../../common/constants';

const createMockClient = () => ({
  create: jest.fn().mockResolvedValue({ id: 'new-id' }),
  update: jest.fn().mockResolvedValue({}),
  get: jest.fn().mockResolvedValue({ attributes: { title: 'Test', sourceCode: 'code' } }),
  find: jest.fn().mockResolvedValue({
    savedObjects: [{ id: 'app-1', attributes: { title: 'App 1' } }],
  }),
  delete: jest.fn().mockResolvedValue({}),
});

describe('AppSavedObjectClient', () => {
  it('creates a new saved object when no id is provided', async () => {
    const mock = createMockClient();
    const client = new AppSavedObjectClient(mock as any);
    const id = await client.save({ title: 'New App', sourceCode: 'code' });
    expect(id).toBe('new-id');
    expect(mock.create).toHaveBeenCalledWith(
      SAVED_OBJECT_TYPE,
      expect.objectContaining({ title: 'New App', createdAt: expect.any(String) })
    );
  });

  it('updates an existing saved object when id is provided', async () => {
    const mock = createMockClient();
    const client = new AppSavedObjectClient(mock as any);
    const id = await client.save({ title: 'Updated' }, 'existing-id');
    expect(id).toBe('existing-id');
    expect(mock.update).toHaveBeenCalledWith(
      SAVED_OBJECT_TYPE,
      'existing-id',
      expect.objectContaining({ title: 'Updated', updatedAt: expect.any(String) })
    );
  });

  it('loads attributes for a given id', async () => {
    const mock = createMockClient();
    const client = new AppSavedObjectClient(mock as any);
    const attrs = await client.load('app-1');
    expect(attrs.title).toBe('Test');
    expect(mock.get).toHaveBeenCalledWith(SAVED_OBJECT_TYPE, 'app-1');
  });

  it('lists all osd-app saved objects', async () => {
    const mock = createMockClient();
    const client = new AppSavedObjectClient(mock as any);
    const apps = await client.list();
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe('app-1');
  });

  it('removes a saved object by id', async () => {
    const mock = createMockClient();
    const client = new AppSavedObjectClient(mock as any);
    await client.remove('app-1');
    expect(mock.delete).toHaveBeenCalledWith(SAVED_OBJECT_TYPE, 'app-1');
  });
});
