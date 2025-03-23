import { BaseModel } from '../core/model'
import { ComfyDB_Tag } from '../core/schema'

class _TagModel extends BaseModel {
  constructor() {
    super('tags')
  }

  async create(tag: ComfyDB_Tag) {
    return this._add(tag)
  }

  async findById(id: string) {
    return this.table.get(id)
  }

  async update(id: string, tag: Partial<ComfyDB_Tag>) {
    return this._update(id, tag)
  }

  async delete(id: string) {
    return this.table.delete(id)
  }

  async clear() {
    return this.table.clear()
  }
}

export const TagModel = new _TagModel()
