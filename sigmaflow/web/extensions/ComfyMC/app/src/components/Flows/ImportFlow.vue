<template>
  <Button
    class="w-44 gap-1"
    variant="outline"
    size="hg"
    @click="openFileDialog"
  >
    <FileUp :size="16" />
    导入工作流
  </Button>
  <Dialog v-model:open="dialogOpen">
    <DialogContent class="w-[480px]">
      <DialogHeader>
        <DialogTitle>导入工作流</DialogTitle>
      </DialogHeader>
      <form class="space-y-4" @submit="onSubmit">
        <FormField name="name" v-slot="{ componentField }">
          <FormItem v-auto-animate>
            <FormControl>
              <Input
                autofocus
                placeholder="工作流标题"
                class="col-span-3"
                v-bind="componentField"
              />
            </FormControl>
          </FormItem>
        </FormField>
        <FormField name="desc" v-slot="{ componentField }">
          <FormItem v-auto-animate>
            <FormControl>
              <Textarea
                placeholder="工作流描述 [可选]"
                class="col-span-3"
                v-bind="componentField"
              />
            </FormControl>
          </FormItem>
        </FormField>

        <Alert class="flex items-center bg-zinc-900 select-none">
          <CheckCircle2 class="h-4 w-4 !top-3.5" />
          <AlertDescription class="!transform-none">
            {{
              graphData ? '已导入工作流数据' : '没有导入工作流数据, 请关闭重试'
            }}
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <div class="flex items-center justify-between w-full">
            <span class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">选择文件夹</span>
              <FoldersCombobox @on-folder-change="folder = $event?.id" />
            </span>
            <Button type="submit" @click="onSubmit">确定</Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import * as z from 'zod'
import { useForm } from 'vee-validate'
import { FlowModel } from '@/database'
import { useFileDialog } from '@vueuse/core'
import { toTypedSchema } from '@vee-validate/zod'
import { defaultGraph } from '@/lib/defaultGraph'
import { FileUp, CheckCircle2 } from 'lucide-vue-next'
import { FormField, FormItem, FormControl } from '@/components/ui/form'

const graphData = ref<any>()
const { open: openFileDialog, onChange: onFileChange } = useFileDialog({
  accept: '.json',
  multiple: false,
})

onFileChange((files) => {
  if (files && files.length && files[0]) {
    const file = files[0]
    handleImportJson(file)
  }
})
useEventBus<File>('Flows::ImportFlow').on(handleImportJson)

function handleImportJson(file: File) {
  const reader = new FileReader()
  reader.onload = async (e) => {
    const content = e.target?.result
    if (typeof content === 'string') {
      try {
        JSON.parse(content)
        graphData.value = content
        dialogOpen.value = true
      } catch (e) {
        toast.error('无效的工作流文件')
      }
    }
  }
  reader.readAsText(file)
}

const dialogOpen = ref(false)

const formSchema = toTypedSchema(
  z.object({
    name: z.string().min(2).max(50),
    desc: z.string().optional(),
  })
)

const form = useForm({
  validationSchema: formSchema,
})

const folder = ref<string>()

const router = useRouter()
const onSubmit = form.handleSubmit(
  async (values) => {
    const name = values.name
    const description = values.desc ?? ''
    const flow = await FlowModel.create({
      name,
      description,
      folder: folder.value,
      data: JSON.parse(graphData.value) ?? defaultGraph,
    })

    if (flow) {
      dialogOpen.value = false
      router.push({ name: 'Flow', params: { id: String(flow.id) } })
    } else {
      toast.error('工作流创建失败, 请重试')
    }
  },
  (e) => {
    console.log(e)
    toast.error('工作流标题必须在 2 到 50 个字符之间')
  }
)
</script>

<style lang="scss"></style>
