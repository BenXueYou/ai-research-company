import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/issue34-dist/tests/browser',
  testMatch: 'console-navigation.spec.js',
  outputDir: '../../.scratch/playwright-results/issue34',
  workers: 1,
  timeout: 90000,
  preserveOutput: 'always',
  use: { baseURL: 'http://127.0.0.1:3199', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});

