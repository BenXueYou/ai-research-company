import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../tests/issue46-tests',
  testMatch: '*.spec.mjs',
  outputDir: '../../.scratch/playwright-results/issue46',
  workers: 1,
  timeout: 120000,
  preserveOutput: 'never',
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
