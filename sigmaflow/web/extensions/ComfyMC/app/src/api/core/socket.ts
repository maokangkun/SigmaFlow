import { apiHost, apiProtocol, fetchApi } from './base'

class ComfySocket extends EventTarget {
  clientId = ''
  socket: WebSocket | null = null
  #registered = new Set()
  constructor() {
    super()
  }

  addEventListener(
    type: string,
    callback: any | null,
    options?: boolean | AddEventListenerOptions | undefined
  ): void {
    super.addEventListener(type, callback, options)
    this.#registered.add(type)
  }

  addSocketEventListener(
    type: string,
    callback: any | null,
    options?: boolean | AddEventListenerOptions | undefined
  ): void {
    if (!this.socket) {
      throw new Error('WebSocket 未初始化')
    }
    this.socket.addEventListener(type, callback, options)
  }

  /**
   * 在没有 WebSocket 的场景下轮询
   */
  #pollQueue() {
    setInterval(async () => {
      try {
        const res = await fetchApi('/prompt')
        const status = await res.json()
        this.dispatchEvent(new CustomEvent('status', { detail: status }))
      } catch (error) {
        this.dispatchEvent(new CustomEvent('status', { detail: null }))
      }
    }, 1000)
  }

  /**
   * 创建 WebSocket 连接
   */
  #createSocket(isReconnect: boolean) {
    if (this.socket) {
      return
    }

    let opened = false
    let existingSession = window.name
    if (existingSession) {
      existingSession = `?clientId=${existingSession}`
    }

    this.socket = new WebSocket(
      `ws${
        apiProtocol === 'https:' ? 's' : ''
      }://${apiHost}/ws${existingSession}`
    )
    this.socket.binaryType = 'arraybuffer'

    this.socket.addEventListener('open', () => {
      opened = true
      if (isReconnect) {
        this.dispatchEvent(new CustomEvent('reconnect'))
      }
    })

    this.socket.addEventListener('error', () => {
      if (this.socket) this.socket.close()
      if (!isReconnect && !opened) {
        this.#pollQueue()
      }
    })

    this.socket.addEventListener('close', () => {
      setTimeout(() => {
        this.socket = null
        this.#createSocket(true)
      }, 300)

      if (opened) {
        this.dispatchEvent(new CustomEvent('status', { detail: null }))
        this.dispatchEvent(new CustomEvent('reconnecting'))
      }
    })

    this.socket.addEventListener('message', (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data)
          const eventType = view.getUint32(0)
          const buffer = event.data.slice(4)
          switch (eventType) {
            case 1:
              const view2 = new DataView(event.data)
              const imageType = view2.getUint32(0)
              let imageMime
              switch (imageType) {
                case 1:
                default:
                  imageMime = 'image/jpeg'
                  break
                case 2:
                  imageMime = 'image/png'
              }
              const imageBlob = new Blob([buffer.slice(4)], { type: imageMime })
              this.dispatchEvent(
                new CustomEvent('b_preview', { detail: imageBlob })
              )
              break
            default:
              throw new Error(`未知的二进制数据类型：${eventType}`)
          }
        } else {
          const msg = JSON.parse(event.data)
          switch (msg.type) {
            case 'status':
              if (msg.data.sid) {
                this.clientId = msg.data.sid
                window.name = this.clientId
              }
              this.dispatchEvent(
                new CustomEvent('status', { detail: msg.data.status })
              )
              break
            case 'executing':
              this.dispatchEvent(
                new CustomEvent('executing', { detail: msg.data.node })
              )
              break
            case 'executed':
            case 'execution_start':
            case 'execution_error':
            case 'execution_cached':
            case 'progress':
              this.dispatchEvent(
                new CustomEvent(msg.type, { detail: msg.data })
              )
              break
            default:
              if (this.#registered.has(msg.type)) {
                this.dispatchEvent(
                  new CustomEvent(msg.type, { detail: msg.data })
                )
              } else {
                throw new Error(`未知的消息类型：${msg.type}`)
              }
          }
        }
      } catch (error) {
        console.warn('WebSocket 消息处理失败', event.data, error)
      }
    })
  }

  /**
   * 初始化 WebSocket
   */
  init() {
    this.#createSocket(false)
  }
}

export const socket = new ComfySocket()
