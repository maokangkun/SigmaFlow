<template>
  <div class="node-editing-dialog">
    <TabView v-model:activeIndex="activeTab" class="node-editing-tabs">
      <TabPanel :header="$t('nodePropertiesPanel.addInput')" value="0">
        <AddInputForm
          :node="node"
          :existing-inputs="existingInputs"
          @input-added="handleInputAdded"
          @cancel="$emit('close')"
        />
      </TabPanel>
      
      <TabPanel :header="$t('nodePropertiesPanel.removeInput')" value="1">
        <RemoveInputForm
          :node="node"
          :existing-inputs="existingInputs"
          @input-removed="handleInputRemoved"
          @cancel="$emit('close')"
        />
      </TabPanel>
      
      <TabPanel :header="$t('nodePropertiesPanel.addOutput')" value="2">
        <AddOutputForm
          :node="node"
          :existing-outputs="existingOutputs"
          @output-added="handleOutputAdded"
          @cancel="$emit('close')"
        />
      </TabPanel>
      
      <TabPanel :header="$t('nodePropertiesPanel.removeOutput')" value="3">
        <RemoveOutputForm
          :node="node"
          :existing-outputs="existingOutputs"
          @output-removed="handleOutputRemoved"
          @cancel="$emit('close')"
        />
      </TabPanel>
    </TabView>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import type { LGraphNode } from '@/lib/litegraph/src/litegraph'
import AddInputForm from './nodeEditing/AddInputForm.vue'
import RemoveInputForm from './nodeEditing/RemoveInputForm.vue'
import AddOutputForm from './nodeEditing/AddOutputForm.vue'
import RemoveOutputForm from './nodeEditing/RemoveOutputForm.vue'

interface Props {
  node: LGraphNode
  initialTab?: 'addInput' | 'removeInput' | 'addOutput' | 'removeOutput'
}

const props = withDefaults(defineProps<Props>(), {
  initialTab: 'addInput'
})

const emit = defineEmits<{
  close: []
  inputAdded: [name: string]
  inputRemoved: [name: string]
  outputAdded: [name: string]
  outputRemoved: [name: string]
}>()

// 设置初始标签页
const tabMap = {
  addInput: 0,
  removeInput: 1,
  addOutput: 2,
  removeOutput: 3
}

const activeTab = ref(tabMap[props.initialTab])

// 计算现有输入和输出
const existingInputs = computed(() => {
  return props.node.inputs?.map(input => ({
    name: input.name,
    type: String(input.type), // 确保类型为string
    isOptional: input.shape === 1 // HollowCircle shape indicates optional
  })) || []
})

const existingOutputs = computed(() => {
  return props.node.outputs?.map(output => ({
    name: output.name,
    type: String(output.type), // 确保类型为string
    isList: output.shape === 2 // GRID_SHAPE indicates list
  })) || []
})

// 事件处理
const handleInputAdded = (name: string) => {
  emit('inputAdded', name)
  emit('close')
}

const handleInputRemoved = (name: string) => {
  emit('inputRemoved', name)
  emit('close')
}

const handleOutputAdded = (name: string) => {
  emit('outputAdded', name)
  emit('close')
}

const handleOutputRemoved = (name: string) => {
  emit('outputRemoved', name)
  emit('close')
}
</script>

<style scoped>
@reference "tailwindcss";

.node-editing-dialog {
  min-width: 400px;
  max-width: 600px;
}

.node-editing-tabs {
  @apply w-full;
}

:deep(.p-tabview-nav) {
  @apply justify-center;
}

:deep(.p-tabview-panel) {
  @apply p-4;
}
</style>

