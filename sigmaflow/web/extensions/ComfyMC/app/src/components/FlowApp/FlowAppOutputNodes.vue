<template>
  <div class="flex flex-col gap-6 w-3/4 h-full p-6 border-l border-zinc-800">
    <div
      class="flex flex-col gap-1"
      v-for="(node, index) in nodes"
      :key="index"
    >
      <div class="text-sm text-zinc-500 select-none">{{ node.title }}</div>
      <div v-for="(input, i) in node.inputs" :key="i">
        <ImagePreview :node-id="node.id" v-if="input.type === 'IMAGE'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IComfy } from '@/types/IComfy'

defineProps<{
  nodes: IComfy.AppGraphPromptNode[]
}>()
</script>

<style lang="scss"></style>
