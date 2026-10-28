import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../../server/app.js';
import { migrate } from '../../server/database.js';
import { hashPassword } from '../../server/identity/policy.js';
import { testDatabase } from '../helpers.js';

test('公共离开机制接入真实账号：四角色、历史导航、改密和丢响应', async ({ page, browser, request }) => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3384';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('.scratch/platform-integration-web'));
  await app.listen(3384, '127.0.0.1');
  const password = 'Issue35InitialPwd!';
  const next = 'Issue35ChangedPwd!';
  const lost = 'Issue35LostResponse!';
  const payloads: Array<Record<string, unknown>> = [];
  page.on('request', item => {
    if (item.method() === 'POST' && item.url().endsWith('/api/auth/password')) payloads.push(item.postDataJSON());
  });
  const login = async (name: string, secret: string) => {
    await page.getByLabel('登录账号', { exact: true }).fill(name);
    await page.getByLabel('密码', { exact: true }).fill(secret);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: /的账号菜单/ })).toBeVisible();
  };
  const fillPassword = async (current: string, value: string) => {
    await page.getByLabel('当前密码', { exact: true }).fill(current);
    await page.getByLabel('新密码', { exact: true }).fill(value);
    await page.getByLabel('确认新密码', { exact: true }).fill(value);
  };
  const submit = () => page.getByRole('button', { name: '确认修改并重新登录' }).click();
  let otherContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const historyPaths = [
      '/platform/ledger', '/platform/ledger/procurement', '/platform/settings',
      '/platform/settings/umail', '/platform/settings/email-quota',
      '/platform/organizations/business-data', '/platform/reconciliation/upstream'
    ];
    for (const path of historyPaths) {
      expect((await request.get(origin + path)).headers()['content-type']).toContain('text/html');
      expect((await request.head(origin + path)).status()).toBe(200);
    }
    for (const path of ['/assets/missing-integration.js', '/unknown-integration', '/api/unknown-integration']) {
      expect((await request.get(origin + path)).status()).toBe(404);
    }
    expect((await request.get(`${origin}/api/workspace`)).status()).toBe(401);
    await page.goto(`${origin}/help`);
    await login('super_admin', 'init@Base123');
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/workspace')).status)).toBe(403);
    await fillPassword('init@Base123', password);
    await submit();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    expect(payloads[0]).toEqual({ currentPassword: 'init@Base123', newPassword: password, confirmPassword: password });
    await login('super_admin', password);
    await expect(page).toHaveURL(`${origin}/platform/overview`);
    await page.goto(`${origin}/platform/organizations?view=new`);
    await page.getByLabel('组织名称', { exact: true }).fill('离开后应清空');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByLabel('面包屑').getByRole('link', { name: '直属下级', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/platform/organizations?view=new`);
    await expect(page.getByLabel('组织名称', { exact: true })).toHaveValue('离开后应清空');
    page.once('dialog', dialog => dialog.accept());
    await page.getByLabel('面包屑').getByRole('link', { name: '直属下级', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/platform/organizations`);
    await page.getByRole('link', { name: '开户', exact: true }).click();
    await expect(page.getByLabel('组织名称', { exact: true })).toHaveValue('');
    await accountAction(page, '账号设置');
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page).toHaveURL(`${origin}/platform/organizations?view=new`);
    await page.getByRole('link', { name: '运营概览', exact: true }).click();
    await accountAction(page, '账号设置');
    await fillPassword(password, next);
    const sent = payloads.length;
    for (const action of [
      () => page.getByRole('link', { name: '帮助中心' }).click(),
      () => page.getByRole('button', { name: '返回工作台' }).click(),
      () => accountAction(page, '退出登录'),
      () => page.goBack()
    ]) {
      page.once('dialog', dialog => dialog.dismiss());
      await action();
      await expect(page).toHaveURL(`${origin}/account/settings`);
      await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue(password);
      await expect(page.getByLabel('新密码', { exact: true })).toHaveValue(next);
      await expect(page.getByLabel('确认新密码', { exact: true })).toHaveValue(next);
      expect(payloads).toHaveLength(sent);
    }
    // Browser cancellation must leave the history index intact.
    page.once('dialog', dialog => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/overview`);
    await page.goForward();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('');
    await fillPassword(password, next);
    const reloadPrompt = page.waitForEvent('dialog', { timeout: 10000 });
    const reloadAttempt = page.evaluate(() => { window.setTimeout(() => window.location.reload(), 0); });
    await (await reloadPrompt).dismiss();
    await reloadAttempt;
    await expect(page.getByLabel('新密码', { exact: true })).toHaveValue(next);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '帮助中心' }).click();
    await page.getByRole('button', { name: '进入账号设置' }).click();
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page).toHaveURL(`${origin}/platform/overview`);

    // Each role returns to its own legal source; refreshing settings has no source.
    const platformId = (await pool.query("SELECT id FROM organizations WHERE kind='platform'")).rows[0].id;
    const distributorId = randomUUID();
    const terminalId = randomUUID();
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'离开测试分销','distributor',$2,1,'encrypted','issue35-dist','***'),
      ($3,'离开测试终端','terminal',$2,0,'encrypted','issue35-terminal','***')`, [distributorId, platformId, terminalId]);
    for (const [role, organizationId] of [['distributor', distributorId], ['admin', terminalId], ['sales', terminalId]]) {
      const accountId = randomUUID();
      expect(accountId).not.toBe(organizationId);
      expect(accountId).not.toBe(platformId);
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,$4,$5,false)`, [accountId, organizationId, `${role}35@example.com`, await hashPassword(password), role]);
    }
    await accountAction(page, '退出登录');
    for (const [role, source, home] of [
      ['distributor', '/distribution/profit', '/distribution/organizations'],
      ['admin', '/terminal/usage', '/terminal/search'],
      ['sales', '/terminal/usage', '/terminal/search']
    ]) {
      await login(`${role}35@example.com`, password);
      await page.goto(`${origin}${source}`);
      await accountAction(page, '账号设置');
      await page.getByRole('button', { name: '返回工作台' }).click();
      await expect(page).toHaveURL(`${origin}${source}`);
      await accountAction(page, '账号设置');
      await page.reload();
      await page.getByRole('button', { name: '返回工作台' }).click();
      await expect(page).toHaveURL(`${origin}${home}`);
      expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(role === 'distributor' ? 200 : 403);
      await accountAction(page, '退出登录');
    }
    await login('super_admin', password);
    otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await other.goto(origin);
    await other.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await other.getByLabel('密码', { exact: true }).fill(password);
    await other.getByRole('button', { name: '登录', exact: true }).click();
    await expect(other.getByRole('button', { name: /的账号菜单/ })).toBeVisible();
    await accountAction(page, '账号设置');
    for (const invalid of ['short', 'a'.repeat(129), 'contains space!', 'not-ascii-密码']) {
      await fillPassword(password, invalid);
      const before = payloads.length;
      await submit();
      await expect(page.locator('.error-message')).toBeVisible();
      expect(payloads).toHaveLength(before);
    }
    await fillPassword(password, password);
    await submit();
    await expect(page.locator('.error-message')).toBeVisible();
    await fillPassword('wrong-password', next);
    await submit();
    await expect(page.locator('.error-message')).toBeVisible();
    await fillPassword(password, next);
    await page.getByLabel('确认新密码', { exact: true }).fill('DifferentPassword!');
    const beforeMismatch = payloads.length;
    await submit();
    await expect(page.locator('.error-message')).toBeVisible();
    expect(payloads).toHaveLength(beforeMismatch);
    await fillPassword(password, next);
    await submit();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    expect(payloads.at(-1)).toEqual({ currentPassword: password, newPassword: next, confirmPassword: next });
    expect(await other.evaluate(async () => (await fetch('/api/auth/session')).status)).toBe(401);
    await page.getByLabel('登录账号', { exact: true }).fill('super_admin');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.error-message')).toBeVisible();
    await login('super_admin', next);
    await accountAction(page, '账号设置');
    await fillPassword(next, lost);
    let committed!: () => void;
    let release!: () => void;
    const completed = new Promise<void>(resolve => { committed = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let posts = 0;
    await page.route('**/api/auth/password', async route => {
      posts += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed();
      await gate;
      await route.abort();
    });
    await submit();
    await completed;
    await page.getByRole('link', { name: '帮助中心' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByRole('button', { name: '正在更新' })).toBeDisabled();
    release();
    await expect(page.getByText('改密结果尚未确认，请重新登录核实，勿重复提交。').first()).toBeVisible();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '帮助中心' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '帮助中心' }).click();
    await expect(page).toHaveURL(`${origin}/help`);
    await accountAction(page, '账号设置');
    await expect(page.getByRole('button', { name: '确认修改并重新登录' })).toBeDisabled();
    expect(posts).toBe(1);
    await page.unroute('**/api/auth/password');
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await login('super_admin', lost);

    // A 401 clears dirty UI without asking permission to retain expired data.
    await accountAction(page, '账号设置');
    await fillPassword(lost, 'AnotherValidPassword!');
    await pool.query('DELETE FROM sessions');
    let dialogs = 0;
    page.on('dialog', async dialog => { dialogs += 1; await dialog.dismiss(); });
    await submit();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    expect(dialogs).toBe(0);
    await login('super_admin', lost);
    await accountAction(page, '账号设置');
    await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '确认修改并重新登录' })).toBeEnabled();
  } finally {
    await otherContext?.close();
    await app.close();
    await pool.end();
  }
});
async function accountAction(page: import('@playwright/test').Page, name: string) {
  const trigger = page.getByRole('button', { name: /的账号菜单/ });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
