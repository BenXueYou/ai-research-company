import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: process.env.ISSUE36_COMPILED_TESTS ?? '../../.scratch/issue36-dist/tests',
  testMatch: '**/tests/role-help.spec.js',
  outputDir: process.env.ISSUE36_RESULTS ?? '../../.scratch/playwright-results/issue36',
  preserveOutput: 'never',
  workers: 1,
  timeout: 180000,
  use: {
    actionTimeout: 15000,
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});


