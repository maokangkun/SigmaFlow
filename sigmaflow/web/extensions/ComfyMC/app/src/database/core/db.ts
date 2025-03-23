import Dexie, { Table } from 'dexie'
import {
  ComfyDB_Flow,
  ComfyDB_File,
  ComfyDB_Folder,
  ComfyDB_Tag,
  ComfyDB_FlowApp,
  dbSchemaV1,
} from './schema'

export class ComfyDB extends Dexie {
  flows!: Table<ComfyDB_Flow>
  files!: Table<ComfyDB_File>
  folders!: Table<ComfyDB_Folder>
  tags!: Table<ComfyDB_Tag>
  app!: Table<ComfyDB_FlowApp>

  constructor() {
    super('ComfyDB')
    this.version(1).stores(dbSchemaV1)
  }
}

export const ComfyDBInstance = new ComfyDB()
