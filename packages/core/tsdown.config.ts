import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs', 'typeorm', '@nestjs/typeorm'],
})
