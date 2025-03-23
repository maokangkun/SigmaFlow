<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm" class="w-[180px] justify-between">
        <template v-if="current">
          {{ current.name }}
        </template>
        <template v-else>全部</template>
        <ArrowRight class="opacity-50" :size="15" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="p-0 w-60" side="right" align="start">
      <Command>
        <template v-if="folders.length > 0">
          <CommandInput placeholder="搜索文件夹.." />
          <CommandList>
            <CommandEmpty>没有找到文件夹</CommandEmpty>
            <CommandGroup>
              <CommandItem
                class="cursor-pointer hover:bg-primary-foreground hover:text-primary-background"
                value="all"
                @select="
                  () => {
                    onChange(undefined)
                    open = false
                  }
                "
              >
                全部
              </CommandItem>
              <TooltipProvider>
                <Tooltip v-for="folder in folders" :delay-duration="0">
                  <TooltipTrigger as="div">
                    <CommandItem
                      :key="folder.id"
                      :value="folder.name"
                      @select="
                        () => {
                          onChange(folder)

                          open = false
                        }
                      "
                      class="group cursor-pointer hover:bg-primary-foreground hover:text-primary-background"
                    >
                      <span class="flex items-center justify-between w-full">
                        <span>{{ folder.name }}</span>
                        <span
                          class="flex items-center gap-2 opacity-0 group-hover:opacity-100"
                        >
                          <Button
                            size="icon"
                            class="w-6 h-6"
                            variant="destructive"
                            @click.stop="onDeleteFolder(folder.id)"
                          >
                            <Trash2 :size="14" />
                          </Button>
                        </span>
                      </span>
                    </CommandItem>
                  </TooltipTrigger>
                  <TooltipContent side="right" v-if="folder.description">
                    <span>{{ folder.description }}</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Separator class="my-1" />
              <NewFolder />
            </CommandGroup>
          </CommandList>
        </template>
        <template v-else>
          <div class="p-2">
            <span
              class="flex items-center justify-center w-full h-20 text-sm text-muted-foreground select-none"
            >
              没有文件夹
            </span>
            <NewFolder />
          </div>
        </template>
      </Command>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { IFolder } from '@/types/IFlow'
import { FolderModel } from '@/database'
import { ArrowRight, Trash2 } from 'lucide-vue-next'

const emits = defineEmits<{
  onFolderChange: [folder: IFolder | undefined]
}>()

const open = ref(false)

const folders = ref<IFolder[]>([])
const current = ref<IFolder>()
async function getAllFolders() {
  return await FolderModel.queryAll()
}

async function refreshFolders() {
  folders.value = await getAllFolders()
}

async function onDeleteFolder(id: string) {
  await FolderModel.delete(id)
  await refreshFolders()
}

function onChange(folder: IFolder | undefined) {
  current.value = folder
  emits('onFolderChange', folder)
}

onMounted(async () => {
  await refreshFolders()
})

useEventBus('Folders::Refresh').on(async () => {
  await refreshFolders()
})
</script>

<style lang="scss"></style>
