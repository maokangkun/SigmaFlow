<template>
  <section
    class="home-header flex items-center justify-between h-14 border-b px-7"
  >
    <div
      class="flex items-center gap-1"
      :class="[showBack ? 'cursor-pointer' : 'cursor-default']"
      @click="showBack && $emit('back')"
    >
      <ChevronLeft class="-ml-2" v-if="showBack" />
      <div class="text-base font-medium select-none">{{ title }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    title: string
    showBack: boolean
  }>(),
  {
    title: 'ComfyMC',
    showBack: false,
  }
)
</script>

<style lang="scss"></style>
