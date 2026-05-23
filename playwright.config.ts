import { defineConfig, devices } from '@playwright/test'

/** Playwright config for the mocked ATProto browser smoke tests. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_E2E_ATPROTO_MOCK: 'true',
      VITE_PUBLIC_APP_ORIGIN: 'http://127.0.0.1:4173',
      VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL: 'http://127.0.0.1:4173/client-metadata.json',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
