import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { testDatabase } from './helpers.js';
import { migrate } from '../server/database.js';
import { createServer, type ViteDevServer } from 'vite';
import type { CompanyListRequestDto } from '../server/upstream/tengdao.js';

test('四角色帮助与身份限制', async ({ page, request }) => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const backendPort = Number(process.env.ISSUE36_HTTP_PORT ?? 3399);
  const vitePort = Number(process.env.ISSUE36_VITE_PORT ?? 3499);
  const development = process.env.ISSUE36_MODE === 'development';
  const origin = `http://127.0.0.1:${development ? vitePort : backendPort}`;
  const calls: CompanyListRequestDto[] = [];
  let detailCalls = 0;
  const adapter = {
    listCompanies: async (input: CompanyListRequestDto) => {
      calls.push(input);
      return {
        content: [{ id: 'upstream-company-36', name: input.name, country: 'TUR' }],
        page: input.pageNo,
        size: input.pageSize,
        total: 1
      };
    }
  };
  const app = await createApplication(pool, origin, false, undefined, adapter, undefined,
    { detail: async () => {
      detailCalls++;
      throw new Error('本专项不授权收费查询');
    } }, undefined, undefined, undefined, undefined, undefined,
    resolve(process.env.ISSUE36_WEB_ROOT ?? 'issue36-test-web'));
  let vite: ViteDevServer | undefined;
  await app.listen(backendPort, '127.0.0.1');
  const password = 'Issue36SharedPwd!';
  const login = async (name: string, secret: string) => {
    await page.getByLabel('登录账号', { exact: true }).fill(name);
    await page.getByLabel('密码', { exact: true }).fill(secret);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  };
  const logout = async () => {
    await page.getByRole('button', { name: /的账号菜单$/ }).click();
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
  };
  try {
    if (development) {
      vite = await createServer({
        configFile: resolve('vite.config.ts'),
        server: {
          host: '127.0.0.1',
          port: vitePort,
          strictPort: true,
          proxy: { '/api': `http://127.0.0.1:${backendPort}` }
        }
      });
      await vite.listen();
    }
    const post = async (path: string, body: object = {}) => page.evaluate(async ({ path, body }) => {
      const csrf = document.cookie.split('; ').find(item => item.startsWith('identity_csrf='))?.slice(14) ?? '';
      return (await fetch(`/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body)
      })).status;
    }, { path, body });
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
    const platformActor = (await pool.query("SELECT id FROM accounts WHERE role='platform'")).rows[0].id;
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
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/company',0.5000,2,'issue36 controlled fixture','controlled_test',$1,$2)`, [randomUUID(), platformActor]);
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,10.0000)', [terminalId]);
    const cases = [
      ['super_admin', '平台运营操作指南', '采购与平台承担费用', '多层查看范围', '进入下级管理', '/platform/organizations'],
      ['distributor36@example.com', '分销管理员操作指南', '多层查看范围', '采购与平台承担费用', '进入下级管理', '/distribution/organizations'],
      ['admin36@example.com', '终端企业管理员操作指南', '团队与成员', '多层查看范围', '进入找企业', '/terminal/search'],
      ['sales36@example.com', '业务员操作指南', '团队权限', '团队与成员', '进入找企业', '/terminal/search']
    ];
    const destinations: Record<string, string> = {
      '进入下级管理': '/organizations',
      '进入点数与账务': '/platform/ledger',
      '进入采购与费用': '/platform/ledger/procurement',
      '进入计价配置': '/platform/settings',
      '进入上游与对账': '/platform/reconciliation',
      '进入点数订单': '/distribution/orders',
      '进入交易与利润': '/distribution/profit',
      '进入找企业': '/terminal/search',
      '进入邮件发送记录': '/terminal/emails',
      '进入成员管理': '/terminal/members',
      '进入账号设置': '/account/settings'
    };
    for (const [name, heading, own, other, link, target] of cases) {
      if (name !== 'super_admin') {
        await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '72 hours' WHERE email=$1", [name]);
        await login(name, password);
        await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
        await page.goto(`${origin}/help?role=platform`);
        await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
        await expect(page.locator('.role-help')).toHaveCount(0);
        expect(await page.evaluate(async () => (await fetch('/api/organizations')).status)).toBe(403);
        await logout();
        await pool.query('UPDATE accounts SET must_change=false,temporary_expires_at=NULL WHERE email=$1', [name]);
      }
      await login(name, password);
      const helpLink = page.getByRole('link', { name: '帮助中心' });
      await expect(page.locator('.top-bar').getByRole('link', { name: '帮助中心' })).toBeVisible();
      await expect(page.locator('.workspace-sidebar').getByRole('link', { name: '帮助中心' })).toHaveCount(0);
      await helpLink.click();
      await expect(page).toHaveURL(`${origin}/help`);
      await expect(helpLink).toHaveAttribute('aria-current', 'page');
      await expect(page.getByText(heading)).toBeVisible();
      await expect(page.getByRole('heading', { name: own })).toBeVisible();
      await expect(page.getByRole('heading', { name: other })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(heading)).toBeVisible();
      await page.getByRole('button', { name: link }).click();
      await expect(page).toHaveURL(`${origin}${target}`);
      await page.goBack();
      await expect(page.getByText(heading)).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(`${origin}${target}`);
      await page.goBack();
      await page.goto(`${origin}/help`);
      await expect(page.getByText(heading)).toBeVisible();
      await page.goto(`${origin}/help?role=${name === 'super_admin' ? 'sales' : 'platform'}`);
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
        if (destination === '/platform/ledger/procurement') {
          await expect(page.getByText('关联费用须与采购用途一致', { exact: false })).toBeVisible();
          await expect(page.getByRole('button', { name: '确认采购入账', exact: true })).toBeVisible();
        }
        if (destination === '/terminal/search') {
          await expect(page.getByText('免费查询不扣查询点数', { exact: false })).toBeVisible();
        }
        if (destination === '/terminal/emails') {
          await expect(page.getByText('仅显示本企业系统发送记录；受理不等于送达。')).toBeVisible();
        }
        await page.reload();
        await expect(page).toHaveURL(`${origin}${destination}`);
        await expect(page.getByRole('link', { name: '帮助中心', exact: true })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.goBack();
        await expect(page, `从 ${destination} 返回帮助`).toHaveURL(`${origin}/help`);
        await expect(page.getByText(heading)).toBeVisible();
      }
      expect(await page.evaluate(async () => (await fetch('/api/auth/session')).status)).toBe(200);
      if (name === 'super_admin') {
        expect(await page.evaluate(async () => (await fetch('/api/procurement')).status)).toBe(200);
        expect(await post('company-searches', { name: 'Forbidden', countryCodes: 'TUR' })).toBe(403);
      } else {
        expect(await page.evaluate(async () => (await fetch('/api/procurement')).status)).toBe(403);
        expect(await post('procurement/purchases')).toBe(403);
      }
      if (name.startsWith('admin') || name.startsWith('sales')) {
        expect(await post('company-searches', { name: ' Invalid', countryCodes: 'TUR' })).toBe(400);
        await page.getByRole('button', { name: '进入找企业', exact: true }).click();
        await page.getByLabel('公司名称', { exact: true }).fill(' Help Invalid');
        await page.getByLabel('企业所在国家/地区（三位代码）', { exact: true }).fill('TUR');
        await page.getByRole('button', { name: '免费查询', exact: true }).click();
        await expect(page.getByText('公司名称必填，且不得包含首尾空格', { exact: true })).toBeVisible();
        await page.getByLabel('公司名称', { exact: true }).fill(`Help ${name}`);
        await page.getByRole('button', { name: '免费查询', exact: true }).click();
        await expect(page.getByText('待核实候选不能继续查询联系人或发信；详情需单独确认费用。')).toBeVisible();
        await page.getByRole('button', { name: '确认是该企业', exact: true }).click();
        const quoteRequest = page.waitForRequest(item => item.url().endsWith('/api/company-details/quote'));
        await page.getByRole('button', { name: '查看详情报价', exact: true }).click();
        const quotePayload = (await quoteRequest).postDataJSON();
        await expect(page.getByText('锁定系数 1.0000 · 最高扣点 1.0000')).toBeVisible();
        await expect(page.getByRole('button', { name: '确认费用并查询详情', exact: true })).toBeVisible();
        const latest = (await pool.query('SELECT id,source_id FROM company_candidates WHERE source_name=$1', [`Help ${name}`])).rows[0];
        expect(latest.id).not.toBe(latest.source_id);
        expect(latest.source_id).toBe('upstream-company-36');
        expect(quotePayload).toEqual({ candidateId: latest.id });
        const quoted = (await pool.query('SELECT candidate_id FROM company_detail_queries ORDER BY created_at DESC LIMIT 1')).rows[0];
        expect(quoted.candidate_id).toBe(latest.id);
        if (name.startsWith('sales')) expect(await post('members', {
          name: 'Forbidden member',
          email: 'forbidden36@example.com',
          role: 'sales',
          requestId: randomUUID()
        })).toBe(403);
        await page.getByRole('link', { name: '帮助中心', exact: true }).click();
        await expect(page.getByText(heading)).toBeVisible();
      }
      const businessWrites: string[] = [];
      const observe = (req: import('@playwright/test').Request) => {
        if (req.method() === 'POST' && !req.url().includes('/api/auth/')) businessWrites.push(req.url());
      };
      page.on('request', observe);
      const beforeCalls = calls.length;
      await page.reload();
      await expect(page.getByText(heading)).toBeVisible();
      await page.waitForLoadState('networkidle');
      page.off('request', observe);
      expect(businessWrites).toEqual([]);
      expect(calls.length).toBe(beforeCalls);
      await logout();
    }
    expect(calls).toEqual(['admin', 'sales'].map(role => ({
      name: `Help ${role}36@example.com`,
      countryCodes: 'TUR',
      pageNo: 1,
      pageSize: 20
    })));
    expect(detailCalls).toBe(0);
    expect((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [terminalId])).rows[0])
      .toEqual({ balance: '10.0000', query_frozen: '0.0000' });
    expect((await pool.query('SELECT count(*)::int AS n FROM query_point_ledger')).rows[0].n).toBe(0);
  } finally {
    await vite?.close();
    await app.close();
    await pool.end();
  }
});
