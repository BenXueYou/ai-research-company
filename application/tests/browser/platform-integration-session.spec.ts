import { test, expect } from '@playwright/test';
import express from 'express';
import { resolve } from 'node:path';
test('会话读取失败可重试，业务 401 清除旧视图', async ({ page }) => {
  const server = express();
  server.use(express.static(resolve('.scratch/platform-integration-web')));
  server.get(['/help', '/platform/reconciliation/upstream'], (_request, response) => {
    response.sendFile(resolve('.scratch/platform-integration-web/index.html'), { dotfiles: 'allow' });
  });
  const listener = server.listen(3385, '127.0.0.1');
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
    await page.goto('http://127.0.0.1:3385/help');
    await expect(page.getByText('会话读取失败：')).toBeVisible();
    await expect(page.getByLabel('登录账号', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByLabel('面包屑').getByText('帮助中心')).toBeVisible();
    expect(sessionCalls).toBe(2);
    await page.goto('http://127.0.0.1:3385/platform/reconciliation/upstream');
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '上游与对账' })).toHaveCount(0);
  } finally {
    listener.close();
  }
});

test('退出并切换账号后忽略旧会话的业务响应', async ({ page }) => {
  const server = express();
  server.use(express.static(resolve('.scratch/platform-integration-web')));
  server.get(['/platform/reconciliation/upstream', '/terminal/search'], (_request, response) => {
    response.sendFile(resolve('.scratch/platform-integration-web/index.html'), { dotfiles: 'allow' });
  });
  const listener = server.listen(3386, '127.0.0.1');
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
    await page.goto('http://127.0.0.1:3386/platform/reconciliation/upstream');
    await upstreamStarted;
    await accountAction(page, '退出登录');
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await page.getByLabel('登录账号', { exact: true }).fill('admin@example.com');
    await page.getByLabel('密码', { exact: true }).fill('SomePassword123!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3386/terminal/search');
    release();
    await expect(page.getByText('上游剩余点数：999.99')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '上游与对账' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '找企业' })).toBeVisible();
  } finally {
    release();
    listener.close();
  }
});
async function accountAction(page: import('@playwright/test').Page, name: string) {
  const trigger = page.getByRole('button', { name: /的账号菜单/ });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
