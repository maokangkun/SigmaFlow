import { fetchApi } from './base'

/**
 *
 * @param clientId Websocket 的 clientId
 * @param number 需要排队的号码，-1 则将 prompt 插入到队列最前，其他数字为指定排队号码
 * @param prompt 队列的 prompt 信息
 * @returns
 */
export async function queuePrompt(
  clientId: string,
  prompt: { output: any; workflow: any },
  number?: number
) {
  const body: {
    client_id: string
    prompt: any
    extra_data: { extra_pnginfo: { workflow: any } }
    front?: boolean
    number?: number
  } = {
    client_id: clientId,
    prompt: prompt.output,
    extra_data: { extra_pnginfo: { workflow: prompt.workflow } },
  }

  if (number === -1) {
    body.front = true
  } else if (number != 0) {
    body.number = number
  }

  const res = await fetchApi('/prompt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.status !== 200) {
    throw {
      response: await res.json(),
    }
  }

  return await res.json()
}

interface IResponseQueueItem {
  Running: any[]
  Pending: any[]
}
interface IResponseHistoryItem {
  History: any[]
}
/**
 * 加载队列或历史记录的列表
 * @param type 队列类型，queue 或 history
 * @returns 队列列表
 */
export async function getItems(type: 'history'): Promise<IResponseHistoryItem>
export async function getItems(type: 'queue'): Promise<IResponseQueueItem>
export async function getItems(type: 'queue' | 'history') {
  if (type === 'queue') {
    return getQueue()
  }
  return getHistory()
}

/**
 *  获取当前运行的 prompt 和队列中的 prompt
 * @returns  Running: 当前运行的 prompt 列表，Pending: 队列中的 prompt 列表
 */
export async function getQueue(
  clientId?: string | null
): Promise<IResponseQueueItem> {
  try {
    const res = await fetchApi('/queue')
    const data = await res.json()

    const Pending = data.queue_pending.map((prompt: any) => ({ prompt }))
    const Running = clientId
      ? Array.from(data.queue_running, (prompt: any) => {
          if (prompt[3].client_id === clientId) {
            return {
              prompt_id: prompt[1],
              remove: () => interrupt(),
            }
          }
        })
      : data.queue_running.map((prompt: any) => ({
          prompt_id: prompt[1],
          remove: () => interrupt(),
        }))

    return { Running, Pending }
  } catch (error) {
    console.error(error)
    return { Running: [], Pending: [] }
  }
}

/**
 * 获取 Prompt 的运行历史记录
 * @returns Prompt 历史记录
 */
export async function getHistory(): Promise<IResponseHistoryItem> {
  try {
    const res = await fetchApi('/history')
    return { History: Object.values(await res.json()) }
  } catch (error) {
    console.error(error)
    return { History: [] }
  }
}

/**
 * 向指定的 endpoint 发送 POST 请求
 * @param type path
 * @param body 可选请求体
 */
export async function postItem(type: string, body?: any) {
  try {
    await fetchApi('/' + type, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    console.error(error)
  }
}

/**
 * 删除指定的 item
 * @param type 队列类型，queue 或 history
 * @param id 需要删除的 item 的 id
 */
export async function deleteItem(type: string, id: number) {
  await postItem(type, { delete: [id] })
}

/**
 * 清空指定类型的列表
 * @param type 队列类型，queue 或 history
 */
export async function clearItems(type: string) {
  await postItem(type, { clear: true })
}

/**
 * 中断当前运行的 prompt
 */
export async function interrupt() {
  await postItem('interrupt', null)
}
