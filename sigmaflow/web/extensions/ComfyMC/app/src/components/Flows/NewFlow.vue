<template>
  <Dialog v-model:open="dialogOpen">
    <DialogTrigger as-child>
      <Button class="w-44 gap-1" variant="outline" size="hg">
        <Plus :size="16" />
        新建工作流
      </Button>
    </DialogTrigger>
    <DialogContent class="w-[480px]">
      <DialogHeader>
        <DialogTitle>新建工作流</DialogTitle>
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

        <FormField name="useDefault" v-slot="{ value, handleChange }">
          <FormItem v-auto-animate>
            <FormControl>
              <div class="flex items-center space-x-2">
                <Switch
                  id="use-default"
                  :checked="value"
                  @update:checked="handleChange"
                />
                <Label for="use-default">使用默认工作流</Label>
              </div>
            </FormControl>
          </FormItem>
        </FormField>

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
import { Plus } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import { defaultGraph, voidGraph } from '@/lib/defaultGraph'
import { FormField, FormItem, FormControl } from '@/components/ui/form'

const dialogOpen = ref(false)

const formSchema = toTypedSchema(
  z.object({
    name: z.string().min(2).max(50),
    desc: z.string().optional(),
    useDefault: z.boolean().optional(),
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
    const useDefault = values.useDefault
    const flow = await FlowModel.create({
      name,
      description,
      folder: folder.value,
      data: useDefault ? defaultGraph : voidGraph,
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
