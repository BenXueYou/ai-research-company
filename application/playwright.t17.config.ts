import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: './.scratch/t17-dist/tests/browser',
  testMatch: 'company-timeline.spec.js',
  outputDir: './.scratch/t17-playwright-results',
  workers: 1,
  timeout: 45_000,
  preserveOutput: 'never',
  use: { baseURL: 'http://127.0.0.1:3178', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
