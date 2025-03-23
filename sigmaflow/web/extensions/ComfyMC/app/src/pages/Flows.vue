<template>
  <div ref="flowsRef" class="flows gap-5" :class="{ drop: isOverDropZone }">
    <FlowsActions />
    <FlowsFilter />
    <FlowsContainer :current-folder="currentFolder" />
  </div>
</template>

<script setup lang="ts">
import { IFolder } from '@/types/IFlow'
import { useDropZone } from '@vueuse/core'

const currentFolder = ref<IFolder>()
useEventBus<IFolder>('Flows::Filter::Folder').on((folder) => {
  currentFolder.value = folder
})

const flowsRef = ref<HTMLElement | null>(null)
const { isOverDropZone } = useDropZone(flowsRef, {
  dataTypes: ['application/json'],
  onDrop: (files) => {
    if (files && files.length && files[0]) {
      const file = files[0]
      useEventBus<File>('Flows::ImportFlow').emit(file)
    }
  },
})
</script>

<style lang="scss">
.flows.drop {
  position: relative;
  &::after {
    content: '导入 .json 文件';
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(100% - 4px);
    height: calc(100% - 4px);
    font-size: large;
    color: rgba(255, 255, 255, 0.5);
    border: 3px dashed rgba(255, 255, 255, 0.2);
    box-sizing: border-box;
    border-radius: 10px;
    background-color: rgba(0, 0, 0, 0.75);
    z-index: 1000;
    transition: all 0.2s;
  }
}
</style>
