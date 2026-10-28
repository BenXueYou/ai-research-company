import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import { createApplication } from '../../server/app.js';
import { migrate } from '../../server/database.js';
import { hashPassword } from '../../server/identity/policy.js';
import { testDatabase } from '../helpers.js';

test('四角色导航、强制改密、隔离和直属组织参数', async ({ page, request }) => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3309';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('dist/web'));
  await app.listen(3309, '127.0.0.1');
  const stateRequests: Array<{ organizationId: string; active: boolean }> = [];
  const resetRequests: Array<{ accountId: string; requestId: string }> = [];
  page.on('request', item => {
    if (item.url().endsWith('/api/organizations/state') && item.method() === 'POST')
      stateRequests.push(item.postDataJSON());
    if (item.url().endsWith('/api/password-resets') && item.method() === 'POST')
      resetRequests.push(item.postDataJSON());
  });
  const login = async (name: string, password: string) => {
    await page.getByLabel('登录账号', { exact: true }).fill(name);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  };
  try {
    expect((await request.get(`${origin}/api/unknown`)).status()).toBe(404);
    expect((await request.head(`${origin}/platform/reconciliation/upstream`)).status()).toBe(200);
    expect((await request.get(`${origin}/not-a-console-page`)).status()).toBe(404);
    expect((await request.get(`${origin}/assets/missing.js`)).status()).toBe(404);
    expect((await request.get(`${origin}/api/organizations`)).status()).toBe(401);
    await page.goto(`${origin}/platform/organizations`);
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await login('super_admin', 'init@Base123');
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(403);
    await page.goto(`${origin}/terminal/search`);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    await page.getByLabel('当前密码', { exact: true }).fill('init@Base123');
    await page.getByLabel('新密码', { exact: true }).fill('Issue34PlatformPwd!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue34PlatformPwd!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await login('super_admin', 'Issue34PlatformPwd!');
    await expect(page).toHaveURL(`${origin}/platform/overview`);
    await expect(page.getByRole('link', { name: '运营概览' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: '下级管理', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/platform/organizations`);
    await page.reload();
    await expect(page.getByRole('link', { name: '下级管理', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('组织名称', { exact: true }).fill('导航测试直属组织');
    await page.getByRole('button', { name: '账号设置' }).click();
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page.getByLabel('组织名称', { exact: true })).toHaveValue('导航测试直属组织');
    await page.getByRole('link', { name: '帮助中心' }).click();
    await expect(page.getByRole('heading', { name: '帮助中心' })).toBeVisible();
    await expect(page.locator('#compat-organizations')).toBeHidden();
    await page.getByRole('button', { name: '进入账号设置' }).click();
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page).toHaveURL(`${origin}/platform/overview`);
    await page.getByRole('link', { name: '下级管理', exact: true }).click();
    await expect(page.getByLabel('组织名称', { exact: true })).toHaveValue('导航测试直属组织');
    await page.getByLabel('电话号码', { exact: true }).fill('13934001122');
    await page.getByLabel('管理员邮箱（登录账号）', { exact: true }).fill('child34@example.com');
    await page.getByRole('button', { name: '确认开户' }).click();
    await expect(page.getByRole('heading', { name: '开户成功' })).toBeVisible();
    await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
    const child = page.locator('.child-row').filter({ hasText: '导航测试直属组织' });
    await child.locator('summary').click();
    const created = (await pool.query(`SELECT o.id AS organization_id, a.id AS account_id, o.parent_id
      FROM organizations o JOIN accounts a ON a.organization_id=o.id WHERE o.name=$1`, ['导航测试直属组织'])).rows[0];
    expect(created.organization_id).not.toBe(created.account_id);
    expect(created.parent_id).not.toBe(created.account_id);
    await child.getByRole('button', { name: '重置管理员密码' }).click();
    await expect(page.getByRole('heading', { name: '管理员密码重置成功' })).toBeVisible();
    expect(resetRequests).toHaveLength(1);
    expect(resetRequests[0].accountId).toBe(created.account_id);
    expect(resetRequests[0].accountId).not.toBe(created.organization_id);
    await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
    await child.getByRole('button', { name: '停用组织' }).click();
    await expect(child.getByRole('button', { name: '恢复组织' })).toBeVisible();
    expect(stateRequests).toEqual([{ organizationId: created.organization_id, active: false }]);
    expect((await pool.query('SELECT active FROM organizations WHERE id=$1', [created.organization_id])).rows[0].active).toBe(false);
    await page.getByLabel('组织名称', { exact: true }).fill('响应丢失直属组织');
    await page.getByLabel('电话号码', { exact: true }).fill('13934001123');
    await page.getByLabel('管理员邮箱（登录账号）', { exact: true }).fill('lost35@example.com');
    const openingBodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/organizations', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      openingBodies.push(route.request().postDataJSON());
      if (openingBodies.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: '确认开户' }).click();
    await expect(page.locator('.organization-section .el-alert')).toBeVisible();
    await page.getByRole('button', { name: '账号设置' }).click();
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page.getByLabel('组织名称', { exact: true })).toHaveValue('响应丢失直属组织');
    expect(openingBodies).toHaveLength(1);
    await page.getByRole('button', { name: '确认开户' }).click();
    await expect(page.locator('.organization-section .el-alert')).toContainText('本次开户已完成');
    expect(openingBodies).toHaveLength(2);
    expect(openingBodies[1]).toEqual(openingBodies[0]);
    expect((await pool.query("SELECT count(*)::int AS count FROM organizations WHERE name=$1", ['响应丢失直属组织'])).rows[0].count).toBe(1);
    await page.unroute('**/api/organizations');
    await page.getByRole('link', { name: '点数与账务' }).click();
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/organizations`);
    await page.goForward();
    await expect(page.getByRole('link', { name: '点数与账务' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '账号设置' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await page.getByLabel('当前密码', { exact: true }).fill('Issue34PlatformPwd!');
    await page.getByLabel('新密码', { exact: true }).fill('Issue35NewPassword!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue35NewPassword!');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '平台设置' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByLabel('确认新密码', { exact: true })).toHaveValue('Issue35NewPassword!');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('Issue34PlatformPwd!');
    page.once('dialog', dialog => dialog.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('Issue35NewPassword!');
    page.once('dialog', dialog => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/ledger`);
    await page.goForward();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page).toHaveURL(`${origin}/platform/ledger`);
    await page.goto(`${origin}/platform/reconciliation/upstream`);
    await expect(page.getByRole('link', { name: '上游与对账' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#compat-organizations')).toBeHidden();
    const second = await page.context().browser()!.newContext();
    const other = await second.newPage();
    await other.goto(origin);
    await other.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await other.getByLabel('密码', { exact: true }).fill('Issue34PlatformPwd!');
    await other.getByRole('button', { name: '登录', exact: true }).click();
    await expect(other.getByRole('button', { name: '退出登录' })).toBeVisible();
    await page.getByRole('button', { name: '账号设置' }).click();
    await page.getByLabel('当前密码', { exact: true }).fill('wrong-password');
    await page.getByLabel('新密码', { exact: true }).fill('Issue35NewPassword!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue35NewPassword!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.locator('.error-message')).toBeVisible();
    await page.getByLabel('当前密码', { exact: true }).fill('Issue34PlatformPwd!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    expect(await other.evaluate(async () => (await fetch('/api/auth/session')).status)).toBe(401);
    await second.close();
    await login('super_admin', 'Issue35NewPassword!');
    await page.getByRole('button', { name: '退出登录' }).click();

    const platformId = (await pool.query("SELECT id FROM organizations WHERE kind='platform'")).rows[0].id;
    const distributorId = randomUUID();
    const terminalId = randomUUID();
    const pass = 'Issue34SharedPwd!';
    const hash = await hashPassword(pass);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'导航分销','distributor',$2,1,'encrypted','issue34-distributor','***'),
      ($3,'导航终端','terminal',$2,0,'encrypted','issue34-terminal','***')`, [distributorId, platformId, terminalId]);
    for (const [role, org] of [['distributor', distributorId], ['admin', terminalId], ['sales', terminalId]]) {
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,$4,$5,false)`, [randomUUID(), org, `${role}34@example.com`, hash, role]);
    }
    for (const [role, expectedPath] of [['distributor', '/distribution/organizations'], ['admin', '/terminal/search'], ['sales', '/terminal/search']]) {
      await login(`${role}34@example.com`, pass);
      await expect(page).toHaveURL(`${origin}${expectedPath}`);
      await expect(page.getByText('导航测试直属组织')).toHaveCount(0);
      const roleSource = role === 'distributor' ? '/distribution/orders' : '/terminal/usage';
      await page.goto(`${origin}${roleSource}`);
      await expect(page).toHaveURL(`${origin}${roleSource}`);
      await page.reload();
      await page.getByRole('button', { name: '账号设置' }).click();
      await page.getByRole('button', { name: '返回工作台' }).click();
      await expect(page).toHaveURL(`${origin}${roleSource}`);
      await page.goto(`${origin}/platform/settings`);
      await expect(page).toHaveURL(`${origin}${expectedPath}`);
      expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(role === 'distributor' ? 200 : 403);
      if (role === 'sales') {
        await expect(page.getByRole('link', { name: '成员管理' })).toBeVisible();
        expect(await page.evaluate(async () => (await fetch('/api/members')).status)).toBe(403);
      }
      await page.getByRole('button', { name: '退出登录' }).click();
    }
    await login('super_admin', 'Issue35NewPassword!');
    await page.getByRole('button', { name: '账号设置' }).click();
    await page.getByLabel('当前密码', { exact: true }).fill('Issue35NewPassword!');
    for (const invalid of ['short', 'a'.repeat(129), 'contains space!', 'not-ascii-密码']) {
      await page.getByLabel('新密码', { exact: true }).fill(invalid);
      await page.getByLabel('确认新密码', { exact: true }).fill(invalid);
      await page.getByRole('button', { name: '确认修改并重新登录' }).click();
      await expect(page.locator('.error-message')).toBeVisible();
    }
    await page.getByLabel('新密码', { exact: true }).fill('Issue35NewPassword!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue35NewPassword!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.locator('.error-message')).toBeVisible();
    await page.getByLabel('新密码', { exact: true }).fill('Issue35LostResponse!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue35LostResponse!');
    let completed!: () => void;
    let release!: () => void;
    const committed = new Promise<void>(resolve => { completed = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let postCount = 0;
    await page.route('**/api/auth/password', async route => {
      postCount += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      completed();
      await gate;
      await route.abort();
    });
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await committed;
    await page.getByRole('link', { name: '平台设置' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByRole('button', { name: '正在更新' })).toBeDisabled();
    release();
    await expect(page.getByText('改密结果尚未确认，请重新登录核实，勿重复提交。').first()).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '平台设置' }).click();
    await page.getByRole('button', { name: '账号设置' }).click();
    await expect(page.getByRole('button', { name: '确认修改并重新登录' })).toBeDisabled();
    expect(postCount).toBe(1);
    await page.unroute('**/api/auth/password');
    await page.reload();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await page.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await page.getByLabel('密码', { exact: true }).fill('Issue35NewPassword!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.error-message')).toBeVisible();
    await login('super_admin', 'Issue35LostResponse!');
  } finally {
    await app.close();
    await pool.end();
  }
});

test('会话读取失败可重试，业务 401 清除旧视图', async ({ page }) => {
  const server = express();
  server.use(express.static(resolve('dist/web')));
  server.get(['/help', '/platform/reconciliation/upstream'], (_request, response) => {
    response.sendFile(resolve('dist/web/index.html'));
  });
  const listener = server.listen(3311, '127.0.0.1');
  let sessionCalls = 0;
  await page.route('**/api/auth/session', async route => {
    sessionCalls += 1;
    if (sessionCalls === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'platform-account', email: null, loginName: 'super_admin', role: 'platform', mustChange: false })
    });
  });
  await page.route('**/api/upstream-monitor', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: '请重新登录' })
  }));
  try {
    await page.goto('http://127.0.0.1:3311/help');
    await expect(page.getByText('会话读取失败：')).toBeVisible();
    await expect(page.getByLabel('登录账号', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByRole('heading', { name: '帮助中心' })).toBeVisible();
    expect(sessionCalls).toBe(2);
    await page.goto('http://127.0.0.1:3311/platform/reconciliation/upstream');
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '上游与对账' })).toHaveCount(0);
  } finally {
    listener.close();
  }
});

test('退出并切换账号后忽略旧会话的业务响应', async ({ page }) => {
  const server = express();
  server.use(express.static(resolve('dist/web')));
  server.get(['/platform/reconciliation/upstream', '/terminal/search'], (_request, response) => {
    response.sendFile(resolve('dist/web/index.html'));
  });
  const listener = server.listen(3312, '127.0.0.1');
  let role = 'platform';
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: `${role}-account`, email: null, loginName: role, role, mustChange: false })
  }));
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/login', route => {
    role = 'admin';
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  let started!: () => void;
  let release!: () => void;
  const upstreamStarted = new Promise<void>(resolve => { started = resolve; });
  const upstreamGate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/upstream-monitor', async route => {
    started();
    await upstreamGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, snapshot: { balance: '999.99', expiresIn: '2030-01-01', fetchedAt: '2026-10-28', traceId: null }, usage: null, usageUnavailable: false, limits: null, events: [] })
    });
  });
  try {
    await page.goto('http://127.0.0.1:3312/platform/reconciliation/upstream');
    await upstreamStarted;
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await page.getByLabel('登录账号', { exact: true }).fill('admin@example.com');
    await page.getByLabel('密码', { exact: true }).fill('SomePassword123!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3312/terminal/search');
    release();
    await expect(page.getByText('上游剩余点数：999.99')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '上游与对账' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '找企业' })).toBeVisible();
  } finally {
    release();
    listener.close();
  }
});




