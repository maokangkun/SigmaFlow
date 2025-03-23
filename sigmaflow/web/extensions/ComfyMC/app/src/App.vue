<template>
  <Toaster />
  <StatusBar />
  <RouterView />
</template>

<script setup lang="ts">
import useSocket from '@/use/useSocket'
import { Toaster } from '@/components/ui/sonner'

const { socketInit } = useSocket()
onMounted(() => {
  socketInit()
})
</script>

<style></style>
