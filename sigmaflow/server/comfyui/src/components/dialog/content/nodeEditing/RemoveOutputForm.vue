<template>
  <div class="remove-output-form">
    <div class="form-content">
      <div v-if="existingOutputs.length === 0" class="no-outputs">
        <i class="pi pi-info-circle text-2xl text-gray-400"></i>
        <p class="text-gray-500">{{ $t('nodePropertiesPanel.removeOutputDialog.no_out') }}</p>
      </div>
      
      <template v-else>
        <div class="field">
          <label for="output-select" class="field-label">{{ $t('nodePropertiesPanel.removeOutputDialog.name') }} *</label>
          <Dropdown
            id="output-select"
            v-model="selectedOutput"
            :options="outputOptions"
            option-label="label"
            option-value="value"
            :placeholder="$t('nodePropertiesPanel.removeOutputDialog.name_placeholder')"
            :class="{ 'p-invalid': errors.output }"
            @change="validateOutput"
          />
          <small v-if="errors.output" class="p-error">{{ errors.output }}</small>
        </div>

        <div v-if="selectedOutputInfo">
          <h4 class="info-title">{{ $t('nodePropertiesPanel.removeOutputDialog.out_detail') }}</h4>
          <div class="info-content">
            <div class="info-item">
              <span class="info-label">{{ $t('nodePropertiesPanel.removeOutputDialog.out_name') }}:</span>
              <span class="info-value">{{ selectedOutputInfo.name }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('nodePropertiesPanel.removeOutputDialog.out_type') }}:</span>
              <span class="info-value">{{ selectedOutputInfo.type }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('nodePropertiesPanel.removeOutputDialog.out_list') }}:</span>
              <span class="info-value">{{ selectedOutputInfo.isList ? $t('nodePropertiesPanel.removeOutputDialog.out_list_yes') : $t('nodePropertiesPanel.removeOutputDialog.out_list_no') }}</span>
            </div>
          </div>
          
          <div class="warning-message">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ $t('nodePropertiesPanel.removeOutputDialog.delete_warning') }}</span>
          </div>
        </div>
      </template>
    </div>

    <div class="form-actions">
      <Button
        v-if="existingOutputs.length > 0"
        :label="$t('nodePropertiesPanel.removeOutput')"
        severity="danger"
        :disabled="!isFormValid"
        @click="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Dropdown from 'primevue/dropdown'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import type { LGraphNode } from '@/lib/litegraph/src/litegraph'
import { useNodeEditingService } from '@/services/nodeEditingService'
import { useI18n } from 'vue-i18n'

interface Props {
  node: LGraphNode
  existingOutputs: Array<{
    name: string
    type: string
    isList: boolean
  }>
}

const { t } = useI18n()
const props = defineProps<Props>()

const emit = defineEmits<{
  outputRemoved: [name: string]
  cancel: []
}>()

const toast = useToast()
const { removeNodeOutput } = useNodeEditingService()

// 表单数据
const selectedOutput = ref('')

// 错误状态
const errors = reactive({
  output: ''
})

// 输出选项
const outputOptions = computed(() => {
  return props.existingOutputs.map(output => ({
    label: `${output.name} (${output.type})`,
    value: output.name
  }))
})

// 选中的输出信息
const selectedOutputInfo = computed(() => {
  if (!selectedOutput.value) return null
  return props.existingOutputs.find(output => output.name === selectedOutput.value)
})

// 表单验证
const validateOutput = () => {
  errors.output = ''
  
  if (!selectedOutput.value) {
    errors.output = t('nodePropertiesPanel.removeOutputDialog.name')
    return false
  }
  
  return true
}

const isFormValid = computed(() => {
  return selectedOutput.value && !errors.output
})

// 提交处理
const handleSubmit = () => {
  if (!validateOutput()) {
    return
  }
  
  try {
    removeNodeOutput(props.node, selectedOutput.value)
    
    toast.add({
      severity: 'success',
      summary: t('nodePropertiesPanel.success'),
      detail:  t('nodePropertiesPanel.removeOutputDialog.success_message', {name: selectedOutput.value.trim()}),
      life: 3000
    })
    
    emit('outputRemoved', selectedOutput.value)
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('nodePropertiesPanel.error'),
      detail:  t('nodePropertiesPanel.removeOutputDialog.error_message', {error: error instanceof Error ? error.message : t('nodePropertiesPanel.unknown_error')}),
      life: 5000
    })
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.remove-output-form {
  @apply flex flex-col gap-6;
}

.form-content {
  @apply flex flex-col gap-4;
}

.no-outputs {
  @apply flex flex-col items-center gap-3 py-8 text-center;
}

.field {
  @apply flex flex-col gap-2;
}

.field-label {
  @apply font-medium text-sm;
}

.output-info {
  @apply bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border;
}

.info-title {
  @apply font-medium text-sm mb-3;
}

.info-content {
  @apply flex flex-col gap-2 mb-4;
}

.info-item {
  @apply flex justify-between items-center;
}

.info-label {
  @apply text-sm text-gray-600 dark:text-gray-400;
}

.info-value {
  @apply text-sm font-medium;
}

.warning-message {
  @apply flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-800 dark:text-yellow-200 text-sm;
}

.form-actions {
  @apply flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700;
}

:deep(.p-dropdown) {
  @apply w-full;
}

:deep(.p-invalid) {
  @apply border-red-500;
}

.p-error {
  @apply text-red-500 text-xs;
}
</style>

