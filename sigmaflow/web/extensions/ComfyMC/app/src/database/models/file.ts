import { BaseModel } from '../core/model'
import { ComfyDB_File } from '../core/schema'

class _FileModel extends BaseModel<'files'> {
  constructor() {
    super('files')
  }

  async create(
    file: Pick<
      ComfyDB_File,
      'name' | 'size' | 'type' | 'data' | 'metadata' | 'parentid'
    >
  ) {
    return this._add(file)
  }

  async findById(id: string) {
    return this.table.get(id)
  }

  async findByParentId(parentid: string) {
    return (await this.table.where({ parentid }).toArray()).sort(
      (a, b) => b.updatetime - a.updatetime
    )
  }

  async delete(id: string) {
    return this.table.delete(id)
  }

  async clear() {
    return this.table.clear()
  }
}

export const FileModel = new _FileModel()
