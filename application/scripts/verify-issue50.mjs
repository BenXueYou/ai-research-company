import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) throw new Error('需要数据库管理连接以创建独立测试库');
const source = new URL(process.env.DATABASE_URL);
source.pathname = '/issue50_connection_test';
const result = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test',
  '--config', 'config/playwright/playwright.issue50.config.ts'
], {
  env: { ...process.env, TEST_DATABASE_URL: source.toString() },
  stdio: 'inherit'
});
process.exitCode = result.status ?? 1;
