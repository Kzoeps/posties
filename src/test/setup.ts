import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/** Cleans mounted React trees after every component test so tests cannot share DOM state. */
afterEach(() => {
  cleanup()
})
