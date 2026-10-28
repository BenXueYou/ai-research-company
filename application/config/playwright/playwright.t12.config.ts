import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/t12-dist/tests/browser',
  testMatch: 'product-search.spec.js',
  outputDir: '../../.scratch/playwright-results/t12',
  workers: 1,
  timeout: 45_000,
  preserveOutput: 'never',
  use: { baseURL: 'http://127.0.0.1:3123', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
