<template>
  <section
    class="flex items-center p-[6px] fixed left-1/2 bottom-5 rounded-xl border bg-background shadow-sm z-50 -translate-x-1/2"
  >
    <ActionItem
      label="查看工作流"
      tip="打开原版工作流"
      @click="onOpenWorkflow"
      v-if="flowId"
    >
      <template #icon><Route :size="15" /></template>
    </ActionItem>

    <ActionItem
      label="查看输出"
      tip="查看当前 App 的输出结果"
      @click="onOpenOutput"
    >
      <template #icon><Image :size="15" /></template>
    </ActionItem>

    <span class="w-[1px] h-[20px] mx-[6px] bg-secondary" v-if="flowId" />

    <ActionItem
      class="w-24"
      :label="running ? '取消' : '运行'"
      :tip="running ? '取消运行 App' : '运行当前 App'"
      @click="onAppRun"
    >
      <template #icon>
        <X :size="15" v-if="running" />
        <Play :size="15" v-else />
      </template>
    </ActionItem>
  </section>
</template>

<script setup lang="ts">
import { Play, Route, Image, X } from 'lucide-vue-next'

const props = defineProps<{
  flowId?: string
  running: boolean
}>()

const emits = defineEmits<{
  onAppRun: []
  onOpenWorkflow: []
  onOpenOutput: []
  onInterrupt: []
}>()

function onAppRun() {
  if (props.running) {
    emits('onInterrupt')
  } else {
    emits('onAppRun')
  }
}

function onOpenWorkflow() {
  emits('onOpenWorkflow')
}

function onOpenOutput() {
  emits('onOpenOutput')
}
</script>
