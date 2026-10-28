import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/issue48/dist/tests',
  testMatch: '**/issue48-organizations.spec.js',
  outputDir: '../../.scratch/issue48/results',
  preserveOutput: 'never',
  workers: 1,
  timeout: 120000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
