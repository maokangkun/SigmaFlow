import '@/assets/index.css'
import App from './App.vue'
import router from '@/router'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { autoAnimatePlugin } from '@formkit/auto-animate/vue'

createApp(App)
  .use(router)
  .use(createPinia())
  .use(autoAnimatePlugin)
  .mount('#app')
