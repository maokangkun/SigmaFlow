import { BaseModel } from '../core/model'
import { ComfyDB_Folder } from '../core/schema'

class _FolderModel extends BaseModel {
  constructor() {
    super('folders')
  }

  async create(folder: Pick<ComfyDB_Folder, 'name' | 'description'>) {
    return this._add(folder)
  }

  async findById(id: string) {
    return this.table.get(id)
  }

  async update(id: string, folder: Partial<ComfyDB_Folder>) {
    return this._update(id, folder)
  }

  async queryAll() {
    return this.table.toArray()
  }

  async delete(id: string) {
    return this.table.delete(id)
  }

  async clear() {
    return this.table.clear()
  }
}

export const FolderModel = new _FolderModel()
