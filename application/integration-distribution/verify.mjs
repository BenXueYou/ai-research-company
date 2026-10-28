import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
const run = resolve('.scratch/integration-distribution/' + randomBytes(6).toString('hex'));
mkdirSync(run, { recursive: true });
writeFileSync(resolve('.scratch/integration-distribution/.gitignore'), '*\n');
const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const source = parseEnv(readFileSync('.env', 'utf8'));
const url = new URL(source.DATABASE_URL); url.pathname = '/postgres';
const admin = new pg.Client({ connectionString: url.href }); await admin.connect();
const database = 'integration_distribution_' + randomBytes(8).toString('hex') + '_test';
await admin.query('CREATE DATABASE "' + database + '"'); await admin.end();
url.pathname = '/' + database;
const env = { ...process.env, DISTRIBUTION_RUN: run, DISTRIBUTION_PORT: String(port),
  TEST_DATABASE_URL: url.href, ORG_CONTACT_KEY: randomBytes(32).toString('hex'), SMTP_CREDENTIAL_KEY: randomBytes(32).toString('hex') };
writeFileSync(run + '/environment.json', JSON.stringify({ database, port, run }, null, 2));
function sources() {
  const files = [];
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = dir + '/' + item.name;
      if (item.isDirectory()) walk(path); else if (/\.(ts|vue|css)$/.test(path) && !path.endsWith('.test.ts')) files.push(path);
    }
  }
  walk('web'); walk('server'); walk('integration-distribution');
  return Object.fromEntries(files.sort().map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
}
const before = sources();
function node(args) {
  const child = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (child.status !== 0) process.exit(child.status ?? 1);
}
console.log('Isolated distribution integration: ' + database + ', port ' + port);
node(['node_modules/typescript/bin/tsc', '-p', 'integration-distribution/tsconfig.json', '--outDir', run + '/dist']);
node(['node_modules/vite/bin/vite.js', 'build', '--outDir', run + '/web']);
node(['node_modules/@playwright/test/cli.js', 'test', '--config', 'integration-distribution/playwright.config.ts']);
const after = sources();
const stable = JSON.stringify(before) === JSON.stringify(after);
writeFileSync(run + '/source-manifest.json', JSON.stringify({ stable, before, after }, null, 2));
if (!stable) { console.error('Shared sources changed during verification; rerun before final acceptance.'); process.exit(2); }
console.log('Evidence: ' + run + '/evidence.json');
