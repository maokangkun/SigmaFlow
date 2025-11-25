import { app } from '@/scripts/app'
import { type DOMWidget } from '@/scripts/domWidget'
import { ComfyWidgets } from '@/scripts/widgets'
import { useExtensionService } from '@/services/extensionService'

useExtensionService().registerExtension({
  name: 'Comfy.LLMNodePreview',
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === 'LLMNode') {
      const onNodeCreated = nodeType.prototype.onNodeCreated

      // 1. 注入 onNodeCreated，创建预览 Widget
      nodeType.prototype.onNodeCreated = function () {
        // 调用原始的 onNodeCreated
        onNodeCreated ? onNodeCreated.apply(this, []) : undefined

        // 创建一个 MARKDOWN 类型的 Widget 用于显示预览文本
        const showValueWidget = ComfyWidgets['MARKDOWN'](
          this,
          'preview', // 使用一个唯一的名称
          ['MARKDOWN', {}],
          app
        ).widget as DOMWidget<HTMLTextAreaElement, string>

        showValueWidget.element.readOnly = true
        // 不序列化到工作流中
        showValueWidget.serialize = false
      }

      const onExecuted = nodeType.prototype.onExecuted

      // 2. 注入 onExecuted，接收后端返回的数据并更新 Widget
      nodeType.prototype.onExecuted = function (message) {
        // 调用原始的 onExecuted
        onExecuted === null || onExecuted === void 0
          ? void 0
          : onExecuted.apply(this, [message])

        // 查找我们创建的预览 Widget
        const previewWidget = this.widgets?.find((w) => w.name === 'preview')

        if (previewWidget && message.text && Array.isArray(message.text) && message.text.length > 0) {
          previewWidget.value = message.text[0]
        }
      }
    }
  }
})