import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: process.env.DISTRIBUTION_RUN + '/dist/integration-distribution',
  testMatch: 'distribution.spec.js',
  outputDir: process.env.DISTRIBUTION_RUN + '/results',
  preserveOutput: 'never', workers: 1, timeout: 180000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off', actionTimeout: 10000 },
  reporter: [['list']]
});
