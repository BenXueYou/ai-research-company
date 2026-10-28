import { test, expect } from '@playwright/test';
import { createApplication } from '../../server/app.js';
import { migrate } from '../../server/database.js';
import { testDatabase } from '../helpers.js';

test('T02 浏览器真实开户、复制失败重试、来源值、短链层级与首次改密', async ({ page, context }) => {
  test.setTimeout(90000);
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3092';
  const app = await createApplication(pool, origin);
  await app.listen(3092, '127.0.0.1');
  const next = 'BrowserOrg123!456';
  const submissions: Record<string, string>[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.url().endsWith('/api/organizations') && request.method() === 'POST') submissions.push(request.postDataJSON());
  });
  async function login(email: string, password: string) {
    await page.getByLabel('登录账号', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  }
  async function activate(email: string, password: string) {
    await login(email, password);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(403);
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill(next);
    await page.getByLabel('确认新密码', { exact: true }).fill(next);
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.getByRole('heading', { name: '登录工作空间' })).toBeVisible();
    await login(email, password);
    await expect(page.getByRole('alert')).toContainText('邮箱或密码错误');
    await login(email, next);
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  }
  async function logout() {
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录工作空间' })).toBeVisible();
  }
  let serial = 0;
  async function fill(kind = 'terminal') {
    const input = { name: `浏览器组织-${++serial}`, kind, countryCode: '+86', phone: `1398000${String(serial).padStart(4, '0')}`, email: `Browser.${serial}+admin@EXAMPLE.COM` };
    await page.getByLabel('组织名称', { exact: true }).fill(input.name);
    await page.getByLabel('组织类型', { exact: true }).selectOption(input.kind);
    await expect(page.getByLabel('国家区号', { exact: true })).toHaveValue('+86');
    await page.getByLabel('电话号码', { exact: true }).fill(input.phone);
    await page.getByLabel('管理员邮箱（登录账号）', { exact: true }).fill(input.email);
    return input;
  }
  async function credentials() {
    await expect(page.getByRole('heading', { name: '开户成功' })).toBeVisible();
    return {
      email: (await page.getByTestId('handoff-email').textContent())!,
      password: (await page.getByTestId('handoff-password').textContent())!
    };
  }
  async function create(kind = 'terminal') {
    await fill(kind);
    await page.getByRole('button', { name: '确认开户', exact: true }).click();
    return credentials();
  }
  try {
    await page.goto('/');
    await activate('super_admin', 'init@Base123');
    await expect(page.getByRole('heading', { name: '下级管理', exact: true })).toBeVisible();
    const input = await fill('distributor');
    // Native required validation prevents missing values; custom whitespace validation sends nothing.
    for (const label of ['组织名称', '国家区号', '电话号码', '管理员邮箱（登录账号）']) {
      const locator = page.getByLabel(label, { exact: true });
      const value = await locator.inputValue(); await locator.fill('');
      await page.getByRole('button', { name: '确认开户', exact: true }).click();
      expect(submissions.length).toBe(0); await locator.fill(value);
    }
    await page.getByLabel('电话号码', { exact: true }).fill('139 80000001');
    await page.getByRole('button', { name: '确认开户', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('电话号码不能包含空格');
    expect(submissions.length).toBe(0);
    await page.getByLabel('电话号码', { exact: true }).fill(input.phone);
    // Dispatch two submits in one browser turn; the synchronous busy guard suppresses the second.
    await page.locator('.opening-form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const first = await credentials();
    expect(submissions.length).toBe(1);
    const submitted = submissions[0];
    expect({ name: submitted.name, kind: submitted.kind, countryCode: submitted.countryCode, phone: submitted.phone, email: submitted.email }).toEqual(input);
    expect(Object.keys(submitted).sort()).toEqual(['countryCode', 'email', 'kind', 'name', 'phone', 'requestId']);
    expect(first.email === input.email.replace('EXAMPLE.COM', 'example.com')).toBe(true);
    expect(first.password.length === 24).toBe(true);
    const row = (await pool.query('SELECT id,organization_id,email FROM accounts WHERE email=$1', [first.email])).rows[0];
    expect(row.id !== row.organization_id).toBe(true);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      let attempts = 0;
      navigator.clipboard.writeText = async text => {
        if (++attempts === 1) throw new DOMException('Test permission denial', 'NotAllowedError');
        await original(text);
      };
    });
    await page.getByRole('button', { name: '一键复制账号信息' }).click();
    await expect(page.getByRole('status')).toContainText('复制失败');
    await page.getByRole('button', { name: '一键复制账号信息' }).click();
    await expect(page.getByRole('status')).toContainText('账号信息已复制');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // Windows clipboard uses CRLF. Compare exact fields without changing their values.
    expect(clipboard.replace(/\r\n/g, '\n') === `登录邮箱：${first.email}\n临时密码：${first.password}`).toBe(true);
    expect(submissions.length).toBe(1);
    expect((await pool.query('SELECT 1 FROM organization_openings')).rowCount).toBe(1);
    // Clear the OS clipboard after checking it; never write credentials into screenshots or traces.
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
    await expect(page.getByTestId('handoff-password')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '下级管理', exact: true })).toBeVisible();
    await expect(page.getByTestId('handoff-password')).toHaveCount(0);
    const platformTerminal = await create();
    await logout();
    await activate(first.email, first.password);
    const second = await create('distributor');
    await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
    await create(); // first-level short chain
    await logout();
    await activate(second.email, second.password);
    expect(await page.locator('#organization-kind option').allTextContents()).toEqual(['终端企业']);
    const leaf = await create();
    await logout();
    await activate(leaf.email, leaf.password);
    await expect(page.getByRole('heading', { name: '下级管理', exact: true })).toHaveCount(0);
    expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(403);
    await logout();
    await activate(platformTerminal.email, platformTerminal.password);
    await logout();
    await login('super_admin', next);
    await expect(page.getByRole('heading', { name: '下级管理', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
    expect((await pool.query('SELECT 1 FROM organization_openings')).rowCount).toBe(5);
  } finally {
    await page.evaluate(async () => { await navigator.clipboard.writeText(''); }).catch(() => {});
    await context.clearPermissions();
    await app.close();
    await pool.end();
  }
});
