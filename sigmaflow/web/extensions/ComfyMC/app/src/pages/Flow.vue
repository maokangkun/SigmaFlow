<template>
  <main class="editor">
    <TopBar v-if="flow" :flow="flow" @on-menu-click="onMenuClick" />
    <ActionBar
      v-if="flow"
      :flowid="flowId"
      @on-action-click="onActionClick"
      @on-make-app-click="onMakeAppClick"
    />
    <section class="editor-container">
      <iframe ref="iframeRef" :class="{ loading }" :src="apiBase" />
      <div
        v-if="loading"
        class="absolute inset-0 flex items-center justify-center z-50"
      >
        <Loader2 :size="30" class="animate-spin" />
      </div>
    </section>

    <RenameDialog
      v-if="flow"
      :flow="flow"
      v-model:dialog-open="renameOpen"
      @onUpdate="onRenamed"
    />
    <MakeAppDialog
      v-if="appPrompt && flow"
      :flow="flow"
      :prompt="appPrompt"
      v-model:open="appDialogOpen"
    />
  </main>
</template>

<script setup lang="ts">
import { IFlow } from '@/types/IFlow'
import { IComfy } from '@/types/IComfy'
import { FileModel, FlowModel } from '@/database'
import { Loader2 } from 'lucide-vue-next'
import { voidGraph } from '@/lib/defaultGraph'
import { IMenuMessageType, IActionMessageType } from '@/types/IMessage'
import { apiBase } from '@/api/core/base'

const iframeLoading = ref(true)
const promptLoading = ref(true)
const loading = computed(
  () => iframeLoading.value || promptLoading.value || !flow.value
)

const iframeRef = ref<HTMLIFrameElement | null>(null)
const graphMoving = ref(false)

watch(graphMoving, (v) => {
  if (v) {
    document.body.classList.add('graph-moving')
  } else {
    document.body.classList.remove('graph-moving')
  }
})

const route = useRoute()
const flowId = route.params.id as string
const flow = ref<IFlow | null | undefined>(null)
async function onLoadFlow() {
  flow.value = await FlowModel.findById(flowId)
  const prompt = JSON.parse(
    JSON.stringify(flow.value ? flow.value.data : voidGraph)
  )
  postIframeMessage({
    type: 'load-prompt',
    payload: { prompt },
  })
}

function onMenuClick(type: IMenuMessageType) {
  if (!iframeRef.value) return
  switch (type) {
    case 'arrange':
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset':
    case 'editor-settings':
    case 'undo':
    case 'redo':
    case 'clear':
    case 'export':
    case 'import':
      postIframeMessage({ type })
      break

    case 'rename':
      onRename()
      break
    case 'set-thumb':
      onSetThumb()
      break
    case 'save-template':
      onSaveTemplate()
      break
  }
}

function onActionClick(type: IActionMessageType) {
  if (!iframeRef.value) return
  switch (type) {
    case 'queue-prompt':
    case 'open-manager':
      postIframeMessage({ type })
      break

    case 'open-console':
      onOpenConsole()
      break
  }
}

async function onIframeLoad(e: MessageEvent) {
  const data = e.data
  if (data.type === 'loaded') {
    await onLoadFlow()

    setTimeout(() => {
      iframeLoading.value = false
    }, 300)

    window.removeEventListener('message', onIframeLoad)
  }
}

function unBindIframe() {
  window.removeEventListener('message', onIframeLoad)
  window.removeEventListener('message', onMessage)
}

const messageHandles: {
  [key: string]: (...args: any[]) => void
} = {
  'got-prompt': (prompt: IComfy.AppGraphPrompt) => {
    appPrompt.value = prompt
  },
  'prompt-gen-error': (error: string) => {
    console.log(error)
  },
  'download-prompt': (workflow: any) => {
    console.log(workflow)
  },
  'prompt-loaded': () => {
    promptLoading.value = false
  },
  'prompt-load-error': () => {
    console.log()
  },
  'graph-data': (data: any) => {
    if (flow.value) flow.value.data = data
    FlowModel.update(flowId, { data })
  },
  'missing-nodes': (nodes: any[]) => {
    console.log(nodes)
  },
  'graphcanvas-mousedown': () => {
    graphMoving.value = true
  },
  'graphcanvas-mouseup': () => {
    graphMoving.value = false
  },
  // **** Socket Events ****
  'socket-status': (status: any) => {
    console.log('socket-status', status)
  },
  'socket-progress': (progress: any) => {
    console.log('progress', progress)
  },
  'socket-execution_start': (detail: any) => {
    console.log('socket-execution_start', detail)
  },
  'socket-executing': (detail: any) => {
    console.log('socket-executing', detail)
  },
  'socket-b_preview': (detail: any) => {
    console.log('socket-b_preview', detail)
  },
  'socket-executed': (detail: any) => {
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
  },
}
function onMessage(e: MessageEvent) {
  const data = e.data
  if (data.from === 'comfymc') {
    const { type, payload } = data
    const handle = messageHandles[type]
    if (handle) {
      handle(payload)
    }
  }
}

function postIframeMessage(data: { type: string; payload?: any }) {
  if (!iframeRef.value) return
  iframeRef.value.contentWindow?.postMessage({ internal: data }, '*')
}

const renameOpen = ref(false)
function onRename() {
  renameOpen.value = true
}
function onRenamed(name: string, description: string) {
  if (flow.value) {
    flow.value.name = name
    flow.value.description = description
  }
}

const appPrompt = ref<IComfy.AppGraphPrompt>()
const appDialogOpen = ref(false)
function onMakeAppClick() {
  postIframeMessage({ type: 'get-prompt' })
  appDialogOpen.value = true
}

function onSetThumb() {}

function onSaveTemplate() {}

function onOpenConsole() {}

onMounted(async () => {
  window.addEventListener('message', onIframeLoad)
  window.addEventListener('message', onMessage)
})
onBeforeUnmount(() => unBindIframe())

function saveAppFile(d: {
  name: string
  type: string
  data: string
  metadata: any
}) {
  FileModel.create({
    ...d,
    size: 0,
    parentid: flowId,
  })
}
</script>

<style lang="scss">
main.editor {
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
}
.editor-container {
  width: 100vw;
  height: 100vh;
  iframe {
    width: 100%;
    height: 100%;
    opacity: 1;
    transition: opacity 0.6s;

    &.loading {
      opacity: 0;
    }
  }
}

body.graph-moving *:not(#app, .editor, .editor-container, iframe) {
  pointer-events: none;
}
</style>
