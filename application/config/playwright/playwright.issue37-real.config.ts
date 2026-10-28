import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue37-real-dist/tests',
  testMatch: '**/tests/issue37-real.spec.js',
  outputDir: '../../.scratch/issue37-real-results',
  preserveOutput: 'never',
  workers: 1,
  timeout: 120000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
