import { getQueue, socket } from '@/api'
import { apiBase } from '@/api/core/base'
import { FileModel } from '@/database'
import { useStatusStore } from '@/store'

export default function useExecute(parentid: string) {
  const running = ref(false)
  const progress = ref(0)
  const previewImage = ref<string>()
  const statusStore = useStatusStore()
  let interruptFunc: (() => void) | null = null

  function onInterrupt() {
    if (interruptFunc) {
      interruptFunc()
    }
  }

  onMounted(() => {
    socket.addEventListener(
      'status',
      ({ detail }: { detail: { exec_info: { queue_remaining: number } } }) => {
        if (detail && detail.exec_info?.queue_remaining === 0) {
        }
      }
    )

    socket.addEventListener(
      'progress',
      ({
        detail,
      }: {
        detail: {
          max: number
          node: string
          value: number
          prompt_id: string
        }
      }) => {
        running.value = true
        progress.value = Math.floor((detail.value / detail.max) * 100)

        try {
        } catch (error) {}
      }
    )

    socket.addEventListener('execution_start', async ({ detail }: any) => {
      console.log('execution_start', detail)
      running.value = true

      try {
        const { Running } = await getQueue(statusStore.clientID)
        interruptFunc = Running && Running[0] ? Running[0].remove : null
      } catch (error) {
        interruptFunc = null
      }
    })

    socket.addEventListener(
      'b_preview',
      async ({ detail }: { detail: Blob }) => {
        previewImage.value = URL.createObjectURL(detail)
      }
    )

    socket.addEventListener('executing', ({ detail }: any) => {
      console.log('executing', detail)
      if (detail === null) {
        running.value = false
      }
    })

    socket.addEventListener('executed', async ({ detail }: any) => {
      console.log('executed', detail)
      const nodeId = detail.node
      const output = detail.output
      const images = output?.images
      const text = output?.text
      const gifs = output?.gifs

      const prompt = output?.prompt
      const analysis = output?.analysis

      const _images = output?._images
      const prompts = output?.prompts

      if (images) {
        const urls = Array.from(
          images,
          (img: { filename: string; type: string; subfolder: string }) => {
            const urlPath = `/view?filename=${encodeURIComponent(
              img.filename
            )}&type=${img.type}&subfolder=${encodeURIComponent(
              img.subfolder
            )}&t=${+new Date()}`

            saveAppFile({
              name: img.filename,
              type: 'image',
              data: urlPath,
              metadata: { type: img.type, subfolder: img.subfolder },
            })

            return `${apiBase}${urlPath}`
          }
        )
        useEventBus<string[]>(`ImagePreview::Show::${nodeId}`).emit(urls)
      } else if (_images && prompts) {
        const items: [string, string?][] = []
        Array.from(_images, (imgs: any, i) => {
          for (const img of imgs) {
            const urlPath = `/view?filename=${encodeURIComponent(
              img.filename
            )}&type=${img.type}&subfolder=${encodeURIComponent(
              img.subfolder
            )}&t=${+new Date()}`

            saveAppFile({
              name: img.filename,
              type: 'image',
              data: urlPath,
              metadata: { type: img.type, subfolder: img.subfolder },
            })

            items.push([`${apiBase}${urlPath}`, prompts[i]])
          }
        })
        useEventBus<[string, string?][]>(`ImagePrompt::Show::${nodeId}`).emit(
          items
        )
      } else if (text) {
        const t = Array.isArray(text) ? text.join('\n\n') : text
        useEventBus<string>(`OutputText::Show::${nodeId}`).emit(t)
      } else if (gifs && gifs[0]) {
        const urlPath = `/view?filename=${encodeURIComponent(
          gifs[0].filename
        )}&type=${gifs[0].type}&subfolder=${encodeURIComponent(
          gifs[0].subfolder
        )}&&format=${gifs[0].format}&t=${+new Date()}`

        const url = `${apiBase}${urlPath}`
        const type = gifs[0].format.match('video') ? 'video' : 'image'

        saveAppFile({
          name: gifs[0].filename,
          type,
          data: urlPath,
          metadata: { type: gifs[0].format, subfolder: gifs[0].subfolder },
        })

        useEventBus<{ url: string; type: 'video' | 'image' }>(
          `GifPreview::Show::${nodeId}`
        ).emit({ url, type })
      } else if (prompt && analysis) {
        const t = `${prompt.join('\n\n')}\n${JSON.stringify(analysis, null, 2)}`
        useEventBus<string>(`OutputText::Show::${nodeId}`).emit(t)
      }

      try {
        const { Running } = await getQueue(statusStore.clientID)
        if (Running && Running[0]) {
          interruptFunc = Running[0].remove
          running.value = true
        } else {
          interruptFunc = null
        }
      } catch (e) {
        interruptFunc = null
      }
    })

    socket.addEventListener('execution_cached', ({ detail }: any) => {
      console.log('execution_cached', detail)
    })

    socket.addEventListener('execution_error', ({ detail }: any) => {
      console.log('execution_error', detail)
      toast.error(detail)
    })
  })

  function saveAppFile(d: {
    name: string
    type: string
    data: string
    metadata: any
  }) {
    FileModel.create({
      ...d,
      size: 0,
      parentid,
    })
  }

  return {
    running,
    progress,
    previewImage,
    onInterrupt,
  }
}
