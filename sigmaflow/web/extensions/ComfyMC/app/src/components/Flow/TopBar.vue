<template>
  <Menubar class="flow-menu z-[99]" v-model="currentMenu">
    <Button
      variant="ghost"
      size="icon"
      class="w-8 h-8 rounded-lg"
      @click="onBack"
    >
      <ChevronLeft />
    </Button>
    <div class="flex gap-1 h-full px-3 text-sm">
      <span class="font-medium select-none">{{ flow.name }}</span>
    </div>
    <div class="h-6 w-px bg-secondary" />
    <MenubarMenu>
      <MenubarTrigger>工作流</MenubarTrigger>
      <MenubarContent>
        <MenubarItem @click="onMenuClick('rename')">
          <MenubarIcon><TextCursorInput :size="ICON_SIZE" /></MenubarIcon>
          重命名
        </MenubarItem>
        <MenubarItem @click="onMenuClick('set-thumb')">
          <MenubarIcon><Image :size="ICON_SIZE" /></MenubarIcon>
          设置封面
        </MenubarItem>
        <MenubarItem @click="onMenuClick('save-template')">
          <MenubarIcon><Workflow :size="ICON_SIZE" /></MenubarIcon>
          保存为模版
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem @click="onMenuClick('import')">
          <MenubarIcon><ArrowUpToLine :size="ICON_SIZE" /></MenubarIcon>
          导入
        </MenubarItem>
        <MenubarItem @click="onMenuClick('export')">
          <MenubarIcon><ArrowDownToLine :size="ICON_SIZE" /></MenubarIcon>
          导出
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem @click="onMenuClick('clear')">
          <MenubarIcon><Trash2 :size="ICON_SIZE" /></MenubarIcon>
          清空
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>

    <MenubarMenu>
      <MenubarTrigger>编辑</MenubarTrigger>
      <MenubarContent>
        <MenubarItem @click="onMenuClick('undo')">
          <MenubarIcon><Undo2 :size="ICON_SIZE" /></MenubarIcon>
          撤销
          <MenubarShortcut>⌘Z</MenubarShortcut>
        </MenubarItem>
        <MenubarItem @click="onMenuClick('redo')">
          <MenubarIcon><Redo2 :size="ICON_SIZE" /></MenubarIcon>
          重做
          <MenubarShortcut>⌘⇧Z</MenubarShortcut>
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>

    <MenubarMenu>
      <MenubarTrigger>画布</MenubarTrigger>
      <MenubarContent>
        <MenubarItem @click="onMenuClick('zoom-in')">
          <MenubarIcon><ZoomIn :size="ICON_SIZE" /></MenubarIcon>
          放大
          <MenubarShortcut>⌘+</MenubarShortcut>
        </MenubarItem>
        <MenubarItem @click="onMenuClick('zoom-out')">
          <MenubarIcon><ZoomOut :size="ICON_SIZE" /></MenubarIcon>
          缩小
          <MenubarShortcut>⌘-</MenubarShortcut>
        </MenubarItem>
        <MenubarItem @click="onMenuClick('zoom-reset')">
          <MenubarIcon><Fullscreen :size="ICON_SIZE" /></MenubarIcon>
          缩放至100%
          <MenubarShortcut>⌘0</MenubarShortcut>
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem @click="onMenuClick('arrange')">
          <MenubarIcon><LayoutTemplate :size="ICON_SIZE" /></MenubarIcon>
          排列节点
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem @click="onMenuClick('editor-settings')">
          <MenubarIcon><Settings2 :size="ICON_SIZE" /></MenubarIcon>
          编辑器设置
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  </Menubar>
</template>

<script setup lang="ts">
import {
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Workflow,
  ChevronLeft,
  Image,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
  Settings2,
  Fullscreen,
  LayoutTemplate,
  TextCursorInput,
} from 'lucide-vue-next'
import { IMenuMessageType } from '@/types/IMessage'
import { IFlow } from '@/types/IFlow'

defineProps<{
  flow: IFlow
}>()

const emits = defineEmits<{
  onMenuClick: [type: IMenuMessageType]
}>()

const ICON_SIZE = 15
const currentMenu = ref('')

function closeMenu() {
  if (currentMenu.value) {
    currentMenu.value = ''
  }
}

const router = useRouter()
function onBack() {
  router.push({ name: 'Flows' })
}

function onMenuClick(type: IMenuMessageType) {
  emits('onMenuClick', type)
}

onMounted(() => {
  window.addEventListener('blur', closeMenu)
})

onUnmounted(() => {
  window.removeEventListener('blur', closeMenu)
})
</script>

<style lang="scss">
.flow-menu {
  position: fixed;
  top: 20px;
  left: 20px;
}
</style>
