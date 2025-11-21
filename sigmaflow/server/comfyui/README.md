# Workspace based on ComfyUI

```bash
git clone https://github.com/Comfy-Org/ComfyUI_frontend
cd ComfyUI_frontend
pnpm install
vi vite.config.mts # -> base: '/workspace/',
pnpm run build
```

```bash
modified:   src/locales/en/main.json
modified:   src/locales/zh/main.json
modified:   src/services/litegraphService.ts

Untracked files:
src/services/nodeEditingService.ts
src/components/dialog/content/NodeEditingDialogContent.vue
src/components/dialog/content/nodeEditing/
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
