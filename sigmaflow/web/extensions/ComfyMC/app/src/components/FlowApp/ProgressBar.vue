<template>
  <div
    class="flex items-center p-[6px] w-48 fixed left-1/2 rounded-xl border bg-background shadow-sm z-50 -translate-x-1/2 transition-all"
    :class="[running ? 'bottom-20' : 'bottom-5']"
  >
    <Progress :model-value="progress" />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  progress: number
  running: boolean
}>()
</script>

<style lang="scss"></style>
