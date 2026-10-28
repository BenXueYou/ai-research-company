import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
function manifest(directory) {
  return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const path = `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/');
      return [path, createHash('sha256').update(readFileSync(path)).digest('hex')];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
const runId = randomUUID().replaceAll('-', '');
const root = `.scratch/compat-exit/${runId}`;
mkdirSync(root, { recursive: true });
const container = `codex-compat-${runId}`;
const password = randomBytes(24).toString('hex');
function run(cmd, args, env = process.env, stdio = 'inherit') {
  const result = spawnSync(cmd, args, { env, stdio, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Verification failed: ${args[0]}`);
  return result.stdout?.trim();
}
const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password };
run('docker', ['run', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=acquisition', '-e', `POSTGRES_DB=compat_${runId}_test`, 'postgres:17.6-alpine'], dockerEnv, 'pipe');
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
    await new Promise(done => setTimeout(done, 200));
  }
  if (!ready) throw new Error('Isolated database not ready');
  const port = run('docker', ['port', container, '5432/tcp'], dockerEnv, 'pipe').split(':').at(-1);
  const env = { ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/compat_${runId}_test`, COMPAT_ROOT: root };
  const beforeSources = { ...manifest('web'), ...manifest('server') };
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json', '--outDir', `${root}/compiled`], env);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', `${root}/web`], env);
  writeFileSync(`${root}/playwright.config.mjs`, `export default { testDir: './compiled/tests', testMatch: 'console-compat-exit.spec.js', outputDir: './results', preserveOutput: 'never', workers: 1, timeout: 240000, use: { browserName: 'chromium', trace: 'off', screenshot: 'off', actionTimeout: 10000 }, reporter: [['list']] };`);
  run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', `${root}/playwright.config.mjs`], env);
  const afterSources = { ...manifest('web'), ...manifest('server') };
  const stable = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
  writeFileSync(`${root}/source.json`, JSON.stringify({ stable, sources: afterSources }, null, 2));
  if (!stable) throw new Error('Source changed during isolated verification');
} finally {
  run('docker', ['rm', '-fv', container], dockerEnv, 'pipe');
}
