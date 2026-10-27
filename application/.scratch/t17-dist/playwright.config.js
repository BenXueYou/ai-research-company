import { defineConfig } from '@playwright/test';
// Failure DOM snapshots can contain the one-time credential handoff.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
    testDir: './dist/tests/browser',
    workers: 1,
    timeout: 45000,
    preserveOutput: 'never',
    use: { baseURL: 'http://127.0.0.1:3092', browserName: 'chromium', trace: 'off', screenshot: 'off' },
    reporter: [['list']],
});
//# sourceMappingURL=playwright.config.js.map