import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Only create and truncate a new random test database; never initialize the source database.
mkdirSync('.scratch/issue48', { recursive: true });
const source = parseEnv(readFileSync('.env', 'utf8'));
const url = new URL(source.DATABASE_URL);
const name = 'issue48_' + randomBytes(5).toString('hex') + '_test';
url.pathname = '/postgres';
const admin = new pg.Client({ connectionString: url.href });
await admin.connect();
await admin.query('CREATE DATABASE "' + name + '"');
await admin.end();
url.pathname = '/' + name;
writeFileSync('.scratch/issue48/test.env', 'TEST_DATABASE_URL=' + url.href + '\nORG_CONTACT_KEY=' + randomBytes(32).toString('hex') + '\nSMTP_CREDENTIAL_KEY=' + randomBytes(32).toString('hex') + '\n');
writeFileSync('.scratch/issue48/environment.json', JSON.stringify({ database: name, backend: 3488, stateRegression: 3489, viteBackend: 3490, vite: 5488 }));
console.log('Created isolated test database: ' + name);
function node(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
node(['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit']);
node(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json', '--outDir', '.scratch/issue48/dist']);
node(['node_modules/vite/bin/vite.js', 'build', '--outDir', '.scratch/issue48/web']);
node(['--env-file=.scratch/issue48/test.env', 'node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue48.config.ts']);
// Reuse the existing T26 suite sequentially, with this ticket's isolated HTTP port and database.
const statePath = '.scratch/issue48/dist/tests/organization-state.test.js';
writeFileSync(statePath, readFileSync(statePath, 'utf8').replaceAll('3196', '3489'));
node(['--env-file=.scratch/issue48/test.env', '--test', statePath]);
