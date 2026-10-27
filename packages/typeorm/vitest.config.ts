import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/index.ts'],
      thresholds: {
        statements: 80,
        // Vitest 4's V8 provider uses AST-aware remapping, which counts far more
        // branches than Vitest 3 did (same suite: 83% under v3, 72% under v4).
        // Threshold lowered to match the new measurement; raise it back as
        // translator/visitor branch coverage improves.
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
})
