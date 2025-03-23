import { IComfy } from '@/types/IComfy'
import { fetchApi } from './base'

/**
 * 获取 Extensions 的 path 列表
 * @returns Extensions 脚本的 path 列表
 */
export async function getExtensions() {
  const res = await fetchApi('/extensions', { cache: 'no-store' })
  return await res.json()
}

/**
 * 获取 Embedding 的名称列表
 */
export async function getEmbeddings(): Promise<string[]> {
  const res = await fetchApi('/embeddings', { cache: 'no-store' })
  return await res.json()
}

/**
 * 获取 Node 的定义信息
 */
export async function getNodeDefs(): Promise<{
  [key: string]: IComfy.NodeDef
}> {
  const res = await fetchApi('/object_info', { cache: 'no-store' })
  return await res.json()
}

/**
 * 获取系统信息
 * @returns 获取系统信息: python 版本/OS/显存/显卡 等
 */
export async function getSystemStats() {
  const res = await fetchApi('/system_stats')
  return await res.json()
}
