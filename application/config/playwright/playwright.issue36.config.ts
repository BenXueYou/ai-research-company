import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/issue36-dist/tests',
  testMatch: '**/tests/role-help.spec.js',
  outputDir: '../../.scratch/playwright-results/issue36',
  workers: 1,
  timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3399', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});


