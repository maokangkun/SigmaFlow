import { BaseModel } from '../core/model'
import { ComfyDB_FlowApp } from '../core/schema'

class _FlowAppModel extends BaseModel<'app'> {
  constructor() {
    super('app')
  }

  async create(
    app: Pick<ComfyDB_FlowApp, 'name' | 'description' | 'data' | 'flowid'>
  ) {
    // 查询同 flowid 的 app, 如果有, 则读取 version, 否则 version 为 1
    const apps = await this.findByFlowId(app.flowid)
    const version = apps.length
      ? Math.max(...apps.map((x) => x.version)) + 1
      : 1
    return this._add({ ...app, version })
  }

  async findById(id: string) {
    const app = await this.table.get(id)
    app.thumbnail = await this.findThumbnail(app.flowid, app.thumbnail)
    return app
  }

  async query({ folderId, keyword }: { folderId?: string; keyword?: string }) {
    let apps = []
    if (folderId) {
      apps = await this.table.where('folder').equals(folderId).toArray()
    } else {
      apps = await this.table.toArray()
    }

    if (keyword) {
      apps = apps.filter((app) => {
        return (
          app.name.includes(keyword) ||
          (app.description && app.description.includes(keyword))
        )
      })
    }
    apps = apps.sort((a, b) => b.updatetime - a.updatetime)
    for (const app of apps) {
      const thumbnail = await this.findThumbnail(app.id, app.thumbnail)
      app.thumbnail = thumbnail
    }

    return apps
  }

  async findByFlowId(id: string): Promise<ComfyDB_FlowApp[]> {
    return (await this.table.where('flowid').equals(id).toArray()).sort(
      (a, b) => b.updatetime - a.updatetime
    )
  }

  async findLatestByFlowId(id: string): Promise<ComfyDB_FlowApp | null> {
    const apps = await this.findByFlowId(id)
    return apps[0]
  }

  async updateData(id: string, data: any) {
    return this.table.update(id, { data })
  }

  async updateConfigs(id: string, configs: Record<string, any>) {
    return this.table.update(id, { configs })
  }

  async delete(id: string) {
    return this.table.delete(id)
  }

  async clear() {
    return this.table.clear()
  }

  async findThumbnail(appid: string, fileid?: string) {
    if (fileid) {
      return await this.db.files.get(fileid)
    } else {
      const files = await this.db.files
        .where('parentid')
        .equals(appid)
        .toArray()
      return files.sort((a, b) => b.createtime - a.createtime)[0]
    }
  }
}

export const FlowAppModel = new _FlowAppModel()
