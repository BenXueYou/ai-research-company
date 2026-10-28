import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/platform-integration-dist/tests/browser',
  testMatch: 'platform-integration-*.spec.js',
  outputDir: '../../.scratch/platform-integration-results',
  workers: 1,
  timeout: 120000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
