<script setup>
import DefaultTheme from 'vitepress/theme'
import HomeBadges from './HomeBadges.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #home-hero-info-before>
      <HomeBadges />
    </template>
  </Layout>
</template>
