<template>
  <div class="w-full">
    <div class="flows-grid" v-if="flowApps.length">
      <FlowAppsItem
        v-for="app in flowApps"
        :key="app.id"
        :flow-app="app"
        :selected="selectedFlowsIds.includes(app.id)"
        @on-select="onSelectFlow(app)"
      />
    </div>
    <div
      v-else
      class="flex items-center justify-center h-[calc(100vh-200px)] text-center text-zinc-600"
    >
      还没有生成 App~
    </div>
  </div>
</template>

<script setup lang="ts">
import { IFlowApp, IFolder } from '@/types/IFlow'
import { FlowAppModel } from '@/database'

const props = defineProps<{
  currentFolder?: IFolder
}>()

const flowApps = ref<IFlowApp[]>([])
const selectedFlows = ref<IFlowApp[]>([])
const selectedFlowsIds = computed(() => selectedFlows.value.map((f) => f.id))

async function getAllFlowApps() {
  return await FlowAppModel.query({
    folderId: props.currentFolder?.id,
  })
}

async function refreshFlows() {
  flowApps.value = await getAllFlowApps()
}

function onSelectFlow(flow: IFlowApp) {
  const index = selectedFlows.value.findIndex((f) => f.id === flow.id)
  if (index === -1) {
    selectedFlows.value.push(flow)
  } else {
    selectedFlows.value.splice(index, 1)
  }
}

function onClearSelected(e: MouseEvent) {
  e.stopPropagation()
  selectedFlows.value = []
}

onMounted(async () => {
  await refreshFlows()
  document.addEventListener('click', onClearSelected)
})

onUnmounted(() => {
  document.removeEventListener('click', onClearSelected)
})

watch(
  () => props.currentFolder,
  async () => {
    await refreshFlows()
  }
)

useEventBus('Flows::Refresh').on(async () => {
  await refreshFlows()
})
</script>

<style lang="scss">
.flows-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
</style>
