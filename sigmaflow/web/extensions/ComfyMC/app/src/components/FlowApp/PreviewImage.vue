<template>
  <div
    class="flex items-center p-[6px] w-48 fixed left-1/2 rounded-xl border bg-background shadow-sm z-50 -translate-x-1/2 transition-all"
    :class="[
      running && url ? 'bottom-[108px] opacity-100' : 'bottom-5 opacity-0',
    ]"
  >
    <img :src="url" class="w-full h-full rounded-md" />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  url?: string
  running: boolean
}>()
</script>

<style lang="scss"></style>
