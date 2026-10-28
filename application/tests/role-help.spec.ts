import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { testDatabase } from './helpers.js';
import { migrate } from '../server/database.js';

test('四角色帮助与身份限制', async ({ page, request }) => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3399';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('issue36-test-web'));
  await app.listen(3399, '127.0.0.1');
  const password = 'Issue36SharedPwd!';
  const login = async (name: string, secret: string) => {
    await page.getByLabel('登录账号', { exact: true }).fill(name);
    await page.getByLabel('密码', { exact: true }).fill(secret);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  };
  try {
    await page.goto(`${origin}/help`);
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '帮助中心' })).toHaveCount(0);
    expect((await request.get(`${origin}/api/organizations`)).status()).toBe(401);
    await login('super_admin', 'init@Base123');
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    await page.goto(`${origin}/help`);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '帮助中心' })).toHaveCount(0);
    expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(403);
    await page.getByLabel('当前密码', { exact: true }).fill('init@Base123');
    await page.getByLabel('新密码', { exact: true }).fill(password);
    await page.getByLabel('确认新密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    const platformId = (await pool.query("SELECT id FROM organizations WHERE kind='platform'")).rows[0].id;
    const distributorId = randomUUID();
    const terminalId = randomUUID();
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'帮助分销','distributor',$2,1,'encrypted','issue36-dist','***'),
      ($3,'帮助终端','terminal',$2,0,'encrypted','issue36-terminal','***')`, [distributorId, platformId, terminalId]);
    const hash = await hashPassword(password);
    for (const [role, org] of [['distributor', distributorId], ['admin', terminalId], ['sales', terminalId]]) {
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,$4,$5,false)`, [randomUUID(), org, `${role}36@example.com`, hash, role]);
    }
    const cases = [
      ['super_admin', '平台运营操作指南', '采购与平台承担费用', '多层查看范围', '进入下级管理', '/platform/organizations'],
      ['distributor36@example.com', '分销管理员操作指南', '多层查看范围', '采购与平台承担费用', '进入下级管理', '/distribution/organizations'],
      ['admin36@example.com', '终端企业管理员操作指南', '团队与成员', '多层查看范围', '进入找企业', '/terminal/search'],
      ['sales36@example.com', '业务员操作指南', '团队权限', '团队与成员', '进入找企业', '/terminal/search']
    ];
    const destinations: Record<string, string> = {
      '进入下级管理': '/organizations',
      '进入点数与账务': '/platform/ledger',
      '进入采购与配置': '/platform/settings',
      '进入上游与对账': '/platform/reconciliation',
      '进入点数订单': '/distribution/orders',
      '进入交易与利润': '/distribution/profit',
      '进入找企业': '/terminal/search',
      '进入邮件发送记录': '/terminal/emails',
      '进入成员管理': '/terminal/members',
      '进入账号设置': '/account/settings'
    };
    for (const [name, heading, own, other, link, target] of cases) {
      await login(name, password);
      const helpLink = page.getByRole('link', { name: '帮助中心' });
      if (name === 'super_admin') await expect(helpLink).not.toHaveClass(/sidebar-help/);
      else await expect(helpLink).toHaveClass(/sidebar-help/);
      await helpLink.click();
      await expect(page).toHaveURL(`${origin}/help`);
      await expect(page.getByText(heading)).toBeVisible();
      await expect(page.getByRole('heading', { name: own })).toBeVisible();
      await expect(page.getByRole('heading', { name: other })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(heading)).toBeVisible();
      await page.getByRole('button', { name: link }).click();
      await expect(page).toHaveURL(`${origin}${target}`);
      await page.goBack();
      await expect(page.getByText(heading)).toBeVisible();
      await page.goto(`${origin}/help`);
      await expect(page.getByText(heading)).toBeVisible();
      const links = await page.locator('.role-help .help-link').allTextContents();
      for (const label of links) {
        await page.getByRole('button', { name: label, exact: true }).click();
        const destination = label === '进入下级管理'
          ? `${name === 'super_admin' ? '/platform' : '/distribution'}${destinations[label]}`
          : destinations[label];
        expect(destination).toBeTruthy();
        await expect(page).toHaveURL(`${origin}${destination}`);
        await page.goBack();
        await expect(page.getByText(heading)).toBeVisible();
      }
      await page.getByRole('button', { name: '退出登录' }).click();
    }
  } finally {
    await app.close();
    await pool.end();
  }
});



