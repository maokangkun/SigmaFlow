import { BaseModel } from '../core/model'
import { ComfyDB_Flow } from '../core/schema'

class _FlowModel extends BaseModel {
  constructor() {
    super('flows')
  }

  async create({
    name,
    description,
    data,
    folder,
    tags,
  }: Pick<ComfyDB_Flow, 'name' | 'description' | 'data' | 'folder' | 'tags'>) {
    const flow = await this._add({
      name,
      description,
      data,
      folder: folder ?? '',
      tags: tags ?? [],
      metadata: {},
    })

    return flow
  }

  async findById(id: string) {
    const flow = await this.table.get(id)
    flow.thumbnail = await this.findThumbnail(flow.id, flow.thumbnail)
    return flow
  }

  async query({
    folderId,
    tagIds,
    keyword,
  }: {
    folderId?: string
    tagIds?: string[]
    keyword?: string
  }) {
    let flows = []
    if (tagIds) {
      if (folderId) {
        flows = await this.table
          .where('folder')
          .equals(folderId)
          .and((flow) => tagIds.every((tagId) => flow.tags.includes(tagId)))
          .toArray()
      } else {
        flows = await this.table
          .filter((flow) => tagIds.every((tagId) => flow.tags.includes(tagId)))
          .toArray()
      }
    } else {
      if (folderId) {
        flows = await this.table.where('folder').equals(folderId).toArray()
      } else {
        flows = await this.table.toArray()
      }
    }

    if (keyword) {
      flows = flows.filter((flow) => {
        return (
          flow.name.includes(keyword) ||
          (flow.description && flow.description.includes(keyword))
        )
      })
    }

    flows = flows.sort((a, b) => b.updatetime - a.updatetime)
    for (const flow of flows) {
      const thumbnail = await this.findThumbnail(flow.id, flow.thumbnail)
      flow.thumbnail = thumbnail
    }

    return flows
  }

  async update(
    id: string,
    data: {
      name?: string
      description?: string
      data?: any
      folder?: string
      tags?: string[]
    }
  ) {
    return this._update(id, data)
  }

  async delete(id: string) {
    return this.table.delete(id)
  }

  async clear() {
    return this.table.clear()
  }

  async findThumbnail(flowid: string, fileid?: string) {
    if (fileid) {
      return await this.db.files.get(fileid)
    } else {
      const files = await this.db.files
        .where('parentid')
        .equals(flowid)
        .toArray()
      return files.sort((a, b) => b.createtime - a.createtime)[0]
    }
  }
}

export const FlowModel = new _FlowModel()
