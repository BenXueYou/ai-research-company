import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL);
assert.ok(url.pathname.endsWith('_deploy_test'), '部署验收必须使用独立的空库 *_deploy_test');
const pool = new pg.Pool({ connectionString: url.href });
const origin = 'http://127.0.0.1:3093';
const env = { ...process.env, ORG_CONTACT_KEY: randomBytes(32).toString('hex'), DATABASE_URL: url.href, APP_ORIGIN: origin, PORT: '3093', NODE_ENV: 'test' };
let server;
function command(script) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000
  });
  // Never forward subprocess output, which might contain configuration on failures.
  assert.equal(result.status, 0, `${script} 失败；请在本地检查配置或构建`);
  assert.ok(!result.stdout.includes('init@Base123'));
}
try {
  assert.equal((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rowCount, 0, '仅接受空库，不清空已有数据');
  command('deploy');
  const before = (await pool.query('SELECT * FROM accounts')).rows[0];
  assert.equal(before.username, 'super_admin');
  assert.equal(before.email, null);
  command('db:migrate');
  assert.deepEqual((await pool.query('SELECT * FROM accounts')).rows[0], before);
  server = spawn(process.execPath, ['dist/server/main.js'], { env, stdio: 'ignore', windowsHide: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(origin)).status === 200; } catch { /* startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, '真实应用进程未启动');
  const login = password => fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'super_admin', password })
  });
  const first = await login('init@Base123');
  assert.equal(first.status, 200);
  const cookies = first.headers.getSetCookie().map(value => value.split(';')[0]);
  const headers = {
    Origin: origin, 'Content-Type': 'application/json', Cookie: cookies.join('; '),
    'X-CSRF-Token': cookies.find(value => value.startsWith('identity_csrf=')).slice(14)
  };
  assert.equal((await fetch(`${origin}/api/workspace`, { headers })).status, 403);
  const next = 'deployment-password-安全😀';
  assert.equal((await fetch(`${origin}/api/auth/password`, {
    method: 'POST', headers,
    body: JSON.stringify({ currentPassword: 'init@Base123', newPassword: next, confirmPassword: next })
  })).status, 200);
  command('bootstrap');
  assert.equal((await login('init@Base123')).status, 401);
  const authenticated = await login(next);
  assert.equal(authenticated.status, 200);
  assert.equal((await fetch(`${origin}/api/workspace`, { headers })).status, 401);
  assert.equal((await pool.query('SELECT * FROM accounts')).rowCount, 1);
  const nextCookies = authenticated.headers.getSetCookie().map(value => value.split(';')[0]);
  const openingHeaders = { ...headers, Cookie: nextCookies.join('; '), 'X-CSRF-Token': nextCookies.find(value => value.startsWith('identity_csrf=')).slice(14) };
  const request = { name: '部署验证终端', kind: 'terminal', countryCode: '+86', phone: '13690000001', email: 'Deploy.Owner@EXAMPLE.COM', requestId: randomUUID() };
  const opened = await fetch(`${origin}/api/organizations`, { method: 'POST', headers: openingHeaders, body: JSON.stringify(request) });
  assert.equal(opened.status, 201);
  const child = await opened.json();
  assert.equal(child.email, 'Deploy.Owner@example.com');
  assert.equal(child.temporaryPassword.length, 24);
  assert.equal((await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: openingHeaders,
    body: JSON.stringify({ email: child.email, password: child.temporaryPassword }) })).status, 200);
  command('bootstrap');
  assert.equal((await pool.query('SELECT * FROM accounts')).rowCount, 2);
  assert.equal((await fetch(`${origin}/api/organizations`, { method: 'POST', headers: openingHeaders, body: JSON.stringify(request) })).status, 409);
  console.log('PASS：部署脚本、新库内置账号、真实进程登录/改密与开户、重复初始化及重复开户保护。');
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  await pool.end();
}
