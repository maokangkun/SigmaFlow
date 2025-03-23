<template>
  <Popover>
    <PopoverTrigger>
      <ActionItem label="Apps" tip="查看当前工作流的 ComfyApps">
        <template #icon><Sparkles :size="15" /></template>
      </ActionItem>
    </PopoverTrigger>
    <PopoverContent class="p-1 rounded-lg">
      <TooltipProvider :delay-duration="0">
        <ScrollArea>
          <div class="flex flex-col gap-1">
            <Tooltip v-for="app in apps" :key="app.id">
              <TooltipTrigger>
                <div
                  class="flex items-center select-none rounded-sm hover:bg-zinc-900 px-3 py-2 cursor-pointer transition-all"
                  @click="onAppClick(app.id)"
                >
                  <span class="text-zinc-50 text-sm">{{ app.name }}</span>
                  <span class="text-zinc-600 text-xs ml-2">
                    - ver.{{ app.version }}
                  </span>
                </div>
              </TooltipTrigger>

              <TooltipContent side="right" v-if="app.description">
                {{ app.description }}
              </TooltipContent>
            </Tooltip>
          </div>
        </ScrollArea>
      </TooltipProvider>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { FlowAppModel } from '@/database'
import { ComfyDB_FlowApp } from '@/database/core/schema'
import { Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  flowid: string
}>()

const { flowid } = toRefs(props)
const apps = ref<ComfyDB_FlowApp[]>([])

async function getApps() {
  apps.value = await FlowAppModel.findByFlowId(flowid.value)
}

const router = useRouter()
function onAppClick(appid: string) {
  router.push({ name: 'FlowApp', params: { id: appid } })
}

onMounted(() => {
  getApps()
})
</script>

<style lang="scss"></style>
