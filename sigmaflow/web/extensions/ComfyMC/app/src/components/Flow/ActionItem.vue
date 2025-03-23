<template>
  <TooltipProvider :delay-duration="400">
    <Tooltip>
      <TooltipTrigger>
        <div
          v-bind="attrs"
          class="action-item rounded-md"
          :class="[disabled ? ['text-zinc-500', 'cursor-not-allowed'] : []]"
        >
          <slot name="icon" />
          <span class="text-[13px]">{{ label }}</span>
        </div>
        <TooltipContent v-if="tip">
          {{ tip }}
        </TooltipContent>
      </TooltipTrigger>
    </Tooltip>
  </TooltipProvider>
</template>

<script setup lang="ts">
defineProps<{
  tip?: string
  label: string
  disabled?: boolean
}>()

const attrs = useAttrs()
</script>

<style lang="scss">
.action-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  cursor: pointer;
  transition: all 0.2s ease-in-out;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.08);
  }
}
</style>
