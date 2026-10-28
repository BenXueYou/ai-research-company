import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/issue49/dist/tests',
  testMatch: ['**/issue49-accounts.spec.js', '**/issue49-regression.spec.js'],
  outputDir: '../../.scratch/issue49/results',
  preserveOutput: 'never',
  workers: 1,
  timeout: 120000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
