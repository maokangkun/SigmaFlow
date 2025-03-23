<script setup lang="ts">
import { cn } from '@/lib/utils'
</script>

<template>
  <span
    :class="cn('text-xs mr-2 tracking-widest opacity-70', $attrs.class ?? '')"
  >
    <slot />
  </span>
</template>
