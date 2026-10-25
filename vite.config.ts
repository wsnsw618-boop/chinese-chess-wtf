import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
  worker: {
    format: 'es',
  },
  server: {
    watch: {
      ignored: [
        '**/*.tmpdir/**',
        '**/.*.tmpdir/**',
        '**/*.tmp',
        '**/dist/**',
        '**/release/**',
        '**/sim/results/**',
        '**/*.zip',
      ],
    },
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
