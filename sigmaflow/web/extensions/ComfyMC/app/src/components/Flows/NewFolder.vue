<template>
  <Dialog v-model:open="dialogOpen">
    <DialogTrigger as-child>
      <Button class="w-full rounded-[3px]">
        <FolderPlus :size="16" class="mr-1.5" />
        新建文件夹
      </Button>
    </DialogTrigger>
    <DialogContent class="w-[480px]">
      <DialogHeader>
        <DialogTitle>新建文件夹</DialogTitle>
      </DialogHeader>
      <form class="space-y-4" @submit="onSubmit">
        <FormField name="name" v-slot="{ componentField }">
          <FormItem v-auto-animate>
            <FormControl>
              <Input
                autofocus
                placeholder="文件夹名称"
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
                placeholder="文件夹描述 [可选]"
                class="col-span-3"
                v-bind="componentField"
              />
            </FormControl>
          </FormItem>
        </FormField>
        <DialogFooter>
          <Button type="submit" @click="onSubmit">确定</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import * as z from 'zod'
import { useForm } from 'vee-validate'
import { FolderModel } from '@/database'
import { FolderPlus } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import { FormField, FormItem, FormControl } from '@/components/ui/form'

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

const onSubmit = form.handleSubmit(
  async (values) => {
    const name = values.name
    const description = values.desc ?? ''
    const folder = await FolderModel.create({ name, description })

    if (folder) {
      toast.success('文件夹创建成功')
      dialogOpen.value = false

      useEventBus('Folders::Refresh').emit()
    } else {
      toast.error('文件夹创建失败, 请重试')
    }
  },
  () => {
    toast.error('文件夹名称必须在 2 到 50 个字符之间')
  }
)
</script>

<style lang="scss"></style>
