import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue42-real-dist/tests',
  testMatch: 'issue42-settings-real.spec.js',
  testIgnore: '**/browser/**',
  outputDir: '../../.scratch/issue42-real-results',
  workers: 1,
  timeout: 120000,
  preserveOutput: 'never',
  use: { actionTimeout: 10000, browserName: 'chromium', trace: 'off', screenshot: 'off' },
  webServer: process.env.ISSUE42_DEV === '1' ? {
    command: 'node node_modules/vite/bin/vite.js --config config/playwright/vite.issue42.config.ts',
    cwd: '../..',
    url: 'http://127.0.0.1:5342/platform/settings',
    reuseExistingServer: false
  } : undefined,
  reporter: [['list']]
});
