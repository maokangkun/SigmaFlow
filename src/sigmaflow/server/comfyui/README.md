# Workspace based on ComfyUI

```bash
git clone https://github.com/Comfy-Org/ComfyUI_frontend
cd ComfyUI_frontend
pnpm install
vi vite.config.mts # -> base: '/workspace/', build->outDir: 'xxx/SigmaFlow/sigmaflow/server/comfyui/dist',
pnpm run build
```

```bash
modified:   src/locales/en/main.json
modified:   src/locales/zh/main.json
modified:   src/services/litegraphService.ts
modified:   src/composables/node/useNodePricing.ts
modified:   src/extensions/core/index.ts
modified:   build/plugins/generateImportMapPlugin.ts

Untracked files:
src/services/nodeEditingService.ts
src/components/dialog/content/NodeEditingDialogContent.vue
src/components/dialog/content/nodeEditing/
src/extensions/core/LLMNodePreview.ts
```

### src/services/litegraphService.ts
```js
import { useNodeEditingDialogService } from './nodeEditingService'


node.prototype.getExtraMenuOptions = function (_, options) {
      // 里面加

      // Add node editing options
      options.unshift({
        content: 'Edit Node',
        callback: () => {
          const { showNodeEditingDialog } = useNodeEditingDialogService()
          showNodeEditingDialog(this, 'addInput')
        }
      })
```

### src/composables/node/useNodePricing.ts
```js
    LLMNode: {
      displayPrice: '$0.00005/$0.0004 per 1K tokens'
    },
    OpenAIChatNode: ...
```

### src/extensions/core/index.ts
```js
import './LLMNodePreview'
```