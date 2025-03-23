import {
  ComfyDB_File,
  ComfyDB_Flow,
  ComfyDB_FlowApp,
  ComfyDB_Folder,
} from '@/database/core/schema'
import { serializedLGraph } from './litegraph'
import { IComfy } from './IComfy'

export interface IFlow extends ComfyDB_Flow {
  id: string
  name: string
  description?: string
  data: serializedLGraph
  metadata?: any
  folder?: string
  tags?: string[]
  thumbnail?: ComfyDB_File
  createtime: number
  updatetime: number
}

export interface IFlowApp extends ComfyDB_FlowApp {
  id: string
  name: string
  data: any
  flowid: string
  version: number
  folder?: string
  configs?: Record<string, any>
  thumbnail?: ComfyDB_File
  description?: string
  createtime: number
  updatetime: number
}

export interface IFolder extends ComfyDB_Folder {
  id: string
  name: string
  description?: string
  createtime: number
  updatetime: number
}

export interface IFlowAppData {
  title: string
  description: string
  inputs: IFlowAppInput[]
  outputs: IComfy.AppGraphPromptNode[]
}

export interface IFlowAppInput {
  nodeId: number
  title: string
  name: string
  type: string
  value: any
  options: any
}
