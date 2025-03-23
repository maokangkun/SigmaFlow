<template>
  <Input
    v-if="input.type === 'number'"
    v-model="input.value"
    type="number"
    :min="input.options.min"
    :max="input.options.max"
    :step="input.options.step"
  />
  <Input v-else-if="input.type === 'string'" v-model="input.value" />
  <Textarea v-else-if="input.type === 'customtext'" v-model="input.value" />
</template>

<script setup lang="ts">
import { IFlowAppInput } from '@/types/IFlow'

defineProps<{
  input: IFlowAppInput
}>()
</script>

<style lang="scss"></style>
