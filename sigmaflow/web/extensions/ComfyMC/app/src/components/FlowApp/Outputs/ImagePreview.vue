<template>
  <ImageViewer
    :images="images"
    class="grid gap-2 w-full grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
  >
    <template #default="{ images }">
      <img
        class="w-80 object-cover rounded cursor-pointer"
        v-for="image in images"
        :key="image"
        :src="image"
      />
    </template>
  </ImageViewer>

  <div
    class="grid gap-2 w-full grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
    v-if="images.length === 0"
  >
    <div
      class="w-80 h-80 bg-zinc-800 flex items-center justify-center text-zinc-600 rounded"
    >
      <Image />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Image } from 'lucide-vue-next'

const props = defineProps<{
  nodeId: number
}>()

const images = ref<string[]>([])

useEventBus<string[]>(`ImagePreview::Show::${props.nodeId}`).on((data) => {
  images.value = data
})
</script>

<style lang="scss"></style>
