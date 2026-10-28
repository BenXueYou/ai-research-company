import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue56/compiled/tests',
  testMatch: 'issue56-emails.spec.js',
  outputDir: '../../.scratch/issue56/playwright-results',
  workers: 1,
  timeout: 180000,
  preserveOutput: 'never',
  use: {
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
