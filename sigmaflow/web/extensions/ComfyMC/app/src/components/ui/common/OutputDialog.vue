<template>
  <Dialog :open="dialogOpen" :modal="false">
    <DialogContent
      hide-close
      class="w-[80vw] h-[70vh] bottom-24 top-[unset] -translate-y-0 data-[state=closed]:!slide-out-to-bottom-[48%] data-[state=open]:!slide-in-from-bottom-[48%] z-40 p-4"
    >
      <DialogClose
        @click="dialogOpen = false"
        class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground z-50"
      >
        <X class="w-4 h-4" />
      </DialogClose>

      <ScrollArea>
        <div class="flex flex-col gap-2">
          <span class="text-sm font-bold text-zinc-600">图片</span>
          <ImageViewer
            :images="images"
            class="grid gap-2 w-full h-fit grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
          >
            <template #default="{ images }">
              <img
                class="rounded-sm cursor-pointer"
                v-for="image in images"
                :key="image"
                :src="image"
              />
            </template>
          </ImageViewer>

          <span
            class="text-sm font-bold text-zinc-600 mt-4"
            v-if="others.length"
          >
            其他
          </span>
          <div
            class="grid gap-2 w-full h-fit grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
          >
            <OutputFileItem
              v-for="file in others"
              :key="file.id"
              :file="file"
              class="flex items"
            />
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { apiBase } from '@/api/core/base'
import { FileModel } from '@/database'
import { ComfyDB_File } from '@/database/core/schema'
import { X } from 'lucide-vue-next'

const dialogOpen = defineModel<boolean>('dialogOpen', { default: false })

const props = defineProps<{
  parentid: string
  type: 'flow' | 'app'
}>()

async function loadFiles() {
  files.value = await FileModel.findByParentId(props.parentid)
}

const files = ref<ComfyDB_File[]>([])
const images = computed<string[]>(() =>
  files.value
    .filter((file) => file.type === 'image')
    .map((file) => `${apiBase}${file.data}`)
)

// const videos = computed<string[]>(() =>  files.value
//     .filter((file) => file.type === 'video')
//     .map((file) => `${apiBase}${file.data}`)
// )

const others = computed<ComfyDB_File[]>(() =>
  files.value.filter((file) => file.type !== 'image' && file.type !== 'video')
)

onMounted(() => {
  loadFiles()
})

useEventBus('OutputDialog::Refresh').on(() => {
  loadFiles()
})
</script>

<style lang="scss"></style>
