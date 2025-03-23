<template>
  <ContextMenu @contextmenu.prevent>
    <ContextMenuTrigger>
      <div
        class="group flex flex-col space-y-2 cursor-pointer"
        @click.stop="onClickFlowApp"
        @dblclick="onOpenFlowApp"
      >
        <div
          class="w-full aspect-video rounded-xl overflow-hidden transition-all"
          :class="[selected && 'border-2 border-primary-500']"
        >
          <img
            v-if="thumbnail"
            :src="thumbnail"
            class="w-full h-full object-cover group-hover:scale-105 transition-all"
          />
          <div
            class="w-full h-full bg-zinc-900 flex items-center justify-center"
          >
            <Route
              :size="24"
              class="opacity-30 -rotate-45 group-hover:scale-110 transition-all"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <div class="flex font-medium text-sm opacity-80 select-none">
            {{ flowApp.name }}
          </div>
          <div class="flex text-xs opacity-30 select-none">
            {{ flowApp.description }}
          </div>
        </div>
      </div>
    </ContextMenuTrigger>

    <ContextMenuContent class="w-44">
      <ContextMenuItem @click="onOpenFlowApp">
        <ArrowRightCircle :size="15" class="mr-1.5 opacity-60" />
        打开 App
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="renameOpen = true">
        <TextCursorInputIcon :size="15" class="mr-1.5 opacity-60" />
        重命名
      </ContextMenuItem>
      <ContextMenuItem>
        <FileImage :size="15" class="mr-1.5 opacity-60" />
        设置封面
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="deleteOpen = true">
        <Trash2 :size="15" class="mr-1.5 opacity-60" />
        删除
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
  <RenameDialog
    v-model:dialog-open="renameOpen"
    :flow="flowApp"
    @onUpdate="onRenamed"
  />
  <FlowDeleteAlert
    v-model:open="deleteOpen"
    :flows="[flowApp]"
    @onDeleted="onDeleted"
  />
</template>

<script setup lang="ts">
import { apiBase } from '@/api/core/base'
import { IFlowApp } from '@/types/IFlow'
import { useMagicKeys } from '@vueuse/core'
import {
  Route,
  TextCursorInputIcon,
  FileImage,
  Trash2,
  ArrowRightCircle,
} from 'lucide-vue-next'

const props = defineProps<{
  flowApp: IFlowApp
  selected: boolean
}>()
const emits = defineEmits<{
  onSelect: []
}>()

const thumbnail = computed(() => {
  const data = props.flowApp.thumbnail?.data
  return data
    ? data.startsWith('data:image')
      ? data
      : `${apiBase}${data}`
    : undefined
})

const router = useRouter()
function onOpenFlowApp() {
  router.push({ name: 'FlowApp', params: { id: props.flowApp.id } })
}

const { shift } = useMagicKeys()
function onClickFlowApp() {
  if (shift.value) {
    emits('onSelect')
  } else {
    onOpenFlowApp()
  }
}

const renameOpen = ref(false)
function onRenamed() {
  useEventBus('FlowApps::Refresh').emit()
}

const deleteOpen = ref(false)
function onDeleted() {
  useEventBus('FlowApps::Refresh').emit()
}
</script>

<style lang="scss"></style>
