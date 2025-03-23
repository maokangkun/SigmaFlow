import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/pages/Home.vue'),
    children: [
      {
        path: '/',
        name: 'Flows',
        component: () => import('@/pages/Flows.vue'),
      },
      {
        path: '/templates',
        name: 'Templates',
        component: () => import('@/pages/Templates.vue'),
      },
      {
        path: '/apps',
        name: 'FlowApps',
        component: () => import('@/pages/FlowApps.vue'),
      },
    ],
  },
  {
    path: '/flow/:id',
    name: 'Flow',
    component: () => import('@/pages/Flow.vue'),
  },
  {
    path: '/app/:id',
    name: 'FlowApp',
    component: () => import('@/pages/FlowApp.vue'),
  },
]

const router = createRouter({
  history: createWebHistory('/mc/'),
  routes,
})

export default router
