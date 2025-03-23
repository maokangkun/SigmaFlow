<template>
  <main class="home">
    <Header />
    <div class="flex w-full h-full">
      <SideBar />
      <RouterView class="flex flex-col w-full p-6 pb-0" />
    </div>
  </main>
</template>

<script setup lang="ts"></script>

<style lang="scss">
main.home {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
}
</style>
