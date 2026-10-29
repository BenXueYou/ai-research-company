import { selectCountry } from './helpers/countrySelect.js';
import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../vite.config.js';
import { testDatabase } from './helpers.js';
import { migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import type { ImporterNameInput } from '../server/companies/product-search.js';

async function freePort() {
  const server = netServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('Issue54 real product search, separate detail authorization, identity contract and navigation lifecycle', async ({ page, browser }) => {
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = `http://127.0.0.1:${await freePort()}`;
  const password = 'Issue54-test-password!';
  const calls: ImporterNameInput[] = [];
  const companyCalls: unknown[] = [];
  const detailCalls: unknown[] = [];
  let mode = 'success';
  let detailMode = 'success';
  let companyCountry = 'TUR';
  let emptyCompanies = false;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const importer = {
    buyerCountryFilterVerified: true as const,
    importerNames: async (input: ImporterNameInput) => {
      calls.push(input);
      if (gate) await gate;
      if (mode === 'timeout') throw new Error('Controlled timeout');
      return {
        content: mode === 'zero' ? [] : [{ name: `Trade Buyer ${input.pageNo}` }],
        page: input.pageNo, size: input.pageSize, total: mode === 'zero' ? 0 : 41,
        actualUpstreamPoints: '0.4321', traceId: `product-${calls.length}`
      };
    }
  };
  const companies = { listCompanies: async (input: { name: string; countryCodes: string; pageNo: number; pageSize: number }) => {
    companyCalls.push(input);
    return {
      content: emptyCompanies ? [] : [{ id: 'list-source-54', name: 'Verified Legal Buyer 54', country: companyCountry }],
      page: input.pageNo, size: input.pageSize, total: emptyCompanies ? 0 : 1
    };
  } };
  const details = { detail: async (input: { name: string; countryCode3: string }) => {
    detailCalls.push(input);
    if (detailMode === 'timeout') throw new Error('Controlled detail timeout');
    return { data: { id: 'detail-data-id-54', countryCode3: 'TUR' }, actualUpstreamPoints: '0.1234' };
  } };
  const root = resolve('.scratch/issue54');
  const app = await createApplication(pool, origin, false, undefined, companies, undefined, details,
    undefined, undefined, importer, undefined, undefined, resolve(root, 'web'));
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  const requests: Array<{ path: string; body: unknown }> = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() === 'POST' && !request.url().includes('/auth/'))
      requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  try {
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const orgA = randomUUID(); const orgB = randomUUID(); const distributor = randomUUID();
    for (const org of [orgA, orgB, distributor]) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'Issue54',$2,$3,$4,'fixture',$5,'***')`, [org, org === distributor ? 'distributor' : 'terminal', platform.organization_id, org === distributor ? 1 : 0, randomUUID()]);
    const accounts: Record<string, { id: string; email: string }> = {};
    for (const [label, role, org] of [['admin', 'admin', orgA], ['sales', 'sales', orgA], ['foreign', 'admin', orgB], ['distributor', 'distributor', distributor], ['temporary', 'sales', orgA]]) {
      const account = { id: randomUUID(), email: `${label}@issue54.test` };
      accounts[label] = account;
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '72 hours')`, [account.id, org, account.email, hash, role, label === 'temporary']);
    }
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,20),($2,20)', [orgA, orgB]);
    await pool.query('UPDATE platform_pricing SET coefficient=1');
    await app.listen(Number(new URL(origin).port), '127.0.0.1');
    const login = async (label: string) => {
      await page.context().clearCookies();
      await page.goto(`${origin}/terminal/search`);
      await page.getByLabel('登录账号', { exact: true }).fill(accounts[label].email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
      await page.goto(`${origin}/terminal/search`);
    };
    const post = async (path: string, body: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('identity_csrf='))?.slice(14) ?? '';
      const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body });
    await login('admin');
    const product = page.locator('.product-search:visible');
    await expect(product).toHaveCount(1);
    await page.reload();
    await expect(product).toHaveCount(1);
    expect(calls).toHaveLength(0);
    if (process.env.ISSUE54_VISUAL === '1') {
      await page.setViewportSize({ width: 1440, height: 1080 });
      await product.scrollIntoViewIfNeeded();
      await product.screenshot({ path: resolve(root, 'product-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await product.scrollIntoViewIfNeeded();
      await product.screenshot({ path: resolve(root, 'product-mobile.png') });
      expect(await product.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1080 });
    }
    const fill = async (word: string) => {
      await product.getByLabel('产品词', { exact: true }).fill(word);
      await selectCountry(page, product, 'TUR');
      await product.getByLabel('贸易开始日期').fill('2026-01-01');
      await product.getByLabel('贸易结束日期').fill('2026-06-30');
    };
    const quote = async () => product.getByRole('button', { name: '查看第 1 页报价' }).click();
    const execute = async () => product.getByRole('button', { name: '确认本页费用并查询' }).click();
    await fill('ceramic pump');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(/terminal\/search/);
    await quote();
    await expect(product.getByRole('alert')).toContainText('尚无已核实');
    expect(calls).toHaveLength(0);
    Object.assign(importer, { buyerCountryFilterVerified: false });
    await quote();
    await expect(product.getByRole('alert')).toContainText('映射尚未核实');
    expect(calls).toHaveLength(0);
    Object.assign(importer, { buyerCountryFilterVerified: true });
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/trade/importers-name',0.5,2,'Issue54 controlled fixture','controlled_test',$1,$3),('/v2/company',0.5,2,'Issue54 controlled fixture','controlled_test',$2,$3)`, [randomUUID(), randomUUID(), platform.id]);
    await quote();
    await expect(product.getByRole('button', { name: '确认本页费用并查询' })).toBeVisible();
    await product.getByRole('button', { name: '取消', exact: true }).click();
    expect(calls).toHaveLength(0);
    await quote();
    await product.getByLabel('产品词', { exact: true }).fill('unsubmitted replacement');
    gate = new Promise<void>(resolve => { release = resolve; });
    await execute();
    await expect.poll(() => calls.length).toBe(1);
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(/terminal\/search/);
    release!(); gate = undefined;
    await expect(product.getByText('Trade Buyer 1', { exact: true })).toBeVisible();
    if (process.env.ISSUE54_VISUAL === '1') await product.screenshot({ path: resolve(root, 'product-results-desktop.png') });
    expect(calls[0]).toEqual({ catalog: 'imports', productDesc: 'ceramic pump', buyerCountryCode3: 'TUR', startDate: '2026-01-01', endDate: '2026-06-30', pageNo: 1, pageSize: 20 });
    await product.getByRole('button', { name: '下一页报价' }).click();
    await expect(product.getByText('贸易时间 2026-01-01 至 2026-06-30 · 第 2 页')).toBeVisible();
    expect(calls).toHaveLength(1);
    await execute();
    await expect(product.getByText('Trade Buyer 2', { exact: true })).toBeVisible();
    expect(calls[1]).toEqual({ ...calls[0], pageNo: 2 });
    const row = (await pool.query('SELECT id FROM product_search_pages WHERE page_no=2 AND organization_id=$1', [orgA])).rows[0];
    const productCandidate = (await pool.query('SELECT id FROM product_search_candidates WHERE page_id=$1', [row.id])).rows[0].id;
    expect((await post('product-searches/execute', { pageId: row.id })).body.state).toBe('settled');
    expect(calls).toHaveLength(2);
    emptyCompanies = true;
    await product.getByRole('button', { name: '免费核实企业身份' }).click();
    await expect(product.getByText('该国家没有匹配的企业，不能继续建档')).toBeVisible();
    emptyCompanies = false; companyCountry = 'USA';
    await product.getByRole('button', { name: '免费核实企业身份' }).click();
    await product.getByRole('button', { name: '确认是该企业' }).click();
    await expect(product.getByRole('alert')).toContainText('国家');
    companyCountry = 'TUR';
    await product.getByRole('button', { name: '免费核实企业身份' }).click();
    await expect(product.getByRole('button', { name: '确认是该企业' })).toBeVisible();
    const companyCandidate = (await pool.query('SELECT c.id FROM company_candidates c JOIN company_searches s ON s.id=c.search_id WHERE c.organization_id=$1 ORDER BY s.created_at DESC LIMIT 1', [orgA])).rows[0].id;
    expect((await post('company-details/quote', { candidateId: companyCandidate })).status).toBe(404);
    await product.getByRole('button', { name: '确认是该企业' }).click();
    await product.getByRole('button', { name: '查看详情报价' }).click();
    await expect(product.getByRole('button', { name: '另行确认详情费用并建档' })).toBeVisible();
    expect(detailCalls).toHaveLength(0);
    await product.getByRole('button', { name: '取消', exact: true }).click();
    expect(detailCalls).toHaveLength(0);
    await product.getByRole('button', { name: '查看详情报价' }).click();
    await product.getByRole('button', { name: '另行确认详情费用并建档' }).click();
    await expect(product.getByText('企业已建档，详情扣点 0.1234；名单费独立结算')).toBeVisible();
    expect(detailCalls).toEqual([{ name: 'Verified Legal Buyer 54', countryCode3: 'TUR' }]);
    const profile = (await pool.query('SELECT id,detail_id,query_id FROM company_profiles WHERE organization_id=$1', [orgA])).rows[0];
    expect(profile.detail_id).toBe('detail-data-id-54');
    expect(new Set([row.id, productCandidate, companyCandidate, 'list-source-54', profile.id, profile.detail_id, profile.query_id]).size).toBe(7);
    expect((await post('company-details/execute', { queryId: profile.query_id })).body.state).toBe('settled');
    await product.getByRole('button', { name: '查看详情报价' }).click();
    await expect(product.getByText('本企业已有本地档案，免费查看')).toBeVisible();
    expect(detailCalls).toHaveLength(1);
    await fill('ceramic pump');
    await product.getByRole('link', { name: '进入企业档案 · Verified Legal Buyer 54' }).click();
    await expect(page).toHaveURL(new RegExp(`/terminal/profiles\\?id=${profile.id}`));
    await expect(page.locator('.profile-detail:visible').getByRole('heading', { name: 'Verified Legal Buyer 54 · TUR' })).toBeVisible();
    await page.goBack();
    await expect(product.getByText('本企业已有本地档案，免费查看')).toBeVisible();
    await page.goForward(); await page.goBack();
    expect(calls).toHaveLength(2); expect(detailCalls).toHaveLength(1);
    // New selection: true zero releases the whole reservation.
    mode = 'zero'; await fill('zero pump'); await quote(); await execute();
    await expect(product.getByText('本页没有采购企业候选')).toBeVisible();
    await expect(product.getByText('本页已结算 0.0000 点；下一页须重新确认。')).toBeVisible();
    // A timed out page retains its original page ID across navigation; status reads never call vendors.
    mode = 'timeout'; await fill('timeout pump'); await quote(); await execute();
    await expect(product.getByRole('button', { name: '核实本页结果' })).toBeVisible();
    await expect(product.getByRole('button', { name: '核实本页结果' })).toBeEnabled();
    const pending = (await pool.query("SELECT id FROM product_search_pages WHERE product_desc='timeout pump' AND organization_id=$1", [orgA])).rows[0].id;
    const before = calls.length;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await page.getByRole('link', { name: '找企业', exact: true }).click();
    await expect(product.getByRole('button', { name: '核实本页结果' })).toBeVisible();
    expect(calls).toHaveLength(before);
    await product.getByRole('button', { name: '核实本页结果' }).click();
    expect((await post('product-searches/execute', { pageId: pending })).body.state).toBe('pending');
    expect(calls).toHaveLength(before);
    expect((await pool.query('SELECT query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0].query_frozen).toBe('1.0000');
    // Platform final failure followed by a late result never grants candidates or charges the tenant.
    const platformLogin = await page.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { email: 'super_admin', password } });
    expect(platformLogin.status()).toBe(200);
    const reconciliation = { queryId: pending, outcome: 'failed', billingReference: 'issue54-bill', evidence: 'Controlled final failure' };
    expect((await post('product-searches/reconciliations', reconciliation)).status).toBe(200);
    expect((await post('product-searches/reconciliations', reconciliation)).status).toBe(200);
    const late = { queryId: pending, billingReference: 'issue54-bill', traceId: 'late-54', evidence: 'Controlled late result', result: { content: [{ name: 'Late Buyer' }], page: 1, size: 20, total: 1 } };
    expect((await post('product-searches/late-results', late)).status).toBe(200);
    expect((await post('product-searches/late-results', late)).status).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM product_search_late_results WHERE page_id=$1', [pending])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM product_search_candidates WHERE page_id=$1', [pending])).rows[0].n).toBe(0);
    // Restore admin cookies without reloading its cached unknown context.
    await page.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { email: accounts.admin.email, password } });
    await product.getByRole('button', { name: '核实本页结果' }).click();
    await expect(product.getByText('本页查询已确认失败，不展示候选；可重新报价。')).toBeVisible();
    const balance = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(balance).toEqual({ balance: '19.0124', query_frozen: '0.0000' });
    // Detail timeout preserves independent query ID and list settlement.
    mode = 'success'; detailMode = 'timeout'; await fill('detail timeout'); await quote(); await execute();
    await product.getByRole('button', { name: '免费核实企业身份' }).click();
    await product.getByRole('button', { name: '确认是该企业' }).click();
    await product.getByRole('button', { name: '查看详情报价' }).click();
    await product.getByRole('button', { name: '另行确认详情费用并建档' }).click();
    await expect(product.getByRole('button', { name: '核实详情结果' })).toBeVisible();
    await expect(product.getByRole('button', { name: '核实详情结果' })).toBeEnabled();
    const detailPending = (await pool.query("SELECT id FROM company_detail_queries WHERE organization_id=$1 AND state='pending'", [orgA])).rows[0].id;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await page.goBack();
    await product.getByRole('button', { name: '核实详情结果' }).click();
    expect((await post('company-details/execute', { queryId: detailPending })).body.state).toBe('pending');
    expect(detailCalls).toHaveLength(2);
    const frozen = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(frozen).toEqual({ balance: '18.5803', query_frozen: '1.0000' });
    // Sessions and tenants: no local selection may cross the authorization boundary.
    for (const label of ['sales', 'foreign', 'platform', 'distributor', 'temporary']) {
      const context = await browser.newContext(); const tab = await context.newPage();
      await tab.goto(`${origin}/terminal/search`);
      await tab.getByLabel('登录账号', { exact: true }).fill(label === 'platform' ? 'super_admin' : accounts[label].email);
      await tab.getByLabel('密码', { exact: true }).fill(password);
      await tab.getByRole('button', { name: '登录', exact: true }).click();
      if (label === 'temporary') await expect(tab.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
      else {
        await expect(tab.getByRole('button', { name: `${label === 'platform' ? 'super_admin' : accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
        await tab.goto(`${origin}/terminal/search`);
      }
      const csrf = (await context.cookies()).find(cookie => cookie.name === 'identity_csrf')?.value ?? '';
      const call = (path: string, body: object) => context.request.post(`${origin}/api/${path}`, { headers: { Origin: origin, 'X-CSRF-Token': csrf }, data: body });
      if (label === 'sales') {
        await expect(tab.locator('.product-search')).toHaveCount(1);
        expect((await call('product-searches/page', { pageId: row.id })).status()).toBe(200);
        expect((await call('company-details/status', { queryId: profile.query_id })).status()).toBe(200);
        mode = 'zero';
        const salesProduct = tab.locator('.product-search');
        await salesProduct.getByLabel('产品词', { exact: true }).fill('sales zero');
        await selectCountry(tab, salesProduct, 'TUR');
        await salesProduct.getByLabel('贸易开始日期').fill('2026-01-01');
        await salesProduct.getByLabel('贸易结束日期').fill('2026-06-30');
        await salesProduct.getByRole('button', { name: '查看第 1 页报价' }).click();
        await expect(salesProduct.getByRole('button', { name: '确认本页费用并查询' })).toBeVisible();
        await salesProduct.getByRole('button', { name: '确认本页费用并查询' }).click();
        await expect(salesProduct.getByText('本页已结算 0.0000 点；下一页须重新确认。')).toBeVisible();
      } else if (label === 'foreign') {
        await expect(tab.locator('.product-search')).toHaveCount(1);
        expect((await call('product-searches/page', { pageId: row.id })).status()).toBe(404);
        expect((await call('product-candidates/check', { candidateId: productCandidate })).status()).toBe(404);
        expect((await call('company-details/quote', { candidateId: companyCandidate })).status()).toBe(404);
        expect((await call('product-searches/execute', { pageId: row.id })).status()).toBe(404);
        expect((await call('company-details/status', { queryId: profile.query_id })).status()).toBe(404);
      } else {
        await expect(tab.locator('.product-search')).toHaveCount(0);
        expect((await call('product-searches/page', { pageId: row.id })).status()).toBe(403);
      }
      await context.close();
    }
    // Production entry and Vite both accept direct route reloads without paid calls.
    const devOrigin = `http://127.0.0.1:${await freePort()}`;
    const backendPort = await freePort();
    devApp = await createApplication(pool, devOrigin, false, undefined, companies, undefined, details, undefined, undefined, undefined, undefined, undefined, resolve(root, 'web'));
    await devApp.listen(backendPort, '127.0.0.1');
    vite = await createServer(mergeConfig(viteConfig, { configFile: false, server: { host: '127.0.0.1', port: Number(new URL(devOrigin).port), strictPort: true, proxy: { '/api': `http://127.0.0.1:${backendPort}` } } }));
    await vite.listen();
    const context = await browser.newContext(); await context.addCookies(await page.context().cookies());
    const tab = await context.newPage(); await tab.goto(`${devOrigin}/terminal/search`);
    await expect(tab.locator('.product-search')).toHaveCount(1); await tab.reload();
    await expect(tab.locator('.product-search')).toHaveCount(1);
    const devProduct = tab.locator('.product-search');
    await devProduct.getByLabel('产品词', { exact: true }).fill('unconfigured supplier');
    await selectCountry(tab, devProduct, 'TUR');
    await devProduct.getByLabel('贸易开始日期').fill('2026-01-01');
    await devProduct.getByLabel('贸易结束日期').fill('2026-06-30');
    await devProduct.getByRole('button', { name: '查看第 1 页报价' }).click();
    await expect(devProduct.getByRole('alert')).toContainText('映射尚未核实');
    await context.close();
    expect(calls).toHaveLength(6); expect(detailCalls).toHaveLength(2);
    const ledger = (await pool.query('SELECT page_id,event,amount,balance_after,frozen_after FROM product_search_ledger ORDER BY id')).rows;
    expect(ledger.filter(item => item.page_id === row.id)).toHaveLength(3);
    const detailLedger = (await pool.query('SELECT query_id,event,amount FROM query_point_ledger ORDER BY id')).rows;
    expect(detailLedger.filter(item => item.query_id === profile.query_id)).toHaveLength(3);
    await writeFile(resolve(root, 'evidence.json'), JSON.stringify({ passed: true, database: new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1), node: process.version, origin, devOrigin, calls, companyCalls, detailCalls, ids: { productPage: row.id, productCandidate, companyCandidate, profile, pending, detailPending }, balance, frozen, ledger, detailLedger, requests }, null, 2));
  } finally {
    release?.(); await vite?.close(); await devApp?.close(); await app.close(); await pool.end();
  }
});
