<template>
  <div class="remove-input-form">
    <div class="form-content">
      <div v-if="existingInputs.length === 0" class="no-inputs">
        <i class="pi pi-info-circle text-2xl text-gray-400"></i>
        <p class="text-gray-500">{{ $t('nodePropertiesPanel.removeInputDialog.no_inp') }}</p>
      </div>
      
      <template v-else>
        <div class="field">
          <label for="input-select" class="field-label">{{ $t('nodePropertiesPanel.removeInputDialog.name') }} *</label>
          <Dropdown
            id="input-select"
            v-model="selectedInput"
            :options="inputOptions"
            option-label="label"
            option-value="value"
            :placeholder="$t('nodePropertiesPanel.removeInputDialog.name_placeholder')"
            :class="{ 'p-invalid': errors.input }"
            @change="validateInput"
          />
          <small v-if="errors.input" class="p-error">{{ errors.input }}</small>
        </div>

        <div v-if="selectedInputInfo">
          <h4 class="info-title">{{ $t('nodePropertiesPanel.removeInputDialog.input_detail') }}</h4>
          <div class="info-content">
            <div class="info-item">
              <span class="info-label">{{ $t('nodePropertiesPanel.removeInputDialog.input_name') }}:</span>
              <span class="info-value">{{ selectedInputInfo.name }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('nodePropertiesPanel.removeInputDialog.input_type') }}:</span>
              <span class="info-value">{{ selectedInputInfo.type }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('nodePropertiesPanel.removeInputDialog.input_opt') }}:</span>
              <span class="info-value">{{ selectedInputInfo.isOptional ? $t('nodePropertiesPanel.removeInputDialog.input_opt_yes') : $t('nodePropertiesPanel.removeInputDialog.input_opt_no') }}</span>
            </div>
          </div>
          
          <div class="warning-message">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ $t('nodePropertiesPanel.removeInputDialog.delete_warning') }}</span>
          </div>
        </div>
      </template>
    </div>

    <div class="form-actions">
      <Button
        v-if="existingInputs.length > 0"
        :label="$t('nodePropertiesPanel.removeInput')"
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
  existingInputs: Array<{
    name: string
    type: string
    isOptional: boolean
  }>
}

const { t } = useI18n()
const props = defineProps<Props>()

const emit = defineEmits<{
  inputRemoved: [name: string]
  cancel: []
}>()

const toast = useToast()
const { removeNodeInput } = useNodeEditingService()

// 表单数据
const selectedInput = ref('')

// 错误状态
const errors = reactive({
  input: ''
})

// 输入选项
const inputOptions = computed(() => {
  return props.existingInputs.map(input => ({
    label: `${input.name} (${input.type})`,
    value: input.name
  }))
})

// 选中的输入信息
const selectedInputInfo = computed(() => {
  if (!selectedInput.value) return null
  return props.existingInputs.find(input => input.name === selectedInput.value)
})

// 表单验证
const validateInput = () => {
  errors.input = ''
  
  if (!selectedInput.value) {
    errors.input = t('nodePropertiesPanel.removeInputDialog.name')
    return false
  }
  
  return true
}

const isFormValid = computed(() => {
  return selectedInput.value && !errors.input
})

// 提交处理
const handleSubmit = () => {
  if (!validateInput()) {
    return
  }
  
  try {
    removeNodeInput(props.node, selectedInput.value)
    
    toast.add({
      severity: 'success',
      summary: t('nodePropertiesPanel.success'),
      detail: t('nodePropertiesPanel.removeInputDialog.success_message', {name: selectedInput.value.trim()}),
      life: 3000
    })
    
    emit('inputRemoved', selectedInput.value)
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('nodePropertiesPanel.error'),
      detail: t('nodePropertiesPanel.removeInputDialog.error_message', {error: error instanceof Error ? error.message : t('nodePropertiesPanel.unknown_error')}),
      life: 5000
    })
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.remove-input-form {
  @apply flex flex-col gap-6;
}

.form-content {
  @apply flex flex-col gap-4;
}

.no-inputs {
  @apply flex flex-col items-center gap-3 py-8 text-center;
}

.field {
  @apply flex flex-col gap-2;
}

.field-label {
  @apply font-medium text-sm;
}

.input-info {
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

