<template>
  <section
    class="flex items-center p-[6px] fixed left-1/2 bottom-5 rounded-xl border bg-background shadow-sm z-50 -translate-x-1/2"
  >
    <ActionItem label="制作 App" tip="制作成为 ComfyApp" @click="onMakeApp">
      <template #icon><Sparkle :size="15" /></template>
    </ActionItem>

    <AppsListPopover :flowid="flowid" />

    <span class="w-[1px] h-[20px] mx-[6px] bg-secondary" />

    <ActionItem
      label="管理器"
      tip="打开 ComfyMC 管理器"
      @click="onActionClick('open-manager')"
    >
      <template #icon><Package :size="15" /></template>
    </ActionItem>
    <ActionItem
      label="控制台"
      tip="查看控制台输出"
      @click="onActionClick('open-console')"
    >
      <template #icon><Terminal :size="15" /></template>
    </ActionItem>

    <span class="w-[1px] h-[20px] mx-[6px] bg-secondary" />

    <ActionItem
      label="运行"
      tip="运行当前工作流"
      @click="onActionClick('queue-prompt')"
    >
      <template #icon><Play :size="15" /></template>
    </ActionItem>
  </section>
</template>

<script setup lang="ts">
import { Package, Play, Terminal, Sparkle } from 'lucide-vue-next'
import { IActionMessageType } from '@/types/IMessage'

defineProps<{
  flowid: string
}>()

const emits = defineEmits<{
  onActionClick: [type: IActionMessageType]
  onMakeAppClick: []
}>()

function onActionClick(type: IActionMessageType) {
  emits('onActionClick', type)
}

function onMakeApp() {
  emits('onMakeAppClick')
}
</script>
