import { test, expect } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use(express.static(resolve('.scratch/platform-integration-web')));
  app.get(/.*/, (_req, res) => res.sendFile(resolve('.scratch/platform-integration-web/index.html'), { dotfiles: 'allow' }));
  server = await new Promise<Server>(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
async function session(page: import('@playwright/test').Page, role = 'platform') {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/api/auth/session' ? { id: 'account-distinct', email: 'other@example.com', loginName: 'super_admin', role, mustChange: false } :
      path === '/api/organizations' ? { parentName: '平台', allowedKinds: ['terminal'], children: [{ id: 'organization-distinct', accountId: 'admin-distinct', name: '星河科技', kind: 'terminal', active: true, phoneMasked: '138****1234', email: 'child@example.com' }] } :
      path === '/api/umail/resources' ? { organizations: [{ id: 'wrong-id', organizationId: 'quota-organization', name: '额度企业' }] } : {};
    return route.fulfill({ json });
  });
}
test('双区独立滚动、父级展开、唯一高亮、切换不丢输入、历史恢复', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await session(page);
  await page.goto(`${origin}/platform/organizations?view=new`);
  await page.getByLabel('组织名称', { exact: true }).fill('保留输入');
  const main = page.locator('#console-main');
  await main.evaluate(el => { el.scrollTop = 220; });
  const top = await main.evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: '收起菜单', exact: true }).click();
  await expect(page.locator('#organization-name')).toHaveValue('保留输入');
  expect(await main.evaluate(el => el.scrollTop)).toBe(top);
  await page.getByRole('button', { name: '展开菜单', exact: true }).click();
  const parent = page.getByRole('button', { name: '点数与账务' });
  await parent.click();
  await expect(parent).toHaveAttribute('aria-expanded', 'true');
  await parent.click();
  await expect(parent).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL(`${origin}/platform/organizations?view=new`);
  expect(await main.evaluate(el => el.scrollTop)).toBe(top);
  await expect(page.locator('.sidebar-link.active')).toHaveCount(1);
  await expect(page.locator('.sidebar-link.active')).toHaveText('下级管理');
  const crumbs = page.getByLabel('面包屑');
  await expect(crumbs).toContainText('开户');
  page.once('dialog', d => d.dismiss());
  await crumbs.getByRole('link', { name: '直属下级' }).click();
  await expect(page.locator('#organization-name')).toHaveValue('保留输入');
  expect(await main.evaluate(el => el.scrollTop)).toBe(top);
  page.once('dialog', d => d.accept());
  await crumbs.getByRole('link', { name: '直属下级' }).click();
  await page.getByRole('link', { name: '下级详情', exact: true }).click();
  await expect(crumbs).toContainText('星河科技');
  await expect(page.locator('.sidebar-link.active')).toHaveCount(1);
  await crumbs.getByRole('link', { name: '直属下级' }).click();
  await page.getByRole('link', { name: '开户', exact: true }).click();
  await page.locator('#organization-name').fill('');
  await main.evaluate(el => { el.scrollTop = 250; });
  const saved = await main.evaluate(el => el.scrollTop);
  await page.getByRole('link', { name: '帮助中心', exact: true }).click();
  await main.evaluate(el => { el.scrollTop = 130; });
  await page.goBack();
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(saved);
  await page.goForward();
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(130);
  for (const button of ['点数与账务', '上游与对账', '平台设置']) await page.getByRole('button', { name: button, exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 420 });
  const nav = page.locator('.sidebar-scroll');
  const before = await main.evaluate(el => el.scrollTop);
  await nav.evaluate(el => { el.scrollTop = 150; });
  expect(await nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await main.evaluate(el => el.scrollTop)).toBe(before);
  const navTop = await nav.evaluate(el => el.scrollTop);
  await main.evaluate(el => { el.scrollTop = 40; });
  expect(await nav.evaluate(el => el.scrollTop)).toBe(navTop);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.locator('.top-bar').evaluate(el => el.getBoundingClientRect().top)).toBe(0);
  await page.locator('.sidebar-toggle').focus();
  await page.mouse.move(1400, 20);
  const colors = await page.locator('#console-main, .sidebar-scroll').evaluateAll(els => els.map(el => getComputedStyle(el).scrollbarColor));
  expect(colors[0]).toBe(colors[1]);
  await nav.hover();
  const hoverColor = await nav.evaluate(el => getComputedStyle(el).scrollbarColor);
  await main.hover();
  expect(await main.evaluate(el => getComputedStyle(el).scrollbarColor)).toBe(hoverColor);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '.scratch/platform-integration-desktop.png' });
});
test('配置面包屑离开保护、提交中阻止、结果未知返回不重放', async ({ page }) => {
  await session(page);
  let count = 0; let release!: () => void;
  const pending = new Promise<void>(done => { release = done; });
  await page.route('**/api/email-quota/configure', async route => { count++; await pending; await route.abort(); });
  await page.goto(`${origin}/platform/settings/email-quota`);
  await page.locator('.el-select').click();
  await page.getByRole('option', { name: '额度企业' }).click();
  await page.locator('input[type=number]').fill('2345');
  const parent = page.getByLabel('面包屑').getByRole('link', { name: '平台设置' });
  page.once('dialog', d => d.dismiss()); await parent.click();
  await expect(page.locator('input[type=number]')).toHaveValue('2345');
  await page.getByRole('button', { name: '保存日额度' }).click();
  await parent.click();
  await expect(page).toHaveURL(`${origin}/platform/settings/email-quota`);
  release();
  await expect(page.getByText('额度配置结果尚未确认，请联系平台核实；勿重复提交。')).toBeVisible();
  page.once('dialog', d => d.accept()); await parent.click();
  await page.locator('.sidebar-link').filter({ hasText: '企业邮件日额度' }).click();
  await expect(page.getByRole('button', { name: '保存日额度' })).toBeDisabled();
  expect(count).toBe(1);
});
for (const role of ['platform', 'distributor', 'admin', 'sales']) {
  test(`窄屏键盘与角色权限：${role}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await session(page, role);
    await page.goto(`${origin}/help`);
    await expect(page.getByLabel('面包屑')).toContainText('帮助中心');
    const toggle = page.getByRole('button', { name: '展开菜单', exact: true });
    await toggle.focus(); await page.keyboard.press('Enter');
    const close = page.getByRole('button', { name: '关闭菜单', exact: true }).first();
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.sidebar-link:visible').last()).toBeFocused();
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Escape'); await expect(toggle).toBeFocused();
    const help = page.locator('.top-bar').getByRole('link', { name: '帮助中心', exact: true });
    await expect(help).toBeVisible();
    await expect(page.locator('.workspace-sidebar a[href="/help"]')).toHaveCount(0);
    await help.focus();
    await page.keyboard.press('Enter');
    await expect(help).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.scratch/platform-integration-mobile-${role}.png` });
    if (role !== 'platform') {
      await page.goto(`${origin}/platform/settings/email-quota`);
      await expect(page).not.toHaveURL(`${origin}/platform/settings/email-quota`);
      await expect(page.locator('.sidebar-parent')).toHaveCount(0);
    }
  });
}

