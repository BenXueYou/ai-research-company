import { test, expect } from '@playwright/test';
test('平台直属组织选择、状态和管理员重置使用原有标识', async ({ page }) => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let active = true;
  let openingAttempts = 0;
  await page.route(/^http:\/\/127\.0\.0\.1:5197\/api\//, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.method() === 'POST' ? req.postDataJSON() as Record<string, unknown> : undefined;
    if (body) calls.push({ path, body });
    if (path === '/api/auth/session') return route.fulfill({ json: { id: 'platform', role: 'platform', mustChange: false } });
    if (path === '/api/organizations' && !body) return route.fulfill({ json: { parentName: '平台', allowedKinds: ['terminal', 'distributor'], children: [{ id: 'org-id', accountId: 'account-id', name: '直属企业', kind: 'terminal', active, phoneMasked: '138****0000', email: 'child@example.com' }] } });
    if (path === '/api/organizations/state') {
      active = body?.active === true;
      return route.fulfill({ json: {} });
    }
    if (path === '/api/password-resets') {
      if (calls.filter(item => item.path === path).length > 1) return route.abort();
      return route.fulfill({ json: { email: 'child@example.com', temporaryPassword: 'temporary', expiresAt: '2027-01-01T00:00:00Z' } });
    }
    if (path === '/api/organizations' && body) {
      openingAttempts += 1;
      if (openingAttempts === 1) return route.abort();
      return route.fulfill({ json: { email: 'new@example.com', temporaryPassword: 'temporary', expiresAt: '2027-01-01T00:00:00Z' } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/platform/organizations');
  await page.getByRole('link', { name: '下级详情' }).click();
  await page.reload();
  await page.getByRole('button', { name: '停用组织' }).click();
  await expect.poll(() => calls.find(item => item.path === '/api/organizations/state')?.body).toEqual({ organizationId: 'org-id', active: false });
  await page.getByRole('button', { name: '恢复组织' }).click();
  await expect.poll(() => calls.filter(item => item.path === '/api/organizations/state')[1]?.body).toEqual({ organizationId: 'org-id', active: true });
  await page.getByRole('button', { name: '重置管理员密码' }).click();
  await expect.poll(() => calls.find(item => item.path === '/api/password-resets')?.body.accountId).toBe('account-id');
  await page.getByRole('button', { name: '已保存，关闭凭据' }).click();
  await expect(page.getByTestId('handoff-password')).toHaveCount(0);
  await page.getByRole('button', { name: '重置管理员密码' }).click();
  await expect(page.getByText('重置结果不确定，请先核实账号状态，勿重复重置。')).toBeVisible();
  await expect(page.getByRole('button', { name: '重置管理员密码' })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '已核实，需要重新补发凭据' }).click();
  await page.getByRole('link', { name: '开户', exact: true }).click();
  await expect(page.getByLabel('组织类型')).toHaveValue('terminal');
  await expect(page.getByLabel('国家区号')).toHaveValue('+86');
  await page.getByLabel('组织名称').fill('新企业');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '直属下级', exact: true }).click();
  await expect(page).toHaveURL(/view=new/);
  await page.getByLabel('电话号码').fill('13800000000');
  await page.getByLabel('管理员邮箱（登录账号）').fill('new@example.com');
  await page.getByRole('button', { name: '确认开户' }).click();
  await expect.poll(() => openingAttempts).toBe(1);
  await expect(page.getByText('开户结果尚未确认。请刷新直属列表核实；重试将沿用本次请求标识，不会自动重新开户。')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '直属下级', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5197/platform/organizations');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '开户', exact: true }).click();
  await expect(page.getByLabel('组织名称')).toHaveValue('新企业');
  await page.getByRole('button', { name: '确认开户' }).click();
  await expect(page.getByTestId('handoff-password')).toBeVisible();
  const submissions = calls.filter(item => item.path === '/api/organizations');
  expect(submissions).toHaveLength(2);
  expect(submissions[0].body).toEqual(submissions[1].body);
  expect(submissions[0].body).toMatchObject({ name: '新企业', kind: 'terminal', countryCode: '+86', phone: '13800000000', email: 'new@example.com' });
});


