import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { createServer } from 'node:net';
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const ports = { backend: await freePort(), viteBackend: await freePort(), vite: await freePort() };
process.env.ISSUE49_PORT = String(ports.backend);
process.env.ISSUE49_VITE_BACKEND = String(ports.viteBackend);
process.env.ISSUE49_VITE_PORT = String(ports.vite);

// Only create and truncate a new random test database; never initialize the source database.
mkdirSync('.scratch/issue49', { recursive: true });
const source = parseEnv(readFileSync('.env', 'utf8'));
const url = new URL(source.DATABASE_URL);
const name = 'issue49_' + randomBytes(5).toString('hex') + '_test';
url.pathname = '/postgres';
const admin = new pg.Client({ connectionString: url.href });
await admin.connect();
await admin.query('CREATE DATABASE "' + name + '"');
await admin.end();
url.pathname = '/' + name;
writeFileSync('.scratch/issue49/test.env', 'TEST_DATABASE_URL=' + url.href + '\nORG_CONTACT_KEY=' + randomBytes(32).toString('hex') + '\nSMTP_CREDENTIAL_KEY=' + randomBytes(32).toString('hex') + '\n');
writeFileSync('.scratch/issue49/environment.json', JSON.stringify({ database: name, ...ports }));
console.log('Created isolated test database: ' + name);
function node(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
node(['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit']);
node(['node_modules/typescript/bin/tsc', '-p', 'config/playwright/tsconfig.issue49.json', '--outDir', '.scratch/issue49/dist']);
node(['node_modules/vite/bin/vite.js', 'build', '--outDir', '.scratch/issue49/web']);
const regression = '.scratch/issue49/dist/tests/issue49-regression.spec.js';
writeFileSync(regression, readFileSync('.scratch/issue49/dist/tests/issue48-organizations.spec.js', 'utf8').replaceAll('issue48', 'issue49').replaceAll('3488', String(ports.backend)).replaceAll('3490', String(ports.viteBackend)).replaceAll('5488', String(ports.vite)).replace('await viteContext.close();', `await vitePage.goto(viteOrigin + '/distribution/organizations?view=accounts');
      await expect(vitePage.getByRole('heading', { name: '下级账户', exact: true })).toBeVisible();
      await vitePage.reload();
      await expect(vitePage.getByRole('heading', { name: '下级账户', exact: true })).toBeVisible();
      await viteContext.close();`));
node(['--env-file=.scratch/issue49/test.env' , 'node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue49.config.ts']);
