import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Testing Library's own default is 1000ms, and a slow CI runner opens a modal
// later than that. It only lengthens queries that were going to fail.
configure({ asyncUtilTimeout: 10000 })

// Some layout code reads ResizeObserver; JSDOM does not provide it.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe(): void {
    /* noop */
  }
  unobserve(): void {
    /* noop */
  }
  disconnect(): void {
    /* noop */
  }
} as unknown as typeof globalThis.ResizeObserver
