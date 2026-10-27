import { test, expect } from '@playwright/test';
import { createApplication } from '../../server/app.js';
import { testDatabase } from '../helpers.js';

test('真实UI：临时登录、强改密、重登录、主动改密、退出及窄屏', async ({ page, browser }) => {
  const { pool, service } = await testDatabase();
  const app = await createApplication(pool, 'http://127.0.0.1:3092');
  await app.listen(3092, '127.0.0.1');
  const account = await service.bootstrap('Browser@example.com', '浏览器测试平台');
  const next = ' 浏览器新密码😀安全十二个字符 ';
  const final = ' 第二次密码😀安全十二个字符 ';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function login(password: string) {
    await page.getByLabel('登录邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  }
  async function fillChange(current: string, password: string, confirm = password) {
    await page.getByLabel('当前密码', { exact: true }).fill(current);
    await page.getByLabel('新密码', { exact: true }).fill(password);
    await page.getByLabel('确认新密码', { exact: true }).fill(confirm);
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
  }
  try {
    await page.goto('/');
    await login('wrong');
    await expect(page.getByRole('alert')).toContainText('邮箱或密码错误');
    await login(account.password);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/workspace')).status)).toBe(403);
    await page.reload();
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    await fillChange(account.password, next, 'different');
    await expect(page.getByRole('alert')).toContainText('两次输入一致');
    await fillChange('wrong', next);
    await expect(page.getByRole('alert')).toContainText('当前密码错误');
    await fillChange(account.password, next);
    await expect(page.getByRole('status')).toContainText('所有设备已退出');
    await login(account.password);
    await expect(page.getByRole('alert')).toContainText('邮箱或密码错误');
    await login(next);
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto('http://127.0.0.1:3092/');
    await otherPage.getByLabel('登录邮箱', { exact: true }).fill(account.email);
    await otherPage.getByLabel('密码', { exact: true }).fill(next);
    await otherPage.getByRole('button', { name: '登录', exact: true }).click();
    await expect(otherPage.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '账号设置', exact: true }).click();
    await fillChange(next, final);
    await expect(page.getByRole('status')).toContainText('所有设备已退出');
    expect((await other.request.get('http://127.0.0.1:3092/api/workspace')).status()).toBe(401);
    await other.close();
    await login(final);
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录工作空间' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await pool.end();
  }
});
