<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent class="w-[480px]">
      <DialogHeader>
        <DialogTitle>重命名</DialogTitle>
      </DialogHeader>
      <form class="space-y-4" @submit="onSubmit">
        <FormField name="title" v-slot="{ componentField }">
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

        <DialogFooter>
          <Button type="submit" @click="onSubmit">更新</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import * as z from 'zod'
import { useForm } from 'vee-validate'
import { FlowModel } from '@/database'
import { toTypedSchema } from '@vee-validate/zod'
import { FormField, FormItem, FormControl } from '@/components/ui/form'
import { IFlow } from '@/types/IFlow'

const dialogOpen = defineModel<boolean>('dialogOpen', { default: false })
const props = defineProps<{
  flow: IFlow
}>()
const emits = defineEmits<{
  onUpdate: [name: string, description: string]
}>()

const formSchema = toTypedSchema(
  z.object({
    name: z.string().min(2).max(50),
    desc: z.string().optional(),
  })
)

const form = useForm({
  validationSchema: formSchema,
  initialValues: {
    name: props.flow.name,
    desc: props.flow.description,
  },
})

const onSubmit = form.handleSubmit(
  async (values) => {
    const name = values.name
    const description = values.desc ?? ''
    const flow = await FlowModel.update(props.flow.id, {
      name,
      description,
    })

    if (flow) {
      dialogOpen.value = false
      toast.success('工作流已更新')
      emits('onUpdate', name, description)
    } else {
      toast.error('工作流更新失败, 请重试')
    }
  },
  () => {
    toast.error('工作流标题必须在 2 到 50 个字符之间')
  }
)

watch(dialogOpen, (open) => {
  if (open) {
    form.setValues({ ...props.flow })
  }
})
</script>

<style lang="scss"></style>
