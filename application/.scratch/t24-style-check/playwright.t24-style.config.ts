import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/t24-style-check/compiled/tests',
  testMatch: 'issue56-emails.spec.js',
  outputDir: '../../.scratch/t24-style-check/playwright-results',
  workers: 1,
  timeout: 180000,
  use: { browserName: 'chromium', actionTimeout: 10000, trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