test('四角色已授权入口的深链、刷新、面包屑和唯一选中', async ({ page }) => {
  const paths: Record<string, [string, string][]> = {
    platform: [
      ['/platform/overview', '运营概览'], ['/platform/organizations', '直属下级'],
      ['/platform/ledger', '点数订单'], ['/platform/ledger/profit', '交易与利润'],
      ['/platform/ledger/procurement', '采购与费用'],
      ['/platform/ledger/flows', '账务流水'], ['/platform/reconciliation', '查询异常核对'],
      ['/platform/reconciliation/upstream', '上游账号监控'], ['/platform/settings', '计价配置'],
      ['/platform/settings/umail', 'U-Mail 企业资源'], ['/platform/settings/email-quota', '企业邮件日额度'],
      ['/platform/organizations/business-data', '业务数据查看']
    ],
    distributor: [['/distribution/organizations', '下级管理'], ['/distribution/orders', '点数订单'], ['/distribution/profit', '交易与利润']],
    admin: [['/terminal/search', '找企业'], ['/terminal/profiles', '企业档案库'], ['/terminal/emails', '邮件发送记录'], ['/terminal/sending-settings', '团队发信设置'], ['/terminal/members', '成员管理'], ['/terminal/usage', '点数用量']],
    sales: [['/terminal/search', '找企业'], ['/terminal/profiles', '企业档案库'], ['/terminal/emails', '邮件发送记录'], ['/terminal/sending-settings', '团队发信设置'], ['/terminal/members', '成员管理'], ['/terminal/usage', '点数用量']]
  };
  for (const [role, entries] of Object.entries(paths)) {
    await page.unrouteAll(); await session(page, role);
    for (const [path, label] of entries) {
      await page.goto(origin + path);
      await expect(page.getByLabel('面包屑')).toContainText(label);
      await expect(page.locator('.sidebar-link.active')).toHaveCount(1);
      await expect(page.locator('.sidebar-link.active')).toBeVisible();
    }
    await page.reload();
    await expect(page.getByLabel('面包屑')).toContainText(entries[entries.length - 1][1]);
    await page.goto(origin + '/account/settings');
    await expect(page.getByLabel('面包屑')).toContainText('账号设置');
    await expect(page.locator('.sidebar-link.active')).toHaveCount(0);
  }
});

test('长详情面包屑在窄屏完整显示且不撑宽页面', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await session(page);
  const name = '星河国际进出口科技有限公司上海业务中心';
  await page.route('**/api/organizations', route => route.fulfill({ json: { parentName: '平台', allowedKinds: ['terminal'], children: [{ id: 'long-org', accountId: 'different-account', name, kind: 'terminal', active: true }] } }));
  await page.goto(origin + '/platform/organizations?id=long-org');
  await expect(page.getByLabel('面包屑').locator('.console-crumb').last()).toContainText(name);
  await expect(page.getByLabel('面包屑').locator('[aria-current=page]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const last = page.getByLabel('面包屑').locator('.console-crumb').last();
  expect(await last.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.scratch/platform-integration-mobile-detail.png' });
});

