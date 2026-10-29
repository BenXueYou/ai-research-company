import { test, expect, type Page } from '@playwright/test';
import { selectCountries } from './helpers/countrySelect.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { createServer, mergeConfig } from 'vite';
import viteConfig from '../vite.config.js';
import type { CompanyListRequestDto } from '../server/upstream/tengdao.js';

async function freePort() {
  const server = netServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test('Issue53 company search, confirmation, settlement, tenant gates and lifecycle', async ({ page, browser }) => {
  page.setDefaultTimeout(10000);
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const pool = database(databaseUrl);
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const root = resolve('.scratch/issue53');
  await mkdir(root, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const listCalls: CompanyListRequestDto[] = [];
  const detailCalls: Array<{ name: string; countryCode3: string }> = [];
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const list = { listCompanies: async (input: CompanyListRequestDto) => {
    listCalls.push(input);
    if (input.name === 'list-failure') throw new Error('Controlled list failure');
    return {
      content: input.name === 'empty' ? [] : [
        { id: `list-other-${input.name}-${input.pageNo}`, name: 'Other Candidate', country: 'USA' },
        { id: `list-selected-${input.name}-${input.pageNo}`, name: `Selected ${input.name}`, country: 'TUR' }
      ],
      page: input.pageNo, size: input.pageSize, total: input.name === 'empty' ? 0 : 21
    };
  } };
  const detail = { detail: async (input: { name: string; countryCode3: string }) => {
    detailCalls.push(input);
    if (gate) await gate;
    if (input.name.includes('timeout')) throw new Error('Controlled vendor timeout');
    if (input.name.includes('zero')) return { data: { id: null }, actualUpstreamPoints: '0.0000' };
    if (input.name.includes('missing')) return { data: null, actualUpstreamPoints: '0.3000' };
    return { data: { id: `detail-${input.name}`, countryCode3: input.name.includes('mismatch') ? 'USA' : 'TUR' }, actualUpstreamPoints: '0.3000' };
  } };
  await migrate(pool);
  const app = await createApplication(pool, origin, false, undefined, list, undefined, detail, undefined, undefined,
    undefined, undefined, undefined, resolve(root, 'web'));
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const password = 'Issue53-test-password!';
  const requests: Array<{ path: string; body: unknown }> = [];
  page.on('request', request => {
    if (request.url().includes('/api/company-') && request.method() === 'POST') requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  try {
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const orgA = randomUUID(); const orgB = randomUUID(); const distributorOrg = randomUUID();
    for (const org of [orgA, orgB, distributorOrg]) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [org, org === orgA ? 'A' : 'B', org === distributorOrg ? 'distributor' : 'terminal', platform.organization_id, org === distributorOrg ? 1 : 0, randomUUID()]);
    const accounts: Record<string, { id: string; email: string; org: string }> = {};
    for (const [label, role, org] of [['admin', 'admin', orgA], ['sales', 'sales', orgA], ['foreign', 'admin', orgB], ['distributor', 'distributor', distributorOrg], ['temporary', 'sales', orgA]]) {
      const account = { id: randomUUID(), email: `${label}@issue53.test`, org };
      accounts[label] = account;
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '72 hours')`, [account.id, org, account.email, hash, role, label === 'temporary']);
    }
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,20),($2,0)', [orgA, orgB]);
    await pool.query('UPDATE platform_pricing SET coefficient=1');
    await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/company',0.5,2,'Issue53 controlled fixture','controlled_test',$1,$2)`, [randomUUID(), platform.id]);
    const login = async (tab: Page, label: string, base = origin) => {
      await tab.goto(`${base}/terminal/search`);
      await tab.getByLabel('登录账号', { exact: true }).fill(label === 'platform' ? 'super_admin' : accounts[label].email);
      await tab.getByLabel('密码', { exact: true }).fill(password);
      await tab.getByRole('button', { name: '登录', exact: true }).click();
      if (label !== 'temporary') await expect(tab.getByRole('button', { name: `${label === 'platform' ? 'super_admin' : accounts[label].email} 的账号菜单`, exact: true })).toBeVisible();
    };
    const post = async (tab: Page, path: string, body: Record<string, unknown>) => tab.evaluate(async ({ path, body }) => {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('identity_csrf='))?.slice(14) ?? '';
      const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body });
    await app.listen(port, '127.0.0.1');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page, 'admin');
    await expect(page.locator('.company-search')).toHaveCount(1);
    await expect(page.locator('.product-search')).toHaveCount(1);
    expect(listCalls).toHaveLength(0); expect(detailCalls).toHaveLength(0);
    await page.reload();
    await page.getByRole('link', { name: '企业档案库', exact: true }).click();
    await expect(page.getByText('当前筛选下没有档案')).toBeVisible();
    await page.getByRole('link', { name: '找企业', exact: true }).click();
    const search = page.locator('.company-search');
    const runSearch = async (name: string) => {
      await search.getByLabel('公司名称', { exact: true }).fill(name);
      await selectCountries(page, search, 'USA,TUR');
      await search.getByRole('button', { name: '免费查询', exact: true }).click();
      await expect(search.getByText('第 1 页', { exact: true })).toBeVisible();
    };
    await search.getByLabel('公司名称', { exact: true }).fill('bad');
    await expect(search.locator('.country-select')).toContainText('中国 CHN');
    const countryInput = search.locator('.country-select').getByRole('combobox');
    await countryInput.fill('日本');
    const japanOption = page.getByRole('option', { name: '日本 JPN', exact: true });
    await expect(japanOption).toBeVisible();
    expect(await japanOption.locator('img').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
    await japanOption.click();
    await expect(search.locator('.country-select')).toContainText('日本 JPN');
    await countryInput.fill('united states');
    await expect(page.getByRole('option', { name: '美国 USA', exact: true })).toBeVisible();
    await countryInput.press('Escape');
    while (await search.locator('.country-select .el-tag__close').count()) {
      await search.locator('.country-select .el-tag__close').first().click();
    }
    await countryInput.press('Escape');
    await search.getByLabel('公司名称', { exact: true }).click();
    await search.getByRole('button', { name: '免费查询', exact: true }).click();
    await expect(search.getByText('国家地区须使用三位大写代码，多个代码以英文逗号分隔', { exact: true })).toBeVisible();
    expect(listCalls).toHaveLength(0);
    await selectCountries(page, search, 'TR');
    await search.getByRole('button', { name: '免费查询', exact: true }).click();
    await expect(search.getByText('国家地区须使用三位大写代码，多个代码以英文逗号分隔', { exact: true })).toBeVisible();
    expect(listCalls).toHaveLength(0);
    await runSearch('success');
    expect(listCalls[0]).toEqual({ name: 'success', countryCodes: 'USA,TUR', pageNo: 1, pageSize: 20 });
    expect((await pool.query("SELECT count(*)::int n FROM company_candidates WHERE verification_status='verified'")).rows[0].n).toBe(0);
    const candidate = (await pool.query("SELECT id,source_id FROM company_candidates WHERE source_name='Selected success'")).rows[0];
    expect((await post(page, 'company-details/quote', { candidateId: candidate.id })).status).toBe(404);
    const selectedRow = search.locator('.candidate-row').nth(1);
    await selectedRow.getByRole('button', { name: '确认是该企业' }).click();
    await selectedRow.getByRole('button', { name: '查看详情报价' }).click();
    await expect(search.getByText('锁定系数 1.0000 · 最高扣点 1.0000')).toBeVisible();
    await page.screenshot({ path: resolve(root, 'search-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(root, 'search-mobile.png'), fullPage: true });
    expect(await search.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(detailCalls).toHaveLength(0);
    await search.getByRole('button', { name: '取消', exact: true }).click();
    expect((await pool.query('SELECT count(*)::int n FROM query_point_ledger')).rows[0].n).toBe(0);
    await selectedRow.getByRole('button', { name: '查看详情报价' }).click();
    await search.getByRole('button', { name: '确认费用并查询详情' }).click();
    await expect(search.getByText('详情已入档，实际扣点 0.3000')).toBeVisible();
    expect(detailCalls).toEqual([{ name: 'Selected success', countryCode3: 'TUR' }]);
    const saved = (await pool.query('SELECT id,detail_id,query_id FROM company_profiles WHERE organization_id=$1', [orgA])).rows[0];
    expect(new Set([candidate.id, candidate.source_id, saved.id, saved.detail_id, saved.query_id]).size).toBe(5);
    await expect(search.getByText('余额 19.7000 · 查询冻结 0.0000 · 可用 19.7000')).toBeVisible();
    await search.getByRole('link', { name: '打开已建档企业' }).click();
    await expect(page).toHaveURL(new RegExp(`terminal/profiles\\?id=${saved.id}`));
    await expect(page.locator('.profile-detail:visible').getByRole('heading', { name: 'Selected success · TUR' })).toBeVisible();
    await page.screenshot({ path: resolve(root, 'profile.png'), fullPage: true });
    await page.getByRole('link', { name: '找企业', exact: true }).click();
    expect(detailCalls).toHaveLength(1); expect(listCalls).toHaveLength(1);
    await selectedRow.getByRole('button', { name: '查看详情报价' }).click();
    await expect(search.getByText('本企业已有本地档案，免费查看')).toBeVisible();
    await expect(search.getByRole('link', { name: '打开已建档企业' })).toHaveAttribute('href', `/terminal/profiles?id=${saved.id}`);
    expect((await post(page, 'company-details/execute', { queryId: saved.query_id })).body.state).toBe('settled');
    expect(detailCalls).toHaveLength(1);
    await search.getByRole('button', { name: '下一页' }).click();
    await expect(search.getByText('第 2 页', { exact: true })).toBeVisible();
    expect(listCalls.at(-1)).toEqual({ name: 'success', countryCodes: 'USA,TUR', pageNo: 2, pageSize: 20 });
    await search.getByRole('button', { name: '上一页' }).click();
    await runSearch('empty');
    await expect(search.getByText('本页没有匹配企业')).toBeVisible();
    await runSearch('zero');
    await selectedRow.getByRole('button', { name: '确认是该企业' }).click();
    await selectedRow.getByRole('button', { name: '查看详情报价' }).click();
    await search.getByRole('button', { name: '确认费用并查询详情' }).click();
    await expect(search.getByText('详情无匹配，已释放全部冻结')).toBeVisible();
    const zeroAccount = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(zeroAccount).toEqual({ balance: '19.7000', query_frozen: '0.0000' });
    await runSearch('timeout');
    await selectedRow.getByRole('button', { name: '确认是该企业' }).click();
    await selectedRow.getByRole('button', { name: '查看详情报价' }).click();
    gate = new Promise<void>(resolve => { release = resolve; });
    await search.getByRole('button', { name: '确认费用并查询详情' }).click();
    await expect.poll(() => detailCalls.length).toBe(3);
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(/terminal\/search$/);
    release!(); gate = undefined;
    await expect(search.getByText('结果确认中，已保留冻结；请勿重复发起')).toBeVisible();
    const pending = (await pool.query("SELECT id FROM company_detail_queries WHERE name='Selected timeout'")).rows[0].id;
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(/terminal\/search$/);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: '点数用量', exact: true }).click();
    await expect(page).toHaveURL(/terminal\/usage$/);
    await page.goBack();
    await expect(search.getByText('结果确认中，已保留冻结；请勿重复发起')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.goForward();
    await expect(page).toHaveURL(/terminal\/usage$/);
    await page.goBack();
    await expect(search.getByText('结果确认中，已保留冻结；请勿重复发起')).toBeVisible();
    expect(detailCalls).toHaveLength(3);
    await search.getByRole('button', { name: '核实原查询结果' }).click();
    expect(detailCalls).toHaveLength(3);
    expect((await post(page, 'company-details/execute', { queryId: pending })).body.state).toBe('pending');
    expect(detailCalls).toHaveLength(3);
    const pendingAccount = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(pendingAccount).toEqual({ balance: '19.7000', query_frozen: '1.0000' });
    const edgeResults = [];
    for (const mode of ['mismatch', 'missing']) {
      const searched = await post(page, 'company-searches', { name: mode, countryCodes: 'TUR', pageNo: 1, pageSize: 20 });
      const chosen = searched.body.content[1];
      await post(page, 'company-candidates/verify', { candidateId: chosen.candidateId });
      const quoted = await post(page, 'company-details/quote', { candidateId: chosen.candidateId });
      const executed = await post(page, 'company-details/execute', { queryId: quoted.body.queryId });
      expect(executed.body.state).toBe('pending');
      expect((await post(page, 'company-details/execute', { queryId: quoted.body.queryId })).body.state).toBe('pending');
      edgeResults.push({ mode, queryId: quoted.body.queryId, state: executed.body.state });
    }
    const roleResults = [];
    for (const label of ['sales', 'foreign', 'platform', 'distributor', 'temporary']) {
      const context = await browser.newContext(); const tab = await context.newPage();
      await login(tab, label);
      if (['sales', 'foreign'].includes(label)) {
        await expect(tab.locator('.company-search')).toHaveCount(1);
        await tab.reload(); await expect(tab.locator('.company-search')).toHaveCount(1);
      } else if (label === 'temporary') await expect(tab.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
      else await expect(tab).not.toHaveURL(/terminal\/search/);
      const status = await post(tab, 'company-details/status', { queryId: saved.query_id });
      expect(status.status).toBe(label === 'sales' ? 200 : label === 'foreign' ? 404 : 403);
      const verify = await post(tab, 'company-candidates/verify', { candidateId: candidate.id });
      expect(verify.status).toBe(label === 'sales' ? 200 : label === 'foreign' ? 404 : 403);
      const execute = await post(tab, 'company-details/execute', { queryId: saved.query_id });
      expect(execute.status).toBe(label === 'sales' ? 200 : label === 'foreign' ? 404 : 403);
      roleResults.push({ label, status: status.status, verify: verify.status, execute: execute.status });
      if (label === 'sales') {
        const ownSearch = tab.locator('.company-search');
        await ownSearch.getByLabel('公司名称', { exact: true }).fill('sales-success');
        await selectCountries(tab, ownSearch, 'TUR');
        await ownSearch.getByRole('button', { name: '免费查询', exact: true }).click();
        const ownRow = ownSearch.locator('.candidate-row').nth(1);
        await ownRow.getByRole('button', { name: '确认是该企业' }).click();
        await ownRow.getByRole('button', { name: '查看详情报价' }).click();
        await ownSearch.getByRole('button', { name: '确认费用并查询详情' }).click();
        await expect(ownSearch.getByText('详情已入档，实际扣点 0.3000')).toBeVisible();
        await ownSearch.getByRole('link', { name: '打开已建档企业' }).click();
        await expect(tab.locator('.profile-detail:visible').getByRole('heading', { name: 'Selected sales-success · TUR' })).toBeVisible();
      }
      if (label === 'foreign') {
        const found = await post(tab, 'company-searches', { name: 'poor', countryCodes: 'TUR', pageNo: 1, pageSize: 20 });
        const id = found.body.content[1].candidateId;
        await post(tab, 'company-candidates/verify', { candidateId: id });
        const quoted = await post(tab, 'company-details/quote', { candidateId: id });
        expect((await post(tab, 'company-details/execute', { queryId: quoted.body.queryId })).status).toBe(409);
        expect((await pool.query('SELECT query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgB])).rows[0].query_frozen).toBe('0.0000');
      }
      if (label === 'platform') {
        const failure = { queryId: pending, evidence: 'Controlled final failure evidence for Issue53 timeout' };
        expect((await post(tab, 'company-details/final-failure', failure)).body.state).toBe('failed');
        expect((await post(tab, 'company-details/final-failure', failure)).body.state).toBe('failed');
      }
      await context.close();
    }
    expect(detailCalls).toHaveLength(6);
    expect((await pool.query('SELECT count(*)::int n FROM company_profiles')).rows[0].n).toBe(2);
    expect((await post(page, 'company-details/status', { queryId: pending, unexpected: true })).status).toBe(400);
    await search.getByRole('button', { name: '核实原查询结果' }).click();
    await expect(search.getByText('查询已确认失败，冻结已释放')).toBeVisible();
    await search.getByLabel('公司名称', { exact: true }).fill('list-failure');
    await search.getByRole('button', { name: '免费查询', exact: true }).click();
    await expect(search.locator('.el-alert--error')).toBeVisible();
    expect(detailCalls).toHaveLength(6);
    await runSearch('lost-response');
    await selectedRow.getByRole('button', { name: '确认是该企业' }).click();
    await selectedRow.getByRole('button', { name: '查看详情报价' }).click();
    await page.route('**/api/company-details/execute', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    }, { times: 1 });
    await search.getByRole('button', { name: '确认费用并查询详情' }).click();
    await expect(search.getByText('结果尚未确认，请核实原查询结果')).toBeVisible();
    const lostQuery = (await pool.query("SELECT id FROM company_detail_queries WHERE name='Selected lost-response'")).rows[0].id;
    await search.getByRole('button', { name: '核实原查询结果' }).click();
    await expect(search.getByText('详情已入档，实际扣点 0.3000')).toBeVisible();
    expect(requests.filter(request => request.path === '/api/company-details/status').at(-1)?.body).toEqual({ queryId: lostQuery });
    expect(detailCalls).toHaveLength(7);
    const finalAccount = (await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [orgA])).rows[0];
    expect(finalAccount).toEqual({ balance: '19.1000', query_frozen: '2.0000' });
    await page.getByRole('button', { name: 'admin@issue53.test 的账号菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible();
    await login(page, 'foreign');
    await expect(page.locator('.company-search').getByLabel('公司名称', { exact: true })).toHaveValue('');
    await expect(page.locator('.company-search').getByRole('link', { name: '打开已建档企业' })).toHaveCount(0);
    await expect(page.locator('.company-search').getByRole('button', { name: '核实原查询结果' })).toHaveCount(0);
    const devPort = await freePort(); const backendPort = await freePort();
    const devOrigin = `http://127.0.0.1:${devPort}`;
    devApp = await createApplication(pool, devOrigin, false, undefined, list, undefined, detail, undefined, undefined, undefined, undefined, undefined, resolve(root, 'web'));
    await devApp.listen(backendPort, '127.0.0.1');
    vite = await createServer(mergeConfig(viteConfig, { configFile: false, server: { host: '127.0.0.1', port: devPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${backendPort}` } } }));
    await vite.listen();
    const devContext = await browser.newContext(); const devPage = await devContext.newPage();
    await login(devPage, 'sales', devOrigin);
    await devPage.reload(); await expect(devPage.locator('.company-search')).toHaveCount(1);
    await devContext.close();
    expect(detailCalls).toHaveLength(7);
    const ledger = (await pool.query('SELECT query_id,event,amount,balance_after,frozen_after FROM query_point_ledger ORDER BY id')).rows;
    expect(ledger.filter(row => row.query_id === saved.query_id).map(row => ({ event: row.event, amount: row.amount }))).toEqual([
      { event: 'freeze', amount: '1.0000' }, { event: 'settle', amount: '0.3000' }, { event: 'release', amount: '0.7000' }
    ]);
    expect(ledger.filter(row => row.query_id === pending).map(row => ({ event: row.event, amount: row.amount }))).toEqual([
      { event: 'freeze', amount: '1.0000' }, { event: 'release', amount: '1.0000' }
    ]);
    await writeFile(resolve(root, 'evidence.json'), JSON.stringify({ passed: true, origin, devOrigin, ids: { candidate, saved }, listCalls, detailCalls, requests, zeroAccount, pendingAccount, finalAccount, ledger, edgeResults, roleResults }, null, 2));
  } finally {
    release?.(); await vite?.close(); await devApp?.close(); await app.close(); await pool.end();
  }
});
