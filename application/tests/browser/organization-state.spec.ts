import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { createApplication } from '../../server/app.js';
import { migrate } from '../../server/database.js';
import { testDatabase } from '../helpers.js';

test('T26 browser: direct child state controls and restored login', async ({ page }) => {
  test.setTimeout(90000);
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3197';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    resolve('.scratch/t26-web'));
  await app.listen(3197, '127.0.0.1');
  const stateRequests: Array<{ organizationId: string; active: boolean }> = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/organizations/state') && request.method() === 'POST')
      stateRequests.push(request.postDataJSON());
  });
  try {
    await page.goto(origin);
    await page.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await page.getByLabel('密码', { exact: true }).fill('init@Base123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    await page.getByLabel('当前密码', { exact: true }).fill('init@Base123');
    await page.getByLabel('新密码', { exact: true }).fill('T26BrowserPwd123!');
    await page.getByLabel('确认新密码', { exact: true }).fill('T26BrowserPwd123!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await page.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await page.getByLabel('密码', { exact: true }).fill('T26BrowserPwd123!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '下级管理' })).toBeVisible();
    await page.getByLabel('组织名称', { exact: true }).fill('T26浏览器直属企业');
    await page.getByLabel('电话号码', { exact: true }).fill('13926123456');
    await page.getByLabel('管理员邮箱（登录账号）', { exact: true }).fill('t26-browser@example.com');
    await page.getByRole('button', { name: '确认开户' }).click();
    await expect(page.getByRole('heading', { name: '开户成功' })).toBeVisible();
    await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
    const child = page.locator('.child-row').filter({ hasText: 'T26浏览器直属企业' });
    await child.locator('summary').click();
    const id = (await pool.query("SELECT id FROM organizations WHERE name='T26浏览器直属企业'")).rows[0].id;
    await child.getByRole('button', { name: '停用组织' }).click();
    await expect(child.getByRole('button', { name: '恢复组织' })).toBeVisible();
    await child.getByRole('button', { name: '恢复组织' }).click();
    await expect(child.getByRole('button', { name: '停用组织' })).toBeVisible();
    expect(stateRequests).toEqual([{ organizationId: id, active: false }, { organizationId: id, active: true }]);
    expect((await pool.query('SELECT active FROM organizations WHERE id=$1', [id])).rows[0].active).toBe(true);
  } finally {
    await app.close();
    await pool.end();
  }
});
