import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../../server/app.js';
import { hashPassword } from '../../server/identity/policy.js';
import { HttpTengdaoCompanyClient, type TengdaoSharedState } from '../../server/upstream/tengdao.js';
import { testDatabase } from '../helpers.js';

test('上游独立页读取、刷新、失败与权限', async ({ page }) => {
  const { pool } = await testDatabase();
  const origin = 'http://127.0.0.1:3205';
  const calls: string[] = [];
  const refreshBodies: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/upstream-monitor/refresh') && request.method() === 'POST')
      refreshBodies.push(request.postDataJSON());
  });
  let usageFail = false;
  let accountMode: 'success' | 'retry' | 'fail' = 'success';
  let retried = false;
  const state: TengdaoSharedState = {
    token: async () => token,
    cacheToken: async value => { token = value; },
    tryTokenLock: async () => true,
    releaseTokenLock: async () => {},
    reserve: async kind => { calls.push(`reserve:${kind}`); },
    usage: async () => {
      if (usageFail) throw new Error('count unavailable');
      return { minute: 7, dataToday: 13, businessToday: 5 };
    }
  };
  let token: string | null = null;
  const vendor = new HttpTengdaoCompanyClient(state, {
    baseUrl: 'https://vendor.example', apiKey: 'test-only', businessDailyLimit: 40,
    fetch: (async input => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/v2/access-token') return Response.json({ success: true, code: 200, data: { accessToken: 'fake', expiresIn: 3600, unit: 'SECONDS' } });
      if (accountMode === 'retry' && !retried) { retried = true; return Response.json({ success: false, code: '40302', data: null }); }
      if (accountMode === 'fail') return Response.json({ success: false, code: '40102', data: null });
      return Response.json({ success: true, code: 200, traceId: 'updated-trace', data: { balance: '123.50', expiresIn: '2027-01-01' } });
    }) as typeof fetch
  });
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, vendor, undefined, undefined, undefined, undefined, resolve('issue45-test-web'));
  await app.listen(3205, '127.0.0.1');
  try {
    const platform = randomUUID(); const account = randomUUID(); const terminal = randomUUID(); const tenantAccount = randomUUID();
    expect(new Set([platform, account, terminal, tenantAccount]).size).toBe(4);
    const hash = await hashPassword('Issue45Password!');
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'platform','platform')", [platform]);
    await pool.query("INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,'tenant','terminal',$2,'encrypted',$3,'***')", [terminal, platform, randomUUID()]);
    await pool.query("INSERT INTO accounts(id,organization_id,username,password_hash,role,must_change) VALUES($1,$2,'super_admin',$3,'platform',false)", [account, platform, hash]);
    await pool.query("INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,'tenant45@example.com',$3,'admin',false)", [tenantAccount, terminal, hash]);
    const login = async (name: string) => {
      await page.goto(origin);
      await page.getByLabel('登录账号', { exact: true }).fill(name);
      await page.getByLabel('密码', { exact: true }).fill('Issue45Password!');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
    };
    await login('super_admin');
    await page.goto(`${origin}/platform/reconciliation/upstream`);
    const monitor = page.getByRole('region', { name: '腾道共享账号监控' });
    await expect(monitor.getByText('尚无上游账户快照。')).toBeVisible();
    await expect(page.getByRole('link', { name: '上游与对账', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(monitor.getByText('尚无上游账户快照。')).toBeVisible();
    expect(calls).toEqual([]);
    await page.getByRole('link', { name: '上游与对账', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/platform/reconciliation`);
    await page.getByRole('link', { name: '查看上游监控页面' }).click();
    await expect(page).toHaveURL(`${origin}/platform/reconciliation/upstream`);
    await expect(monitor.getByText('尚无上游账户快照。')).toBeVisible();
    expect(calls).toEqual([]);
    await pool.query("INSERT INTO upstream_account_snapshot(singleton,balance,expires_in,trace_id,fetched_at) VALUES(true,'87.25','2026-12-31','old-trace','2026-10-01T00:00:00Z')");
    await page.reload();
    await expect(monitor.getByText('上游剩余点数：87.25')).toBeVisible();
    await expect(monitor.getByText('上游有效期：2026-12-31')).toBeVisible();
    await expect(monitor.getByText('最近获取：2026-10-01', { exact: false })).toBeVisible();
    await expect(monitor.getByText('本分钟调用：7 / 180')).toBeVisible();
    usageFail = true;
    await page.reload();
    await expect(monitor.getByText('当前调用计数暂不可读取；历史账户快照仍可查看。')).toBeVisible();
    await expect(monitor.getByText('上游剩余点数：87.25')).toBeVisible();
    usageFail = false;
    await pool.query('ALTER TABLE upstream_account_snapshot RENAME TO issue45_hidden_snapshot');
    try {
      await page.reload();
      await expect(monitor.getByRole('alert')).toBeVisible();
    } finally {
      await pool.query('ALTER TABLE issue45_hidden_snapshot RENAME TO upstream_account_snapshot');
    }
    await page.reload();
    await expect(monitor.getByText('上游剩余点数：87.25')).toBeVisible();
    expect(calls).toEqual([]);
    accountMode = 'retry';
    await monitor.getByRole('button', { name: '更新上游状态' }).click();
    await expect(monitor.getByText('上游剩余点数：123.50')).toBeVisible();
    expect(calls).toEqual(['reserve:business', '/v2/access-token', 'reserve:business', '/v2/account', 'reserve:business', '/v2/access-token', 'reserve:business', '/v2/account']);
    accountMode = 'fail';
    await monitor.getByRole('button', { name: '更新上游状态' }).click();
    await expect(monitor.getByRole('alert')).toBeVisible();
    await expect(monitor.getByText('调用频率受限', { exact: false })).toBeVisible();
    await expect(monitor.getByText('上游剩余点数：123.50')).toBeVisible();
    expect(calls.slice(8)).toEqual(['reserve:business', '/v2/account']);
    expect(refreshBodies).toEqual([{}, {}]);
    expect((await pool.query('SELECT result,category FROM upstream_monitor_events ORDER BY id')).rows).toEqual([
      { result: 'success', category: null }, { result: 'failed', category: 'rate_limited' }
    ]);
    expect(Number((await pool.query('SELECT count(*) FROM query_point_ledger')).rows[0].count)).toBe(0);
    expect((await pool.query('SELECT balance,trace_id FROM upstream_account_snapshot')).rows[0]).toMatchObject({ balance: '123.50', trace_id: 'updated-trace' });
    const unconfiguredOrigin = 'http://127.0.0.1:3207';
    const unconfigured = await createApplication(pool, unconfiguredOrigin, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, resolve('issue45-test-web'));
    await unconfigured.listen(3207, '127.0.0.1');
    try {
      await page.goto(`${unconfiguredOrigin}/platform/reconciliation/upstream`);
      await expect(monitor.getByText('尚未配置正式腾道账号。')).toBeVisible();
      await expect(monitor.getByText('上游剩余点数：123.50')).toBeVisible();
      await expect(monitor.getByRole('button', { name: '更新上游状态' })).toBeDisabled();
      const csrf = (await page.context().cookies()).find(item => item.name === 'identity_csrf')?.value;
      expect(csrf).toBeTruthy();
      expect(await page.evaluate(async tokenValue => (await fetch('/api/upstream-monitor/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tokenValue! }, body: '{}'
      })).status, csrf)).toBe(503);
    } finally {
      await unconfigured.close();
    }
    await page.goto(`${origin}/platform/reconciliation/upstream`);
    await page.getByRole('button', { name: '退出登录' }).click();
    await login('tenant45@example.com');
    const postRefresh = async () => {
      const csrf = (await page.context().cookies()).find(item => item.name === 'identity_csrf')?.value;
      expect(csrf).toBeTruthy();
      return page.evaluate(async tokenValue => (await fetch('/api/upstream-monitor/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tokenValue! }, body: '{}'
      })).status, csrf);
    };
    expect(await page.evaluate(async () => (await fetch('/api/upstream-monitor')).status)).toBe(403);
    expect(await postRefresh()).toBe(403);
    await page.goto(`${origin}/platform/reconciliation/upstream`);
    await expect(page.getByRole('region', { name: '腾道共享账号监控' })).toHaveCount(0);
    await page.getByRole('button', { name: '退出登录' }).click();
    await login('super_admin');
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [platform]);
    expect(await page.evaluate(async () => (await fetch('/api/upstream-monitor')).status)).toBe(401);
    expect(await postRefresh()).toBe(401);
    expect(calls).toHaveLength(10);
  } finally {
    await app.close(); await pool.end();
  }
});









