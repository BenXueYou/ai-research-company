import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/router-upstream-dist/tests/issue45-tests',
  testMatch: 'router-upstream.spec.js',
  outputDir: '../../.scratch/playwright-results/router-upstream',
  workers: 1,
  timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3205', browserName: 'chromium' },
  reporter: [['list']]
});
