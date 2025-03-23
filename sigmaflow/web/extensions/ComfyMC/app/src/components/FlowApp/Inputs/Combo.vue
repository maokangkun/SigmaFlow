<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between w-full gap-2">
      <Popover v-model:open="open">
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            role="combobox"
            class="justify-between flex-shrink w-full"
            :class="[isImage ? '!w-[calc(100%-116px)]' : '']"
          >
            <span class="overflow-hidden text-ellipsis">
              {{ input.value }}
            </span>
            <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="p-0">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem
                  class="hover:bg-zinc-900 cursor-pointer transition-all"
                  v-for="opt in input.options.values"
                  :key="opt"
                  :value="opt"
                  @select="
                    (ev) => {
                      if (typeof ev.detail.value === 'string') {
                        input.value = ev.detail.value
                        open = false
                      }
                    }
                  "
                >
                  {{ opt }}
                  <Check
                    :class="[
                      'ml-auto h-4 w-4',
                      opt === input.value ? 'opacity-100' : 'opacity-0',
                    ]"
                  />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button v-if="isImage" @click="openFileDialog">
        <ImageUp :size="14" class="mr-1" />
        上传图片
      </Button>
    </div>

    <img
      v-if="isImage"
      :src="imageUrl"
      class="w-full object-cover rounded-sm border border-zinc-800"
    />
  </div>
</template>

<script setup lang="ts">
import { apiBase, fetchApi } from '@/api/core/base'
import { useFileDialog } from '@vueuse/core'
import { IFlowAppInput } from '@/types/IFlow'
import { Check, ChevronsUpDown, ImageUp } from 'lucide-vue-next'

const props = defineProps<{
  input: IFlowAppInput
}>()

const open = ref(false)

const isImage = computed(() => props.input.name.toLocaleLowerCase() === 'image')
const imageUrl = computed(
  () =>
    `${apiBase}/view?filename=${encodeURIComponent(
      props.input.value
    )}&type=input&subfolder=&t=${+new Date()}`
)

const { open: openFileDialog, onChange: onFileChange } = useFileDialog({
  accept: 'image/*',
  multiple: false,
})

onFileChange(async (files) => {
  if (!files || !files.length) return
  const file = files[0]

  const body = new FormData()
  body.append('image', file)

  const resp = await fetchApi('/upload/image', {
    method: 'POST',
    body,
  })

  if (resp.status === 200) {
    const data = await resp.json()
    let path = data.name
    if (data.subfolder) path = data.subfolder + '/' + path
    props.input.options.values.push(path)
    props.input.value = path
  } else {
    toast.error(resp.status + ' - ' + resp.statusText)
  }
})
</script>

<style lang="scss"></style>
