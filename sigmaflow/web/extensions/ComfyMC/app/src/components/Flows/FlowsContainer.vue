<template>
  <div class="w-full">
    <div class="flows-grid" v-if="flows.length">
      <FlowsItem
        v-for="flow in flows"
        :key="flow.id"
        :flow="flow"
        :selected="selectedFlowsIds.includes(flow.id)"
        @on-select="onSelectFlow(flow)"
      />
    </div>
    <div
      v-else
      class="flex items-center justify-center h-[calc(100vh-300px)] text-center text-zinc-600"
    >
      还没有工作流~
    </div>
  </div>
</template>

<script setup lang="ts">
import { IFlow, IFolder } from '@/types/IFlow'
import { FlowModel } from '@/database'

const props = defineProps<{
  currentFolder?: IFolder
}>()

const flows = ref<IFlow[]>([])
const selectedFlows = ref<IFlow[]>([])
const selectedFlowsIds = computed(() => selectedFlows.value.map((f) => f.id))

async function getAllFlows() {
  return await FlowModel.query({
    folderId: props.currentFolder?.id,
  })
}

async function refreshFlows() {
  flows.value = await getAllFlows()
}

function onSelectFlow(flow: IFlow) {
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
