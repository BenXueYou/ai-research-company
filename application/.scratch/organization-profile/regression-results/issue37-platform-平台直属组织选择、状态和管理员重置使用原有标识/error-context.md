# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: issue37-platform.spec.ts >> 平台直属组织选择、状态和管理员重置使用原有标识
- Location: tests/issue37-platform.spec.ts:2:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: '下级详情' })

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | test('平台直属组织选择、状态和管理员重置使用原有标识', async ({ page }) => {
  3  |   const calls: { path: string; body: Record<string, unknown> }[] = [];
  4  |   let active = true;
  5  |   let openingAttempts = 0;
  6  |   await page.route(/^http:\/\/127\.0\.0\.1:5197\/api\//, async route => {
  7  |     const req = route.request();
  8  |     const path = new URL(req.url()).pathname;
  9  |     const body = req.method() === 'POST' ? req.postDataJSON() as Record<string, unknown> : undefined;
  10 |     if (body) calls.push({ path, body });
  11 |     if (path === '/api/auth/session') return route.fulfill({ json: { id: 'platform', role: 'platform', mustChange: false } });
  12 |     if (path === '/api/organizations' && !body) return route.fulfill({ json: { parentName: '平台', allowedKinds: ['terminal', 'distributor'], children: [{ id: 'org-id', accountId: 'account-id', name: '直属企业', kind: 'terminal', active, phoneMasked: '138****0000', email: 'child@example.com' }] } });
  13 |     if (path === '/api/organizations/state') {
  14 |       active = body?.active === true;
  15 |       return route.fulfill({ json: {} });
  16 |     }
  17 |     if (path === '/api/password-resets') {
  18 |       if (calls.filter(item => item.path === path).length > 1) return route.abort();
  19 |       return route.fulfill({ json: { email: 'child@example.com', temporaryPassword: 'temporary', expiresAt: '2027-01-01T00:00:00Z' } });
  20 |     }
  21 |     if (path === '/api/organizations' && body) {
  22 |       openingAttempts += 1;
  23 |       if (openingAttempts === 1) return route.abort();
  24 |       return route.fulfill({ json: { email: 'new@example.com', temporaryPassword: 'temporary', expiresAt: '2027-01-01T00:00:00Z' } });
  25 |     }
  26 |     return route.fulfill({ json: {} });
  27 |   });
  28 |   await page.goto('/platform/organizations');
> 29 |   await page.getByRole('link', { name: '下级详情' }).click();
     |                                                  ^ Error: locator.click: Test timeout of 30000ms exceeded.
  30 |   await page.reload();
  31 |   await page.getByRole('button', { name: '停用组织' }).click();
  32 |   await expect.poll(() => calls.find(item => item.path === '/api/organizations/state')?.body).toEqual({ organizationId: 'org-id', active: false });
  33 |   await page.getByRole('button', { name: '恢复组织' }).click();
  34 |   await expect.poll(() => calls.filter(item => item.path === '/api/organizations/state')[1]?.body).toEqual({ organizationId: 'org-id', active: true });
  35 |   await page.getByRole('button', { name: '重置管理员密码' }).click();
  36 |   await expect.poll(() => calls.find(item => item.path === '/api/password-resets')?.body.accountId).toBe('account-id');
  37 |   await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
  38 |   await expect(page.getByTestId('handoff-password')).toHaveCount(0);
  39 |   await page.getByRole('button', { name: '重置管理员密码' }).click();
  40 |   await expect(page.getByText('重置结果不确定，请先核实账号状态，勿重复重置。')).toBeVisible();
  41 |   await expect(page.getByRole('button', { name: '重置管理员密码' })).toBeDisabled();
  42 |   page.once('dialog', dialog => dialog.accept());
  43 |   await page.getByRole('button', { name: '已核实，需要重新补发凭据' }).click();
  44 |   await page.getByRole('link', { name: '开户', exact: true }).click();
  45 |   await expect(page.getByLabel('组织类型')).toHaveValue('terminal');
  46 |   await expect(page.getByLabel('国家区号')).toHaveValue('+86');
  47 |   await page.getByLabel('组织名称').fill('新企业');
  48 |   page.once('dialog', dialog => dialog.dismiss());
  49 |   await page.getByRole('link', { name: '直属下级', exact: true }).click();
  50 |   await expect(page).toHaveURL(/view=new/);
  51 |   await page.getByLabel('电话号码').fill('13800000000');
  52 |   await page.getByLabel('管理员邮箱（登录账号）').fill('new@example.com');
  53 |   await page.getByRole('button', { name: '确认开户' }).click();
  54 |   await expect.poll(() => openingAttempts).toBe(1);
  55 |   await expect(page.getByText('开户结果尚未确认。请刷新直属列表核实；重试将沿用本次请求标识，不会自动重新开户。')).toBeVisible();
  56 |   page.once('dialog', dialog => dialog.accept());
  57 |   await page.getByRole('link', { name: '直属下级', exact: true }).click();
  58 |   await expect(page).toHaveURL('http://127.0.0.1:5197/platform/organizations');
  59 |   page.once('dialog', dialog => dialog.accept());
  60 |   await page.getByRole('link', { name: '开户', exact: true }).click();
  61 |   await expect(page.getByLabel('组织名称')).toHaveValue('新企业');
  62 |   await page.getByRole('button', { name: '确认开户' }).click();
  63 |   await expect(page.getByTestId('handoff-password')).toBeVisible();
  64 |   const submissions = calls.filter(item => item.path === '/api/organizations');
  65 |   expect(submissions).toHaveLength(2);
  66 |   expect(submissions[0].body).toEqual(submissions[1].body);
  67 |   expect(submissions[0].body).toMatchObject({ name: '新企业', kind: 'terminal', countryCode: '+86', phone: '13800000000', email: 'new@example.com' });
  68 | });
  69 | 
  70 | 
  71 | 
```