<template>
  <div
    ref="resizerRef"
    class="absolute rounded-md transition-all hover:bg-zinc-700"
    :class="[resizing ? 'bg-zinc-700' : '']"
    :style="lineStyle"
    @mousedown.stop="onResizerMousedown"
  />
</template>

<script setup lang="ts">
import { useMouse } from '@vueuse/core'

const props = withDefaults(
  defineProps<{
    position: 'left' | 'right' | 'top' | 'bottom'
    size: number
    min: number
    max: number
    lineWidth: number
  }>(),
  {
    position: 'right',
    min: 170,
    max: 280,
    size: 240,
    lineWidth: 4,
  }
)

const emits = defineEmits<{
  resizeStart: []
  resizing: [number]
  resizeEnd: []
}>()

const resizerRef = ref<HTMLElement | null>(null)
const resizing = ref(false)

const isHorizontal = computed(() => ['left', 'right'].includes(props.position))
const opposite = computed(() => {
  switch (props.position) {
    case 'left':
      return 'right'
    case 'right':
      return 'left'
    case 'top':
      return 'bottom'
    case 'bottom':
      return 'top'
  }
})

const lineStyle = computed(() => {
  const _: any = {
    [props.position]: `-${props.lineWidth / 2}px`,
    cursor: isHorizontal.value ? 'ew-resize' : 'ns-resize',
  }
  if (isHorizontal.value) {
    _.top = 0
    _.width = `${props.lineWidth}px`
    _.height = '100%'
  } else {
    _.left = 0
    _.height = `${props.lineWidth}px`
    _.width = '100%'
  }
  return _
})

const startPos = ref(0)
function onResizerMousedown(e: MouseEvent) {
  emits('resizeStart')
  resizing.value = true
  startPos.value = isHorizontal.value ? e.clientX : e.clientY
}

const { x, y } = useMouse()

function onResizerMousemove(e: MouseEvent) {
  if (resizing.value && resizerRef.value && resizerRef.value.parentElement) {
    e.preventDefault()

    const parentRect = resizerRef.value.parentElement.getBoundingClientRect()
    const parentPos = parentRect[opposite.value]
    const newSize = isHorizontal.value
      ? x.value - parentPos
      : y.value - parentPos

    const val = Math.min(Math.max(newSize, props.min), props.max)
    emits('resizing', val)
  }
}

function onResizerMouseup() {
  emits('resizeEnd')
  resizing.value = false
}

onMounted(() => {
  window.addEventListener('mousemove', onResizerMousemove)
  window.addEventListener('mouseup', onResizerMouseup)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onResizerMousemove)
  window.removeEventListener('mouseup', onResizerMouseup)
})
</script>

<style lang="scss"></style>
