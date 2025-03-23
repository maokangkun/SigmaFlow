import type { Table } from 'dexie'

export interface ComfyDB_Flow {
  id: string
  name: string
  description?: string
  data: any
  metadata?: any
  folder?: string
  tags?: string[]
  thumbnail?: string
  createtime: number
  updatetime: number
}

export interface ComfyDB_Folder {
  id: string
  name: string
  type?: 'app' | 'flow'
  description?: string
  createtime: number
  updatetime: number
}

export interface ComfyDB_Tag {
  id: string
  name: string
  description?: string
  createtime: number
  updatetime: number
}

export interface ComfyDB_File {
  id: string
  name: string
  size: number
  type: string
  data: any
  metadata?: any
  parentid: string
  createtime: number
}

export interface ComfyDB_FlowApp {
  id: string
  name: string
  data: any
  flowid: string
  version: number
  folder?: string
  thumbnail?: string
  configs?: Record<string, any>
  description?: string
  createtime: number
  updatetime: number
}

export interface ComfyDBSchemaMap {
  app: ComfyDB_FlowApp
  flows: ComfyDB_Flow
  files: ComfyDB_File
  folders: ComfyDB_Folder
  tags: ComfyDB_Tag
}

export type ComfyDBSchema = {
  [K in keyof ComfyDBSchemaMap]: {
    model: ComfyDBSchemaMap[K]
    table: Table<ComfyDBSchemaMap[K], string>
  }
}

export type ComfyDBTable<T extends keyof ComfyDBSchemaMap> =
  ComfyDBSchema[T]['table']

// ******* DB Schema V1 *******
export const dbSchemaV1 = {
  flows:
    '&id, title, description, data, folder, tags, metadata, thumbnail, createtime, updatetime',
  files: '&id, name, size, type, data, metadata, parentid, createtime',
  folders: '&id, name, description, createtime, updatetime',
  tags: '&id, name, description, createtime, updatetime',
  app: '&id, name, data, flowid, folder, description, thumbnail, configs, createtime, updatetime',
}
