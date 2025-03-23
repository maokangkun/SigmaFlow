import { socket } from '@/api'
import { useStatusStore } from '@/store'

export default function useSocket() {
  const statusStore = useStatusStore()

  function socketInit() {
    socket.init()

    socket.addSocketEventListener('message', (e: any) => {
      try {
        if (!(e.data instanceof ArrayBuffer)) {
          const msg = JSON.parse(e.data)
          if (msg.type === 'status' && msg.data.sid) {
            statusStore.clientID = msg.data.sid
          }
        }
      } catch (error) {
        console.warn('WebSocket 消息处理失败', e.data, error)
      }
    })

    socket.addEventListener('status', (e: any) => {
      statusStore.info = e.detail
      statusStore.reconnecting = false
    })

    socket.addEventListener('reconnecting', () => {
      console.log('reconnecting')
      statusStore.reconnecting = true
    })

    socket.addEventListener('reconnected', () => {
      console.log('reconnected')
      statusStore.reconnecting = false
    })

    socket.addEventListener('progress', (e: any) => {
      statusStore.progress = e.detail
    })

    socket.addEventListener('executing', (e: any) => {
      statusStore.progress = null
      statusStore.runningNodeId = e.detail
    })

    socket.addEventListener('executed', (e: any) => {
      if (statusStore.nodeExecuted == null) statusStore.nodeExecuted = []
      const index = statusStore.nodeExecuted.findIndex(
        (item) => item.node === e.detail.node
      )
      if (index === -1) {
        statusStore.nodeExecuted.push(e.detail)
      } else {
        statusStore.nodeExecuted[index] = e.detail
      }
      statusStore.nodePreviewImages = null
    })

    socket.addEventListener('execution_start', () => {
      statusStore.runningNodeId = null
      statusStore.lastExecutionError = null
      statusStore.nodePreviewImages = {}
    })

    socket.addEventListener('execution_interrupted', () => {
      statusStore.runningNodeId = null
      statusStore.lastExecutionError = null
      statusStore.nodePreviewImages = null
    })

    socket.addEventListener('execution_error', (e: any) => {
      statusStore.lastExecutionError = e.detail
    })

    socket.addEventListener('b_preview', (e: any) => {
      const id = statusStore.runningNodeId
      if (id == null) return

      const blobUrl = URL.createObjectURL(e.detail)
      statusStore.nodePreviewImages![id] = [blobUrl]
    })
  }

  return { socketInit }
}
