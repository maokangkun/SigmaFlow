<template>
  <img :src="url" class="rounded-sm" v-if="file.type === 'image'" />
</template>

<script setup lang="ts">
import { apiBase } from '@/api/core/base'
import { ComfyDB_File } from '@/database/core/schema'

const props = defineProps<{
  file: ComfyDB_File
}>()

const url = computed(() => `${apiBase}${props.file.data}`)
</script>

<style lang="scss"></style>
