import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: ['packages/liquidculture-ui/**'],
          environment: 'node'
        }
      },
      {
        test: {
          name: 'ui',
          include: ['packages/liquidculture-ui/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'http://localhost/' } },
          globals: true,
          setupFiles: ['packages/liquidculture-ui/src/test-setup.ts']
        }
      }
    ]
  }
})
