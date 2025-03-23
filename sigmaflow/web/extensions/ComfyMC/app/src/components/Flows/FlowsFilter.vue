<template>
  <div class="flex justify-between w-full">
    <FoldersCombobox @on-folder-change="onFolderChange" />
  </div>
</template>

<script setup lang="ts">
import { IFolder } from '@/types/IFlow'

function onFolderChange(folder?: IFolder) {
  useEventBus('Flows::Filter::Folder').emit(folder)
}
</script>

<style lang="scss"></style>
