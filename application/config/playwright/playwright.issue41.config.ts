import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue41-dist/verification',
  testMatch: 'issue41-procurement.spec.js',
  outputDir: '../../.scratch/issue41-results',
  preserveOutput: 'never',
  workers: 1,
  timeout: 120000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
