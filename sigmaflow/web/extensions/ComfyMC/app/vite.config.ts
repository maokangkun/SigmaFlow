import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import AutoImport from 'unplugin-auto-import/vite'
import VitePluginComponents from 'unplugin-vue-components/vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/mc',
  build: {
    outDir: '../web',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  plugins: [
    vue(),
    vueJsx(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        {
          'vue-sonner': ['toast'],
        },
        {
          '@vueuse/core': ['useEventBus'],
        },
      ],
    }),
    VitePluginComponents({
      deep: true,
    }),
  ],
  server: {
    port: 9366,
    strictPort: true,
    hmr: {
      overlay: true,
    },
  },
})
