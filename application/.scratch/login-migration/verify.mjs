import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const appFile = resolve('web/App.vue').replaceAll('\\', '/');
const before = await readFile('.scratch/login-migration/App.before.vue', 'utf8');
await build({ logLevel: 'error', plugins: [{ name: 'login-before', enforce: 'pre', load(id) { if (id.replaceAll('\\', '/') === appFile) return before; } }], build: { outDir: '.scratch/login-migration/baseline-web' } });
const browser = await chromium.launch();
const results = [];
try {
  for (const [variant, directory] of [['before', '.scratch/login-migration/baseline-web'], ['after', 'dist/web']]) {
    const serverApp = express();
    serverApp.use(express.static(resolve(directory), { dotfiles: 'allow' }));
    serverApp.get(/.*/, (_req, res) => res.sendFile(resolve(directory, 'index.html'), { dotfiles: 'allow' }));
    const server = await new Promise(done => { const listener = serverApp.listen(0, '127.0.0.1', () => done(listener)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const scenario of [
        { name: 'platform', email: 'super_admin', role: 'platform', target: '/platform/overview' },
        { name: 'distributor', email: 'Distinct.Local+tag@EXAMPLE.COM', role: 'distributor', target: '/distribution/organizations' },
        { name: 'admin', email: 'admin@example.com', role: 'admin', target: '/terminal/search' },
        { name: 'sales', email: 'sales@example.com', role: 'sales', target: '/terminal/search' },
        { name: 'temporary', email: 'temporary@example.com', role: 'sales', mustChange: true },
        { name: 'invalid', email: 'wrong@example.com', failure: 401 },
        { name: 'network', email: 'network@example.com', failure: 'network' }
      ]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        let authenticated = false;
        const bodies = [];
        let release;
        const gate = new Promise(done => { release = done; });
        await page.route('**/api/**', async route => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === '/api/auth/session') return route.fulfill(authenticated ? { json: { id: 'distinct-account-id', email: 'different-response@example.com', loginName: 'different-login-name', role: scenario.role, mustChange: !!scenario.mustChange } } : { status: 401, json: { message: '请重新登录' } });
          if (pathname === '/api/auth/login') {
            bodies.push(route.request().postDataJSON());
            await gate;
            if (scenario.failure === 'network') return route.abort();
            if (scenario.failure) return route.fulfill({ status: scenario.failure, json: { message: '账号或密码错误' } });
            authenticated = true;
            return route.fulfill({ json: {} });
          }
          return route.fulfill({ json: {} });
        });
        try {
          await page.goto(origin + '/help');
          const email = page.getByLabel('登录账号', { exact: true });
          const password = page.getByLabel('密码', { exact: true });
          const submit = page.getByRole('button', { name: '登录', exact: true });
          await expect(email).toBeVisible();
          await submit.click();
          assert.equal(bodies.length, 0);
          await email.fill(scenario.email);
          await expect(email).toHaveAttribute('type', scenario.email === 'super_admin' ? 'text' : 'email');
          await password.fill('MigrationPwd123!');
          await submit.click();
          await expect(page.getByRole('button', { name: '正在登录…' })).toBeDisabled();
          await expect(email).toBeDisabled();
          await expect(password).toBeDisabled();
          await expect.poll(() => bodies.length).toBe(1);
          assert.deepEqual(bodies, [{ email: scenario.email, password: 'MigrationPwd123!' }]);
          release();
          if (scenario.failure) {
            await expect(submit).toBeEnabled();
            await expect(password).toHaveValue('');
            await expect(email).toHaveValue(scenario.email);
            await expect(page.locator('.error-message')).toBeVisible();
          } else if (scenario.mustChange) {
            await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
            await expect(page).toHaveURL(origin + '/help');
            await expect(page.locator('#console-sidebar')).toHaveCount(0);
          } else {
            await expect(page).toHaveURL(origin + scenario.target);
          }
          results.push({ variant, scenario: scenario.name, body: bodies[0], result: 'passed' });
        } finally { release(); await context.close(); }
      }
    } finally { await new Promise(done => server.close(done)); }
  }
  const store = await readFile('web/stores/session.ts', 'utf8');
  assert.equal(store, await readFile('.scratch/login-migration/session.before.ts', 'utf8'));
  await writeFile('.scratch/login-migration/results.json', JSON.stringify(results, null, 2));
  console.log(`Passed ${results.length} browser scenarios across before/after builds; session store unchanged.`);
} finally { await browser.close(); }


