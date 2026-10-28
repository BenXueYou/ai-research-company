import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/issue35-dist/tests/browser',
  testMatch: 'issue35-completion.spec.js',
  outputDir: '../../.scratch/playwright-results/issue35-completion',
  workers: 1,
  timeout: 120000,
  preserveOutput: 'never',
  use: {
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
