<template>
  <Teleport to="body">
    <div
      ref="cardRef"
      class="fixed z-[3000] shadow-xl rounded-xl"
      :style="style"
    >
      <Card>
        <CardHeader class="py-5">Prompt</CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div v-for="input in inputs" :key="input.nodeId + input.name">
            <div class="flex items gap-1">
              <span class="w-24 text-sm text-zinc-500 select-none">
                {{ input.title }}
              </span>
              <span class="text-sm">
                {{ params[input.name] }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { IFlowAppInput } from '@/types/IFlow'
import { useDraggable } from '@vueuse/core'

const props = defineProps<{
  prompt: any
  inputs: IFlowAppInput[]
}>()

const params = ref<Record<string, any>>({})
function getData() {
  for (let i = 0, len = props.inputs.length; i < len; i++) {
    const input = props.inputs[i]
    const nodeId = input.nodeId
    const promptInputs = props.prompt[nodeId].inputs
    const promptValue = promptInputs[input.name]
    params.value[input.name] = promptValue
  }
}

watchEffect(() => {
  getData()
})

const cardRef = ref<HTMLElement | null>(null)
const { style } = useDraggable(cardRef, {
  initialValue: {
    x: 20,
    y: 20,
  },
})
</script>

<style lang="scss"></style>
