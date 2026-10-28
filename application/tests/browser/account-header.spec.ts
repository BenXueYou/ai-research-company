import { test, expect } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import { resolve } from 'node:path';

let server: Server;
let origin: string;

test.beforeAll(async () => {
  const app = express();
  app.use(express.static(resolve('dist/web')));
  app.get(/.*/, (_request, response) => response.sendFile(resolve('dist/web/index.html')));
  server = await new Promise<Server>(done => {
    const listener = app.listen(0, '127.0.0.1', () => done(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
});

const roles = [
  { role: 'platform', label: '平台管理员' },
  { role: 'distributor', label: '分销商' },
  { role: 'admin', label: '终端企业管理员' },
  { role: 'sales', label: '业务员' }
];

for (const { role, label } of roles) {
  test(`账号菜单：${role} 的身份、设置和返回路径`, async ({ page }) => {
    const loginName = `${role}-login@example.com`;
    await page.route('**/api/auth/session', route => route.fulfill({
      json: { id: `${role}-account-id`, email: `${role}-other@example.com`, loginName, role, mustChange: false }
    }));
    await page.goto(`${origin}/help`);
    const trigger = page.getByRole('button', { name: `${loginName} 的账号菜单` });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('menuitem', { name: '退出登录' })).not.toBeVisible();
    await trigger.click();
    await expect(page.locator('.account-identity strong')).toHaveText(loginName);
    await expect(page.locator('.account-role')).toHaveText(label);
    await page.getByRole('menuitem', { name: '账号设置' }).click();
    await expect(page).toHaveURL(`${origin}/account/settings`);
    await expect(page.getByLabel('当前密码', { exact: true })).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '返回工作台' }).click();
    const defaultPath = role === 'platform' ? '/platform/overview' :
      role === 'distributor' ? '/distribution/organizations' : '/terminal/search';
    await expect(page).toHaveURL(`${origin}${defaultPath}`);
  });
}

test('账号菜单：键盘、点击外部、窄屏与长账号名', async ({ page }) => {
  const loginName = `${'long-account-'.repeat(7)}@example.com`;
  await page.route('**/api/auth/session', route => route.fulfill({
    json: { id: 'keyboard-account', email: 'other@example.com', loginName, role: 'platform', mustChange: false }
  }));
  await page.goto(`${origin}/help`);
  const trigger = page.getByRole('button', { name: `${loginName} 的账号菜单` });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '账号设置' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '账号设置' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByText('平台运营操作指南', { exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const box = await page.locator('.account-popover:visible').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await trigger.click();
  }
});

test('账号菜单：强制改密隐藏设置入口，保留退出', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({
    json: { id: 'temporary-account', email: 'temporary@example.com', loginName: 'temporary-login', role: 'sales', mustChange: true }
  }));
  await page.route('**/api/auth/logout', route => route.fulfill({ json: {} }));
  await page.goto(`${origin}/help`);
  await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
  await page.getByRole('button', { name: 'temporary-login 的账号菜单' }).click();
  await expect(page.getByRole('menuitem', { name: '账号设置' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
});

test('账号菜单：未保存拦截、退出失败、忙碌禁用与请求契约', async ({ page, context }) => {
  await context.addCookies([{ name: 'identity_csrf', value: 'header-test-csrf', url: origin }]);
  await page.route('**/api/auth/session', route => route.fulfill({
    json: { id: 'different-account-id', email: 'different-email@example.com', loginName: 'super_admin', role: 'platform', mustChange: false }
  }));
  const requests: Array<{ body: unknown; csrf: string | undefined }> = [];
  let release!: () => void;
  const pending = new Promise<void>(done => { release = done; });
  await page.route('**/api/auth/logout', async route => {
    requests.push({ body: route.request().postDataJSON(), csrf: route.request().headers()['x-csrf-token'] });
    if (requests.length === 1) {
      await route.fulfill({ status: 503, json: { message: '退出失败，请重试' } });
      return;
    }
    await pending;
    await route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/account/settings`);
  await page.getByLabel('当前密码', { exact: true }).fill('UnsavedPassword123!');
  const trigger = page.getByRole('button', { name: 'super_admin 的账号菜单' });
  await trigger.click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('UnsavedPassword123!');
  expect(requests).toHaveLength(0);
  await trigger.click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByText('退出失败，请重试', { exact: true })).toBeVisible();
  await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('UnsavedPassword123!');
  await trigger.click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toHaveAttribute('aria-disabled', 'true');
  expect(requests).toHaveLength(2);
  release();
  await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
  expect(requests).toEqual([
    { body: {}, csrf: 'header-test-csrf' },
    { body: {}, csrf: 'header-test-csrf' }
  ]);
});
