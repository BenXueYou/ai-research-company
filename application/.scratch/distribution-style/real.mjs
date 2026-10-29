import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const dir = '.scratch/distribution-style';
for (const issue of ['48-organizations', '50-distribution-orders', '51-profit']) {
  const file = `${dir}/compiled/tests/issue${issue}.spec.js`;
  let source = readFileSync(file, 'utf8');
  source = source.replaceAll(/\.scratch\/issue(?:48|50|51)\/web/g, 'dist/web');
  source = source.replaceAll('../docs/delivery/application/ISSUE-51-EVIDENCE.json', `${dir}/issue51-evidence.json`);
  writeFileSync(file, source);
}
for (const id of [48, 50, 51]) mkdirSync(`.scratch/issue${id}`, { recursive: true });
const url = new URL(process.env.TEST_DATABASE_URL);
if (!url.pathname.endsWith('_test')) throw Error('Dedicated test URL required');
url.pathname = '/postgres';
const admin = new pg.Pool({ connectionString: url.toString() });
const name = `distribution_style_${randomUUID().replaceAll('-', '')}_test`;
await admin.query(`CREATE DATABASE "${name}"`);
url.pathname = '/' + name;
try {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', `${dir}/real.config.mjs`, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env: { ...process.env, TEST_DATABASE_URL: url.toString() } });
  process.exitCode = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
} finally {
  if (!/^distribution_style_[0-9a-f]{32}_test$/.test(name)) throw Error('Unexpected database name');
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
