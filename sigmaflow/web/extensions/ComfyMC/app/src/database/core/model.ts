import { v4 as uuid } from 'uuid'
import { Table } from 'dexie'
import { ComfyDB, ComfyDBInstance } from './db'
import { ComfyDBSchema } from './schema'

export class BaseModel<
  T extends keyof ComfyDBSchema = any,
  K = ComfyDBSchema[T]['table']
> {
  protected db: ComfyDB
  private readonly _tablename: keyof ComfyDBSchema

  constructor(table: T, db = ComfyDBInstance) {
    this.db = db
    this._tablename = table
  }

  get table() {
    return this.db[this._tablename] as Table
  }

  protected async _add<K = ComfyDBSchema[T]['model']>(
    data: K,
    id: string | number = uuid()
  ) {
    const tablename = this._tablename
    const record: any = {
      ...data,
      id,
      createtime: Date.now(),
      updatetime: Date.now(),
    }

    const newId = await this.db[tablename].add(record)
    return { id: newId }
  }

  protected async _update(id: string, data: Partial<K>) {
    const result = await this.table.update(id, {
      ...data,
      updatetime: Date.now(),
    })

    return { result }
  }
}
