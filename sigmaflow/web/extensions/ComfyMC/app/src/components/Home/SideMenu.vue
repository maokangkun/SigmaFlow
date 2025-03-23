<template>
  <nav class="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 w-full">
    <Button
      v-for="item in menus"
      variant="ghost"
      size="lg"
      :key="item.title"
      :class="
        cn(
          'w-full font-normal text-left justify-start gap-2 rounded-lg',
          $route.path === `${item.route}` && 'bg-muted hover:bg-muted'
        )
      "
      @click="$router.push(item.route)"
    >
      <Render :render="item.icon" />
      {{ item.title }}
    </Button>
  </nav>
</template>

<script setup lang="tsx">
import Render from '@/lib/render'
import { cn } from '@/lib/utils'
import { LayoutTemplate, Route, Sparkle } from 'lucide-vue-next'

const menus = [
  {
    title: '工作流',
    route: '/',
    icon: <Route size={16} />,
  },
  {
    title: 'Apps',
    route: '/apps',
    icon: <Sparkle size={16} />,
  },
  {
    title: '模版',
    route: '/templates',
    icon: <LayoutTemplate size={16} />,
  },
]
</script>

<style lang="scss"></style>
