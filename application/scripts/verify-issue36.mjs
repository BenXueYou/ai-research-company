import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

// This runner creates its own disposable database and never reads local .env files.
const runId = randomBytes(5).toString('hex');
const root = resolve(`.scratch/issue36/${runId}`);
const databaseName = `issue36_${runId}_test`;
const container = `codex-issue36-${runId}`;
const password = randomBytes(24).toString('hex');
const environment = {
  ...process.env,
  ORG_CONTACT_KEY: randomBytes(32).toString('hex'),
  SMTP_CREDENTIAL_KEY: randomBytes(32).toString('hex')
};
for (const key of ['DATABASE_URL', 'REDIS_URL', 'TENGDAO_BASE_URL', 'TENGDAO_API_KEY', 'TENGDAO_BUSINESS_DAILY_LIMIT']) delete environment[key];
const evidence = { runId, databaseName, container, checks: [] };
await mkdir(root, { recursive: true });
await writeFile(resolve('.scratch/issue36/.gitignore'), '*\n');

async function command(executable, args, env = environment, quiet = false) {
  const code = await new Promise((done, reject) => {
    const child = spawn(executable, args, { env, stdio: quiet ? 'ignore' : 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', done);
  });
  if (code !== 0) throw new Error(`Issue36 command failed: ${executable} (exit ${code})`);
}
async function port() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const selected = server.address().port;
  await new Promise(done => server.close(done));
  return selected;
}
async function check(name, args, env) {
  await command(process.execPath, args, env);
  evidence.checks.push({ name, status: 'passed' });
}
let started = false;
try {
  await check('Vue typecheck', ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit']);
  await check('isolated server compilation', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json', '--outDir', `${root}/compiled`]);
  await check('isolated Vite build', ['node_modules/vite/bin/vite.js', 'build', '--outDir', `${root}/web`]);
  const dbPort = await port();
  await command('docker', ['run', '--rm', '-d', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', `POSTGRES_DB=${databaseName}`, '-p', `127.0.0.1:${dbPort}:5432`, 'postgres:17'], environment, true);
  started = true;
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${dbPort}/${databaseName}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise(done => setTimeout(done, 500));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
  evidence.databasePort = dbPort;
  for (const mode of ['built', 'development']) {
    const httpPort = await port();
    const vitePort = await port();
    evidence[mode] = { httpPort, vitePort: mode === 'development' ? vitePort : null };
    await check(`${mode} Chromium + HTTP + PostgreSQL`, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue36.config.ts'], {
      ...environment,
      TEST_DATABASE_URL: connectionString,
      ISSUE36_MODE: mode,
      ISSUE36_HTTP_PORT: String(httpPort),
      ISSUE36_VITE_PORT: String(vitePort),
      ISSUE36_WEB_ROOT: `${root}/web`,
      ISSUE36_COMPILED_TESTS: `${root}/compiled/tests`,
      ISSUE36_RESULTS: `${root}/${mode}-results`
    });
  }
} finally {
  if (started) await command('docker', ['stop', container], environment, true);
  await writeFile(`${root}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`Issue36 evidence: ${root}/evidence.json`);
}
