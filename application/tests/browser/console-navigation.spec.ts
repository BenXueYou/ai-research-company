import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../../server/app.js';
import { migrate } from '../../server/database.js';
import { hashPassword } from '../../server/identity/policy.js';
import { testDatabase } from '../helpers.js';

test('四角色导航、强制改密、隔离和直属组织参数', async ({ page, request }) => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3199';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('issue34-test-web'));
  await app.listen(3199, '127.0.0.1');
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
    await page.getByRole('link', { name: '点数与账务' }).click();
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/organizations`);
    await page.goForward();
    await expect(page.getByRole('link', { name: '点数与账务' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '账号设置' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page).toHaveURL(`${origin}/platform/ledger`);
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
      await page.goto(`${origin}/platform/settings`);
      await expect(page).toHaveURL(`${origin}${expectedPath}`);
      expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(role === 'distributor' ? 200 : 403);
      if (role === 'sales') {
        await expect(page.getByRole('link', { name: '成员管理' })).toBeVisible();
        expect(await page.evaluate(async () => (await fetch('/api/members')).status)).toBe(403);
      }
      await page.getByRole('button', { name: '退出登录' }).click();
    }
  } finally {
    await app.close();
    await pool.end();
  }
});




