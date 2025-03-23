<template>
  <Viewer
    :options="{
      button: false,
      title: false,
      toolbar: false,
      view: onView,
      hide: onHide,
    }"
    v-bind="$attrs"
    :images="images"
  >
    <template #default="scope">
      <slot :images="scope.images" />
    </template>
  </Viewer>
</template>

<script setup lang="ts">
import 'viewerjs/dist/viewer.css'
import { getPngMetadata } from '@/lib/utils'
import { component as Viewer } from 'v-viewer'

const props = defineProps<{
  images: string[]
}>()

function onView(e: {
  detail: { index: number; originalImage: HTMLImageElement }
}) {
  const index = e.detail.index
  const url = props.images[index]
  readImageMeta(url)
}

function onHide() {
  useEventBus('PromptCard::Hide').emit()
}

async function readImageMeta(url: string) {
  const blob = await fetch(url).then((res) => res.blob())
  const file = new File([blob], 'image.png', { type: 'image/png' })
  const meta = await getPngMetadata(file)
  try {
    const prompt = JSON.parse(meta.prompt)
    useEventBus('PromptCard::Show').emit(prompt)
  } catch (e) {
    console.error(e)
  }
}
</script>

<style lang="scss">
.viewer-transition {
  transition-duration: 0.15s !important;
}
</style>
