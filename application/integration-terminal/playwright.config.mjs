import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../.scratch/integration-terminal/compiled/integration-terminal',
  testMatch: '*.spec.js', outputDir: '../.scratch/integration-terminal/results',
  workers: 1, timeout: 240000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off', actionTimeout: 12000 },
  reporter: [['list']]
});
