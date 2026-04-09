<template>
  <div class="home-badges">
    <a href="https://www.npmjs.com/package/@nestjs-odata/core" target="_blank" rel="noopener">
      <img src="https://img.shields.io/npm/v/@nestjs-odata/core" alt="npm version" />
    </a>
    <a href="https://www.npmjs.com/package/@nestjs-odata/core" target="_blank" rel="noopener">
      <img src="https://img.shields.io/npm/dm/@nestjs-odata/core" alt="npm downloads" />
    </a>
    <a href="https://github.com/cberd1509/nestjs-odata/actions" target="_blank" rel="noopener">
      <img src="https://img.shields.io/github/actions/workflow/status/cberd1509/nestjs-odata/ci.yml" alt="CI" />
    </a>
    <a href="https://github.com/cberd1509/nestjs-odata/blob/main/LICENSE" target="_blank" rel="noopener">
      <img src="https://img.shields.io/github/license/cberd1509/nestjs-odata" alt="license" />
    </a>
  </div>
</template>

<style scoped>
.home-badges {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.home-badges a {
  display: inline-flex;
}
.home-badges img {
  height: 20px;
}
</style>
