import { defineConfig } from '@playwright/test';

export default defineConfig({
  outputDir: '../../.scratch/playwright-results/t19',
  testDir: '../../dist/tests/browser',
  testMatch: /smtp-channel\.spec\.js/,
  workers: 1,
  timeout: 60000,
  preserveOutput: 'never',
  use: {
    baseURL: 'http://127.0.0.1:3094',
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
