<template>
  <main v-if="app && data">
    <Header :title="app.name" :show-back="true" @back="router.back()" />
    <section class="w-full h-[calc(100vh-64px)] flex">
      <FlowAppInputs :inputs="inputs" />
      <FlowAppOutputNodes :nodes="outputs" />
    </section>
    <PreviewImage :url="previewImage" :running="running" />
    <ProgressBar :progress="progress" :running="running" />
    <FlowAppActions
      :flow-id="app.flowid"
      :app-id="appId"
      :running="running"
      @on-app-run="onAppRun"
      @on-open-output="outputDialogOpen = !outputDialogOpen"
      @on-interrupt="onInterrupt"
      @on-open-workflow="router.push(`/flow/${app.flowid}`)"
    />
    <OutputDialog
      v-model:dialog-open="outputDialogOpen"
      :parentid="appId"
      type="app"
    />
    <PromptCard v-if="promptData" :prompt="promptData" :inputs="inputs" />
  </main>
</template>

<script setup lang="ts">
import { queuePrompt } from '@/api'
import { IComfy } from '@/types/IComfy'
import { useStatusStore } from '@/store'
import { FlowAppModel } from '@/database'
import useExecute from '@/use/useExecute'
import { IFlowAppData } from '@/types/IFlow'
import { ComfyDB_FlowApp } from '@/database/core/schema'

const route = useRoute()
const router = useRouter()
const appId = route.params.id as string
const app = ref<ComfyDB_FlowApp | null | undefined>(null)
const data = ref<(IComfy.AppGraphPrompt & { app: IFlowAppData }) | null>(null)

const inputs = computed(() => data.value!.app.inputs)
const outputs = computed(() => data.value!.app.outputs)

const outputDialogOpen = ref(false)

provide('app', app)

async function onLoadApp() {
  app.value = await FlowAppModel.findById(appId)
  if (app.value) {
    try {
      if (typeof app.value.data === 'string') {
        data.value = JSON.parse(app.value.data)
      } else if (typeof app.value.data === 'object') {
        data.value = app.value.data
      }
    } catch (e) {
      console.error(e)
    }

    watch(
      [inputs, outputs],
      () => {
        FlowAppModel.updateData(appId, JSON.stringify(data.value))
      },
      { deep: true }
    )
  }
}

const statusStore = useStatusStore()
const running = ref(false)
async function onAppRun() {
  previewImage.value = undefined
  progress.value = 0
  for (let input of inputs.value) {
    const nodeId = input.nodeId
    data.value!.output[nodeId].inputs[input.name] = input.value
  }

  if (!statusStore.clientID) return

  try {
    running.value = true
    await queuePrompt(statusStore.clientID, data.value!)
  } catch (e: any) {
    running.value = false
    const msg = e.response.error.message
    toast.error(msg)
  }
}

const { progress, previewImage, onInterrupt } = useExecute(appId)

onMounted(() => {
  onLoadApp()
})

watch(running, (newVal, oldVal) => {
  if (!newVal && oldVal) {
    useEventBus('OutputDialog::Refresh').emit()
  }
})

// Prompt Card
const promptData = ref()
useEventBus('PromptCard::Show').on((data) => {
  promptData.value = data
})
useEventBus('PromptCard::Hide').on(() => {
  promptData.value = null
})
</script>

<style lang="scss"></style>
