<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>删除工作流</AlertDialogTitle>
        <AlertDialogDescription>
          确定要删除{{
            flows.length > 1 ? '这些' : ''
          }}工作流吗？删除后无法恢复。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction @click="onDeleteFlow">删除</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { IFlow } from '@/types/IFlow'
import { FlowModel } from '@/database'

const props = defineProps<{
  flows: IFlow[]
}>()

const emits = defineEmits<{
  onDeleted: []
}>()

const open = defineModel({ type: Boolean, default: false })

async function onDeleteFlow() {
  for (const flow of props.flows) {
    await FlowModel.delete(flow.id)
  }
  open.value = false
  toast.success('删除成功')
  emits('onDeleted')
}
</script>

<style lang="scss"></style>
