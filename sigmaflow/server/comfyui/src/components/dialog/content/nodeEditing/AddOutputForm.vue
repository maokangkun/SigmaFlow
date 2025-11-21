<template>
  <div class="add-output-form">
    <div class="form-content">
      <div class="field">
        <label for="output-name" class="field-label">{{ $t('nodePropertiesPanel.addOutputDialog.name') }} *</label>
        <InputText
          id="output-name"
          v-model="formData.name"
          :placeholder="$t('nodePropertiesPanel.addOutputDialog.name_placeholder')"
          :class="{ 'p-invalid': errors.name }"
          @blur="validateName"
        />
        <small v-if="errors.name" class="p-error">{{ errors.name }}</small>
      </div>

      <div class="field">
        <label for="output-type" class="field-label">{{ $t('nodePropertiesPanel.addOutputDialog.type') }} *</label>
        <Dropdown
          id="output-type"
          v-model="formData.type"
          :options="outputTypes"
          option-label="label"
          option-value="value"
          :placeholder="$t('nodePropertiesPanel.addOutputDialog.type_placeholder')"
          :class="{ 'p-invalid': errors.type }"
          @change="validateType"
        />
        <small v-if="errors.type" class="p-error">{{ errors.type }}</small>
      </div>

      <div class="field">
        <div class="checkbox-wrapper">
          <Checkbox
            id="is-list"
            v-model="formData.isList"
            binary
          />
          <label for="is-list" class="checkbox-label">{{ $t('nodePropertiesPanel.addOutputDialog.list_out') }}</label>
        </div>
        <small class="field-help">{{ $t('nodePropertiesPanel.addOutputDialog.list_out_help') }}</small>
      </div>
    </div>

    <div class="form-actions">
      <Button
        :label="$t('nodePropertiesPanel.addOutput')"
        :disabled="!isFormValid"
        @click="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Checkbox from 'primevue/checkbox'
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
  outputAdded: [name: string]
  cancel: []
}>()

const toast = useToast()
const { addNodeOutput, getAvailableOutputTypes } = useNodeEditingService()

// 表单数据
const formData = reactive({
  name: '',
  type: '',
  isList: false
})

// 错误状态
const errors = reactive({
  name: '',
  type: ''
})

// 输出类型选项
const outputTypes = computed(() => {
  return getAvailableOutputTypes().map(type => ({
    label: type,
    value: type
  }))
})

// 表单验证
const validateName = () => {
  errors.name = ''
  
  if (!formData.name.trim()) {
    errors.name = t('nodePropertiesPanel.error_name_empty')
    return false
  }
  
  if (props.existingOutputs.some(output => output.name === formData.name.trim())) {
    errors.name = t('nodePropertiesPanel.error_name_exists')
    return false
  }
  
  return true
}

const validateType = () => {
  errors.type = ''
  
  if (!formData.type) {
    errors.type = t('nodePropertiesPanel.error_type_empty')
    return false
  }
  
  return true
}

const isFormValid = computed(() => {
  return formData.name.trim() && 
         formData.type && 
         !errors.name && 
         !errors.type
})

// 提交处理
const handleSubmit = () => {
  if (!validateName() || !validateType()) {
    return
  }
  
  try {
    addNodeOutput(
      props.node,
      formData.name.trim(),
      formData.type,
      formData.isList
    )
    
    toast.add({
      severity: 'success',
      summary: t('nodePropertiesPanel.success'),
      detail: t('nodePropertiesPanel.addOutputDialog.success_message', {name: formData.name.trim()}),
      life: 3000
    })
    
    emit('outputAdded', formData.name.trim())
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('nodePropertiesPanel.error'),
      detail: t('nodePropertiesPanel.addOutputDialog.error_message', {error: error instanceof Error ? error.message : t('nodePropertiesPanel.unknown_error')}),
      life: 5000
    })
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.add-output-form {
  @apply flex flex-col gap-6;
}

.form-content {
  @apply flex flex-col gap-4;
}

.field {
  @apply flex flex-col gap-2;
}

.field-label {
  @apply font-medium text-sm;
}

.field-help {
  @apply text-xs text-gray-500;
}

.checkbox-wrapper {
  @apply flex items-center gap-2;
}

.checkbox-label {
  @apply text-sm cursor-pointer;
}

.form-actions {
  @apply flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700;
}

:deep(.p-inputtext),
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

