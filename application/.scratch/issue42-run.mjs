import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const name = `issue42_${randomUUID().replaceAll('-', '')}_test`;
const source = new URL(process.env.DATABASE_URL);
source.pathname = '/postgres';
const admin = new pg.Pool({ connectionString: source.toString() });
await admin.query(`CREATE DATABASE "${name}"`);
source.pathname = `/${name}`;
try {
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue42-real.config.ts'], { env: { ...process.env, TEST_DATABASE_URL: source.toString() }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  if (!/^issue42_[0-9a-f]+_test$/.test(name)) throw new Error('Unsafe cleanup database');
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
