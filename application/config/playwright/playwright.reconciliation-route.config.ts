import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../reconciliation-route-tests',
  testMatch: 'reconciliation-route.spec.ts',
  outputDir: '../../.scratch/playwright-results/reconciliation-route',
  workers: 1,
  timeout: 45000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
