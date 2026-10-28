import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createApplication } from '../../server/app.js';
import { hashPassword } from '../../server/identity/policy.js';
import { testDatabase } from '../helpers.js';
import type { UMailAdapter } from '../../server/email/umail.js';

test('邮件设置子页：真实企业目标、导航保护、丢响应与权限', async ({ page }) => {
  const { pool } = await testDatabase();
  const platform = randomUUID();
  const enterpriseA = randomUUID();
  const enterpriseB = randomUUID();
  const inactive = randomUUID();
  const distributor = randomUUID();
  const password = 'Issue43FixturePwd!';
  const hash = await hashPassword(password);
  const calls: Array<{ organizationId: string; resourceId: string }> = [];
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const adapter: UMailAdapter = {
    async inspectResource(input) {
      calls.push(input);
      return { ...input, resourceStatus: 'available', detail: '资源核验通过', checkedAt: new Date() };
    },
    async inspectChannel() { throw new Error('本场景不维护团队渠道'); }
  };
  await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'平台43','platform')", [platform]);
  for (const [id, name, kind, level, active] of [
    [enterpriseA, '企业甲43', 'terminal', 0, true],
    [enterpriseB, '企业乙43', 'terminal', 0, true],
    [inactive, '停用企业43', 'terminal', 0, false],
    [distributor, '分销43', 'distributor', 1, true]
  ] as const) {
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,active,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,$3,$4,$5,$6,'fixture',$7,'***')`, [id, name, kind, platform, level, active, `phone-${id}`]);
  }
  for (const [role, org] of [['platform', platform], ['distributor', distributor], ['admin', enterpriseA], ['sales', enterpriseA]]) {
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [randomUUID(), org, `${role}43@example.com`, hash, role]);
  }
  await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
    VALUES($1,$2,'temporary43@example.com',$3,'sales',true,clock_timestamp()+interval '72 hours')`, [randomUUID(), enterpriseA, hash]);
  const origin = 'http://127.0.0.1:3343';
  const app = await createApplication(pool, origin, false, undefined, undefined, adapter,
    undefined, undefined, undefined, undefined, undefined, undefined, resolve('.scratch/issue43-web'));
  await app.listen(3343, '127.0.0.1');
  const api = (path: string, body?: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
    const csrf = document.cookie.split('; ').find(item => item.startsWith('identity_csrf='))?.slice(14) ?? '';
    const response = await fetch(`/api/${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body)
    } : undefined);
    return { status: response.status, data: await response.json() };
  }, { path, body });
  const login = async (role: string) => {
    await page.getByLabel('登录账号', { exact: true }).fill(`${role}43@example.com`);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  };
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/(umail\/resources|email-quota\/configure)$/.test(request.url()))
      posts.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  try {
    await page.goto(`${origin}/platform/settings/umail`);
    await login('platform');
    await page.goto(`${origin}/platform/settings/umail`);
    await page.reload();
    await expect(page.getByRole('link', { name: '平台设置', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#umail-organization')).toHaveCount(1);
    await expect(page.locator('#umail-organization option')).toHaveCount(3);
    await page.locator('#umail-organization').selectOption(enterpriseA);
    await page.locator('#umail-resource-id').fill('resource-alpha-43');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '返回平台设置' }).click();
    await expect(page).toHaveURL(`${origin}/platform/settings/umail`);
    await expect(page.locator('#umail-resource-id')).toHaveValue('resource-alpha-43');
    expect(calls).toHaveLength(0);
    expect(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
    await expect(page.locator('#umail-resource-id')).toHaveValue('resource-alpha-43');
    let release!: () => void;
    let committed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const written = new Promise<void>(resolve => { committed = resolve; });
    await page.route('**/api/umail/resources', async route => {
      if (route.request().method() === 'GET') return route.continue();
      const response = await route.fetch();
      committed();
      await gate;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '核验资源并保存' }).click();
    await written;
    await page.getByRole('link', { name: '返回平台设置' }).click();
    await expect(page).toHaveURL(`${origin}/platform/settings/umail`);
    await expect(page.locator('#umail-organization')).toBeDisabled();
    release();
    await expect(page.getByRole('status').filter({ hasText: '资源已保存' })).toBeVisible();
    await page.unroute('**/api/umail/resources');
    expect(calls).toEqual([{ organizationId: enterpriseA, resourceId: 'resource-alpha-43' }]);
    expect(posts[0].body).toEqual({ organizationId: enterpriseA, resourceId: 'resource-alpha-43', requestId: expect.any(String) });
    expect((await api('umail/resources', posts[0].body)).status).toBe(201);
    expect(calls).toHaveLength(1);
    await page.locator('#umail-resource-id').fill('discard-this-draft');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '返回平台设置' }).click();
    await page.getByRole('link', { name: 'U-Mail 企业资源', exact: true }).click();
    await expect(page.locator('#umail-resource-id')).toHaveValue('');
    await expect(page.locator('#umail-organization')).toHaveValue('');
    await expect(page.locator('#umail-organization option').filter({ hasText: '企业甲43' })).toContainText('受控验证可用');
    await page.getByRole('link', { name: '返回平台设置' }).click();
    await page.getByRole('link', { name: '企业邮件日额度', exact: true }).click();
    await page.reload();
    await expect(page.locator('input[type=number]')).toHaveValue('2000');
    await page.locator('.el-select').click();
    await page.getByRole('option', { name: '企业乙43' }).click();
    await page.locator('input[type=number]').fill('2345');
    page.once('dialog', dialog => dialog.dismiss());
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/platform/settings/email-quota`);
    await expect(page.locator('input[type=number]')).toHaveValue('2345');
    await page.getByRole('button', { name: '保存日额度' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2345' })).toBeVisible();
    expect(posts.find(item => item.path.endsWith('email-quota/configure'))?.body).toEqual({ organizationId: enterpriseB, dailyLimit: 2345 });
    expect((await pool.query('SELECT daily_limit FROM organization_email_limits WHERE organization_id=$1', [enterpriseB])).rows[0].daily_limit).toBe(2345);
    expect((await api('email-quota/configure', { organizationId: distributor, dailyLimit: 3333 })).status).toBe(404);
    expect((await api('email-quota/configure', { organizationId: enterpriseA, dailyLimit: 0 })).status).toBe(400);
    expect((await api('umail/resources', { organizationId: inactive, resourceId: 'invalid', requestId: randomUUID() })).status).toBe(400);
    expect((await api('umail/resources', { organizationId: enterpriseB, resourceId: 'resource-alpha-43', requestId: randomUUID() })).status).toBe(409);
    // A response lost after committing must not cause automatic reconfiguration on return.
    await page.route('**/api/email-quota/configure', async route => {
      await route.fetch();
      await route.abort();
    });
    await page.locator('input[type=number]').fill('3456');
    await page.getByRole('button', { name: '保存日额度' }).click();
    await expect(page.getByText('额度配置结果尚未确认，请联系平台核实；勿重复提交。')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '返回平台设置' }).click();
    await page.getByRole('link', { name: '企业邮件日额度', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存日额度' })).toBeDisabled();
    expect((await pool.query('SELECT count(*)::int AS n FROM email_limit_audit WHERE organization_id=$1', [enterpriseB])).rows[0].n).toBe(2);
    await page.unroute('**/api/email-quota/configure');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '平台设置', exact: true }).click();
    await page.getByRole('link', { name: 'U-Mail 企业资源', exact: true }).click();
    await page.locator('#umail-organization').selectOption(enterpriseB);
    await page.locator('#umail-resource-id').fill('resource-beta-43');
    await page.route('**/api/umail/resources', async route => {
      if (route.request().method() === 'GET') return route.continue();
      await route.fetch();
      await route.abort();
    });
    await page.getByRole('button', { name: '核验资源并保存' }).click();
    await expect(page.getByText('资源配置结果尚未确认，请联系平台核实；勿重复提交。')).toBeVisible();
    const count = calls.length;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '返回平台设置' }).click();
    await page.getByRole('link', { name: 'U-Mail 企业资源', exact: true }).click();
    await expect(page.getByRole('button', { name: '核验资源并保存' })).toBeDisabled();
    expect(calls).toHaveLength(count);
    expect((await pool.query('SELECT external_resource_id FROM umail_resources WHERE organization_id=$1', [enterpriseB])).rows[0].external_resource_id).toBe('resource-beta-43');
    await page.unroute('**/api/umail/resources');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '退出登录' }).click();
    for (const role of ['distributor', 'admin', 'sales']) {
      await login(role);
      await page.goto(`${origin}/platform/settings/umail`);
      await expect(page).not.toHaveURL(`${origin}/platform/settings/umail`);
      await page.goto(`${origin}/platform/settings/email-quota`);
      await expect(page).not.toHaveURL(`${origin}/platform/settings/email-quota`);
      expect((await api('umail/resources')).status).toBe(403);
      expect((await api('umail/resources', { organizationId: enterpriseB, resourceId: 'forbidden', requestId: randomUUID() })).status).toBe(403);
      expect((await api('email-quota/configure', { organizationId: enterpriseB, dailyLimit: 9999 })).status).toBe(403);
      if (role !== 'distributor') expect((await api('email-quota')).data.dailyLimit).toBe(2000);
      await page.getByRole('button', { name: '退出登录' }).click();
    }
    expect(calls).toHaveLength(count);
    expect((await pool.query('SELECT count(*)::int AS n FROM email_daily_usage')).rows[0].n).toBe(0);
    await login('temporary');
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect((await api('umail/resources')).status).toBe(403);
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill('Issue43ChangedPwd!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue43ChangedPwd!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    writeFileSync('.scratch/issue43-evidence.json', JSON.stringify({
      organizations: { platform, enterpriseA, enterpriseB, inactive, distributor },
      posts,
      adapterCalls: calls,
      resources: (await pool.query('SELECT organization_id,external_resource_id,resource_status FROM umail_resources ORDER BY external_resource_id')).rows,
      limits: (await pool.query('SELECT organization_id,daily_limit FROM organization_email_limits')).rows,
      limitAudits: (await pool.query('SELECT organization_id,daily_limit FROM email_limit_audit ORDER BY daily_limit')).rows,
      dailyUsageCount: (await pool.query('SELECT count(*)::int AS n FROM email_daily_usage')).rows[0].n,
      verified: ['platform', 'distributor', 'admin', 'sales', 'forced-password-change', 'dirty-cancel', 'dirty-discard', 'beforeunload', 'submitting-block', 'lost-response-retained']
    }, null, 2));
  } finally {
    await app.close();
    await pool.end();
  }
});
