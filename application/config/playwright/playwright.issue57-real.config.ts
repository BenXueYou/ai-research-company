import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue57/compiled/tests',
  testMatch: 'issue57-settings.spec.js',
  outputDir: '../../.scratch/issue57/results',
  preserveOutput: 'never',
  workers: 1,
  timeout: 240000,
  use: {
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off',
    actionTimeout: 10000
  },
  reporter: [['list']]
});
