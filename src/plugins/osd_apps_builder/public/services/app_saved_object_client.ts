/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedObjectsClientContract } from '../../../../core/public';
import { SAVED_OBJECT_TYPE } from '../../common/constants';
import { OsdAppAttributes } from '../../common/types';

export class AppSavedObjectClient {
  constructor(private savedObjectsClient: SavedObjectsClientContract) {}

  async save(attrs: Partial<OsdAppAttributes>, id?: string): Promise<string> {
    const now = new Date().toISOString();
    const attributes = {
      ...attrs,
      updatedAt: now,
      ...(id ? {} : { createdAt: now, version: 1 }),
    };

    if (id) {
      await this.savedObjectsClient.update(SAVED_OBJECT_TYPE, id, attributes);
      return id;
    }

    const result = await this.savedObjectsClient.create(SAVED_OBJECT_TYPE, attributes);
    return result.id;
  }

  async load(id: string): Promise<OsdAppAttributes> {
    const result = await this.savedObjectsClient.get<OsdAppAttributes>(SAVED_OBJECT_TYPE, id);
    return result.attributes;
  }

  async list(): Promise<Array<{ id: string; attributes: OsdAppAttributes }>> {
    const result = await this.savedObjectsClient.find<OsdAppAttributes>({
      type: SAVED_OBJECT_TYPE,
      perPage: 1000,
      sortField: 'updatedAt',
      sortOrder: 'desc',
    });
    return result.savedObjects.map((obj) => ({ id: obj.id, attributes: obj.attributes }));
  }

  async remove(id: string): Promise<void> {
    await this.savedObjectsClient.delete(SAVED_OBJECT_TYPE, id);
  }
}
