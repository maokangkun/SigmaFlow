<template>
  <TooltipProvider :delay-duration="0">
    <Tooltip>
      <TooltipTrigger as-child>
        <div
          class="fixed right-5 top-5 rounded-xl flex items-center justify-center gap-1 opacity-50 select-none z-[99]"
          :class="[online ? 'opacity-50' : 'opacity-100']"
        >
          <span
            class="w-1.5 h-1.5 rounded-full"
            :class="[online ? 'bg-green-500' : 'bg-red-500']"
          />
          <span class="text-[10px]">{{ online ? 'Online' : 'Offline' }}</span>
        </div>
      </TooltipTrigger>

      <TooltipContent>
        <div class="text-xs font-medium select-none">
          服务器状态: {{ online ? '在线' : '离线' }}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { useStatusStore } from '@/store'

const statusStore = useStatusStore()
const online = computed(
  () => !!statusStore.clientID && !statusStore.reconnecting
)
</script>

<style lang="scss"></style>
