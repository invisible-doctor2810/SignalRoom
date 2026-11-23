/**
 * Runs specs against the DEPLOYED app (no local web server).
 *   SIGNALROOM_BASE_URL=https://signalroom-incidents.app.space npx playwright test -c tests/playwright.prod.config.ts <spec>
 * Uses the same test accounts as local runs and creates `__test-…` records.
 */
import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.SIGNALROOM_BASE_URL ?? 'https://signalroom-incidents.app.space',
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
})
