<template>
  <div
    class="flex flex-col gap-6 h-full p-6 relative"
    :style="{ width: panelSize + 'px' }"
  >
    <div
      class="flex flex-col gap-1"
      v-for="(input, index) in inputs.filter((i) => i.type !== 'button')"
      :key="index"
    >
      <div class="text-sm text-zinc-500 select-none">{{ input.title }}</div>
      <InputArea
        v-if="
          input.type === 'string' ||
          input.type === 'customtext' ||
          input.type === 'number'
        "
        :input="input"
      />
      <Combo v-else-if="input.type === 'combo'" :input="input" />
    </div>
    <ResizerLine
      :size="panelSize"
      :min="300"
      :max="halfWindowWidth"
      @resizing="onPanelResize"
    />
  </div>
</template>

<script setup lang="ts">
import { FlowAppModel } from '@/database'
import { ComfyDB_FlowApp } from '@/database/core/schema'
import { IFlowAppInput } from '@/types/IFlow'

defineProps<{
  inputs: IFlowAppInput[]
}>()

const app = inject<Ref<ComfyDB_FlowApp | null | undefined>>('app')!

const panelSize = computed(() => app.value?.configs?.inputPanelWidth || 372)

const halfWindowWidth = window.innerWidth / 2

function onPanelResize(size: number) {
  if (app.value) {
    if (!app.value.configs) {
      app.value.configs = {}
    }
    app.value.configs.inputPanelWidth = size

    const configs = JSON.parse(JSON.stringify(app.value.configs))
    FlowAppModel.updateConfigs(app.value.id, configs)
  }
}
</script>

<style lang="scss"></style>
