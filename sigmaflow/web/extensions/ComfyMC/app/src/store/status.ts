import { defineStore } from 'pinia'

export const useStatusStore = defineStore<
  'status',
  {
    clientID: string | null
    info: {
      exec_info: { queue_remaining: number }
    }
    progress: { value: number; max: number } | null
    nodeExecuted:
      | {
          node: string
          output: {
            images: {
              filename: string
              subfolder: string
              type: string
            }[]
          }
        }[]
      | null
    nodePreviewImages: Record<string, string[]> | null
    runningNodeId: string | null
    lastExecutionError: string | null
    reconnecting: boolean

    lastNodeErrors: any

    currentFlowId: string | null
    currentFlowName: string | null

    handleErrorMessage: { id: string; message: string }[]
  },
  {},
  {
    resetCurrentFlow(): void
    clearHandleErrorMessage(): void
  }
>('status', {
  state() {
    return {
      clientID: null,
      info: { exec_info: { queue_remaining: 0 } },
      progress: null,
      nodeExecuted: null,
      runningNodeId: null,
      nodePreviewImages: {},
      lastExecutionError: null,
      reconnecting: false,

      lastNodeErrors: null,
      currentFlowId: null,
      currentFlowName: null,

      handleErrorMessage: [],
    }
  },
  actions: {
    resetCurrentFlow() {
      this.currentFlowId = null
      this.currentFlowName = null
    },
    clearHandleErrorMessage() {
      this.handleErrorMessage = []
    },
  },
})
