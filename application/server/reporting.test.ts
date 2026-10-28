import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createApplication } from './app.js';
import { migrate } from './database.js';
import { digest } from './identity/identity.js';
import { hashPassword } from './identity/policy.js';
import { createServer } from 'vite';

test('Issue44 scoped reporting, CSV download and role gates through HTTP, PostgreSQL and Chromium', async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required');
  const name = `issue44_${randomUUID().replaceAll('-', '')}_test`;
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Pool({ connectionString: adminUrl.toString() });
  await admin.query(`CREATE DATABASE "${name}"`);
  const dbUrl = new URL(source);
  dbUrl.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: dbUrl.toString() });
  const origin = 'http://127.0.0.1:3344';
  const priorKey = process.env.ORG_CONTACT_KEY;
  const priorSmtpKey = process.env.SMTP_CREDENTIAL_KEY;
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    await migrate(pool);
    const platform = (await pool.query("SELECT id FROM organizations WHERE kind='platform'")).rows[0].id;
    const platformAccount = (await pool.query("SELECT id FROM accounts WHERE role='platform'")).rows[0].id;
    const distributor = randomUUID();
    const terminal = randomUUID();
    const outsider = randomUUID();
    for (const [id, kind, parent, level] of [
      [distributor, 'distributor', platform, 1],
      [terminal, 'terminal', distributor, 0],
      [outsider, 'terminal', platform, 0]
    ] as const) await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,$3,$4,$5,'encrypted',$6,'masked')`, [id, id, kind, parent, level, id]);
    const accounts = [
      { id: platformAccount, org: platform, role: 'platform', token: 't28-platform' },
      { id: randomUUID(), org: distributor, role: 'distributor', token: 't28-distributor' },
      { id: randomUUID(), org: terminal, role: 'admin', token: 't28-terminal' },
      { id: randomUUID(), org: outsider, role: 'admin', token: 't28-outsider' },
      { id: randomUUID(), org: terminal, role: 'sales', token: 'issue44-sales' }
    ];
    const password = 'Issue44FixturePwd!';
    const passwordHash = await hashPassword(password);
    for (const account of accounts) {
      if (account.role !== 'platform') await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,'hash',$4,false)`, [account.id, account.org, `${account.id}@test.invalid`, account.role]);
      else await pool.query('UPDATE accounts SET must_change=false WHERE id=$1', [account.id]);
      await pool.query('INSERT INTO sessions(token_hash,account_id,csrf_hash) VALUES($1,$2,$3)',
        [digest(account.token), account.id, digest('csrf')]);
      await pool.query('UPDATE accounts SET password_hash=$1 WHERE id=$2', [passwordHash, account.id]);
    }
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen) VALUES($1,10,2),($2,20,3)',
      [terminal, outsider]);
    for (const [org, actorId, points, term] of [
      [terminal, accounts[2].id, 1, 'private-terminal-keyword'],
      [outsider, accounts[3].id, 2, 'other-private-keyword']
    ] as const) {
      const pageId = randomUUID();
      await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,
        start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state,charged_points)
        VALUES($1,$2,$3,$4,'USA','2026-01-01','2026-02-01',1,10,1,3,$5,'settled',$6)`,
      [pageId, org, actorId, term, randomUUID(), points]);
      await pool.query(`INSERT INTO product_search_ledger(page_id,organization_id,actor_id,event,amount,balance_after,frozen_after)
        VALUES($1,$2,$3,'settle',$4,9,0)`, [pageId, org, actorId, points]);
    }
    const orderId = randomUUID();
    await pool.query(`INSERT INTO point_orders(id,seller_id,buyer_id,quantity,unit_price,amount,status,receipt_reference,created_by,confirmed_by,confirmed_at)
      VALUES($1,$2,$3,1,2,2,'transferred','receipt',$4,$4,clock_timestamp())`, [orderId, distributor, terminal, accounts[1].id]);
    await pool.query(`INSERT INTO point_transfers(order_id,seller_id,buyer_id,actor_id,quantity,seller_balance_after,
      seller_reserved_after,buyer_balance_after,sales_unit_cost,sales_cost,sales_amount,gross_profit)
      VALUES($1,$2,$3,$4,1,0,0,10,1,1,2,1)`, [orderId, distributor, terminal, accounts[1].id]);
    const platformOrderId = randomUUID();
    await pool.query(`INSERT INTO point_orders(id,seller_id,buyer_id,quantity,unit_price,amount,status,receipt_reference,created_by,confirmed_by,confirmed_at)
      VALUES($1,$2,$3,1,3,3,'transferred','platform-receipt',$4,$4,clock_timestamp())`,
    [platformOrderId, platform, distributor, platformAccount]);
    await pool.query(`INSERT INTO point_transfers(order_id,seller_id,buyer_id,actor_id,quantity,seller_balance_after,
      seller_reserved_after,buyer_balance_after,sales_unit_cost,sales_cost,sales_amount,gross_profit)
      VALUES($1,$2,$3,$4,1,0,0,10,1.5,1.5,3,1.5)`, [platformOrderId, platform, distributor, platformAccount]);
    const expenseId = randomUUID();
    const secondExpenseId = randomUUID();
    await pool.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id)
      VALUES($1,'failure','loss-1',0.5000,'bill',$2)`, [expenseId, platformAccount]);
    await pool.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id)
      VALUES($1,'excess','loss-2',0.2500,'bill',$2)`, [secondExpenseId, platformAccount]);
    await assert.rejects(pool.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id)
      VALUES($1,'failure','loss-1',0.5000,'duplicate',$2)`, [randomUUID(), platformAccount]),
    { code: '23505' });
    app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, resolve('.scratch/issue44-web'));
    await app.listen(3344, '127.0.0.1');
    const get = (path: string, token: string) => fetch(`${origin}/api/${path}`, {
      headers: { Cookie: `identity_session=${token}` }
    });
    const post = (path: string, body: Record<string, unknown>) => fetch(`${origin}/api/${path}`, {
      method: 'POST', headers: { Cookie: `identity_session=${accounts[0].token}`, Origin: origin,
        'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }, body: JSON.stringify(body)
    });
    // Existing expense is replenished twice; neither purchase creates another expense.
    const purchaseIds: string[] = [];
    for (const receiptReference of ['replenish-alpha-44', 'replenish-beta-44']) {
      const input = { requestId: randomUUID(), purpose: 'failure', upstreamPoints: '1', amount: '0.5000',
        receiptReference, evidence: 'controlled receipt', expenseId };
      const response = await post('procurement/purchases', input);
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.notEqual(result.id, expenseId);
      purchaseIds.push(result.id);
      assert.deepEqual(await (await post('procurement/purchases', input)).json(), result);
      assert.equal((await post('procurement/purchases', { ...input, requestId: randomUUID() })).status, 409);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM platform_expenses')).rows[0].n, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM procurement_ledger')).rows[0].n, 2);
    assert.equal((await pool.query('SELECT balance FROM platform_inventory')).rows[0].balance, '0.0000');
    const salePurchase = await post('procurement/purchases', { requestId: randomUUID(), purpose: 'sale',
      upstreamPoints: '10', amount: '12.5000', receiptReference: 'inventory-sale-44', evidence: 'controlled receipt' });
    assert.equal(salePurchase.status, 201);
    const salePurchaseId = (await salePurchase.json()).id;
    await pool.query(`INSERT INTO procurement_ledger(event,reference,actor_id,expense_delta,balance_after,average_cost_after,details)
      VALUES('expense',$1,$3,0.5000,10,1.2500,'{}'),('expense',$2,$3,0.2500,10,1.2500,'{}')`, [expenseId, secondExpenseId, platformAccount]);
    const terminalResponse = await get('reports', accounts[2].token);
    assert.equal(terminalResponse.status, 200);
    const terminalReport = await terminalResponse.json();
    assert.deepEqual(Object.keys(terminalReport).sort(), ['accounts', 'ledger', 'role']);
    assert.equal(terminalReport.accounts.length, 1);
    assert.deepEqual(Object.keys(terminalReport.accounts[0]).sort(), ['balance', 'queryFrozen']);
    assert.equal(terminalReport.ledger.length, 1);
    assert.equal(terminalReport.ledger[0].amount, '1.0000');
    assert.doesNotMatch(JSON.stringify(terminalReport), /private-terminal-keyword|other-private-keyword/);
    assert.equal((await get('reports/own-ledger.csv', accounts[2].token)).status, 403);
    const outsiderReport = await (await get('reports', accounts[3].token)).json();
    assert.equal(outsiderReport.accounts[0].balance, '20.0000');
    assert.equal(outsiderReport.ledger[0].amount, '2.0000');
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [outsider]);
    const distributorReport = await (await get('reports', accounts[1].token)).json();
    assert.equal(distributorReport.accounts.length, 1);
    assert.equal(distributorReport.organizations.some((row: { id: string }) => row.id === outsider), false);
    assert.equal(distributorReport.sales[0].grossProfit, '1.0000');
    assert.equal(distributorReport.usage[0].chargedPoints, '1.0000');
    assert.equal(distributorReport.customers, undefined);
    assert.doesNotMatch(JSON.stringify(distributorReport), /private-terminal-keyword|other-private-keyword/);
    const csv = await (await get('reports/own-ledger.csv', accounts[1].token)).text();
    assert.match(csv, /sale/);
    assert.doesNotMatch(csv, /loss-1|customer|email/);
    const platformReport = await (await get('reports', accounts[0].token)).json();
    assert.equal(platformReport.organizations.some((row: { id: string }) => row.id === outsider), true);
    assert.equal(platformReport.organizations.find((row: { id: string }) => row.id === outsider).active, false);
    assert.equal(platformReport.transactions.some((row: { sellerId: string; buyerId: string }) =>
      row.sellerId === distributor && row.buyerId === terminal), true);
    assert.equal(platformReport.totals.salesGrossProfit, '1.5000');
    assert.equal(platformReport.totals.platformExpenses, '0.7500');
    assert.equal(platformReport.totals.afterPlatformExpenses, '0.7500');
    assert.equal(platformReport.inventory.balance, '10.0000');
    assert.equal(platformReport.expenses.length, 2);
    assert.equal(platformReport.procurement.length, 5);
    for (const purchaseId of purchaseIds) {
      const row = platformReport.procurement.find((item: { reference: string }) => item.reference === purchaseId);
      assert.equal(row.expenseDelta, '0.0000');
      assert.equal(row.cashOutflow, '0.5000');
      assert.notEqual(String(row.id), row.reference);
    }
    assert.equal(platformReport.procurement.find((row: { reference: string }) => row.reference === expenseId).expenseDelta, '0.5000');
    assert.equal(platformReport.procurement.find((row: { reference: string }) => row.reference === salePurchaseId).internalDelta, '10.0000');
    const platformCsv = await (await get('reports/own-ledger.csv', accounts[0].token)).text();
    assert.match(platformCsv, /platform-receipt|transferred/);
    assert.doesNotMatch(platformCsv, /loss-1|receipt|customer|email/);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'identity_session', value: accounts[2].token,
        url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole('heading', { name: '用量与账务' }).waitFor();
      await page.getByText('10.0000').first().waitFor();
      assert.equal(await page.getByText('平台承担费用').count(), 0);
      await context.close();
      const distributorContext = await browser.newContext();
      await distributorContext.addCookies([{ name: 'identity_session', value: accounts[1].token,
        url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const distributorPage = await distributorContext.newPage();
      await distributorPage.goto(origin);
      await distributorPage.getByRole('link', { name: '导出自有账务' }).waitFor();
      await distributorPage.getByText('自有交易毛利：1.0000').waitFor();
      await distributorContext.close();
      const platformContext = await browser.newContext({ acceptDownloads: true });
      await platformContext.addCookies([{ name: 'identity_session', value: accounts[0].token,
        url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const platformPage = await platformContext.newPage();
      const reportRequests: { path: string; method: string; query: string }[] = [];
      platformPage.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) reportRequests.push({ path: url.pathname, method: request.method(), query: url.search });
      });
      // First visit the remaining platform compatibility workspace, then navigate
      // through RouterLinks: the retired report must not survive in a hidden instance.
      await platformPage.goto(`${origin}/platform/overview`);
      await expect(platformPage.locator('.workspace')).toHaveCount(1);
      await expect(platformPage.locator('.usage-reports')).toHaveCount(0);
      const reportReadsBefore = reportRequests.filter(request => request.path === '/api/reports').length;
      await platformPage.getByRole('button', { name: '点数与账务', exact: true }).click();
      await platformPage.getByRole('link', { name: '交易与利润', exact: true }).click();
      await platformPage.getByText('平台销售毛利：1.5000').waitFor();
      assert.equal(reportRequests.filter(request => request.path === '/api/reports').length, reportReadsBefore + 1);
      await expect(platformPage.locator('.usage-reports')).toHaveCount(0);
      await expect(platformPage.locator('.sidebar-link[aria-current="page"]')).toHaveText('交易与利润');
      await expect(platformPage.locator('.console-breadcrumb [aria-current="page"]')).toHaveText('交易与利润');
      await expect(platformPage.locator('.platform-report h1')).toHaveCount(0);
      await platformPage.goto(`${origin}/platform/ledger/profit`);
      await platformPage.getByText('平台销售毛利：1.5000').waitFor();
      await platformPage.reload();
      await platformPage.getByText('扣除平台承担费用后：0.7500').waitFor();
      await expect(platformPage.locator('.platform-report')).toHaveCount(1);
      await expect(platformPage.locator('.platform-report')).toContainText(orderId);
      await expect(platformPage.locator('.platform-report')).toContainText(platformOrderId);
      await expect(platformPage.locator('.platform-report')).toContainText(expenseId);
      assert.doesNotMatch(await platformPage.locator('.platform-report').innerText(), /净利润|客户档案|邮件正文|private-terminal/);
      const downloadReady = platformPage.waitForEvent('download');
      await platformPage.getByRole('link', { name: '导出自有账务', exact: true }).click();
      const download = await downloadReady;
      assert.equal(download.suggestedFilename(), 'own-ledger.csv');
      await mkdir(resolve('.scratch/issue44-results'), { recursive: true });
      const downloadPath = resolve('.scratch/issue44-results/own-ledger.csv');
      await download.saveAs(downloadPath);
      const downloaded = await readFile(downloadPath, 'utf8');
      // fetch.text strips the UTF-8 BOM; the downloaded file preserves it.
      assert.equal(downloaded, `\uFEFF${platformCsv}`);
      const parseCsv = (value: string) => value.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
        .map(line => line.slice(1, -1).split('","').map(cell => cell.replaceAll('""', '"')));
      const expectedRows = [['type','reference','event','amount','balance_or_cost','frozen_or_gross','created_at']];
      // Explicit DB columns, independent of report/CSV implementation.
      const procurementRows = (await pool.query('SELECT * FROM procurement_ledger ORDER BY created_at,id')).rows;
      for (const row of procurementRows) expectedRows.push(['procurement', row.reference, row.event,
        row.cash_outflow, row.balance_after, row.expense_delta, String(row.created_at)]);
      const ownSales = (await pool.query('SELECT * FROM point_transfers WHERE seller_id=$1 ORDER BY created_at,order_id', [platform])).rows;
      for (const row of ownSales) expectedRows.push(['sale', row.order_id, 'transferred', row.sales_amount,
        row.sales_cost, row.gross_profit, String(row.created_at)]);
      assert.deepEqual(parseCsv(downloaded), expectedRows);
      assert.equal(expectedRows.length, 7);
      assert.doesNotMatch(downloaded, new RegExp(`${orderId}|loss-1|replenish-alpha-44|private-terminal`));
      await platformPage.goto(`${origin}/platform/ledger/flows`);
      await platformPage.getByText('平台库存与采购流水').waitFor();
      await platformPage.reload();
      await expect(platformPage.locator('.sidebar-link[aria-current="page"]')).toHaveText('账务流水');
      await expect(platformPage.locator('.console-breadcrumb [aria-current="page"]')).toHaveText('账务流水');
      for (const row of platformReport.procurement) {
        const rendered = platformPage.locator('.platform-report tbody tr').filter({ has: platformPage.locator('td', { hasText: row.reference }) });
        await expect(rendered).toHaveCount(1);
        assert.deepEqual(await rendered.locator('td').allTextContents(), [String(row.id), row.reference, row.event,
          row.internalDelta, row.upstreamDelta, row.cashOutflow, row.expenseDelta, row.balanceAfter]);
      }
      for (const row of platformReport.ledger) {
        const rendered = platformPage.locator('.platform-report tbody tr').filter({ has: platformPage.locator('td', { hasText: row.referenceId }) });
        await expect(rendered).toContainText(String(row.id));
        await expect(rendered).toContainText(row.amount);
      }
      const flowsDownloadReady = platformPage.waitForEvent('download');
      await platformPage.getByRole('link', { name: '导出自有账务', exact: true }).click();
      const flowsDownload = await flowsDownloadReady;
      await flowsDownload.saveAs(resolve('.scratch/issue44-results/flows-own-ledger.csv'));
      assert.equal(await readFile(resolve('.scratch/issue44-results/flows-own-ledger.csv'), 'utf8'), downloaded);
      const before = (await pool.query('SELECT count(*)::int AS n FROM procurement_ledger')).rows[0].n;
      await platformPage.getByRole('button', { name: '刷新', exact: true }).click();
      await platformPage.getByText('库存 10.0000', { exact: false }).waitFor();
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM procurement_ledger')).rows[0].n, before);
      await platformPage.getByRole('link', { name: '交易与利润', exact: true }).click();
      await expect(platformPage).toHaveURL(`${origin}/platform/ledger/profit`);
      await platformPage.getByText('平台销售毛利：1.5000').waitFor();
      await platformPage.goBack();
      await platformPage.getByText('平台库存与采购流水').waitFor();
      await platformPage.goForward();
      await platformPage.getByText('平台销售毛利：1.5000').waitFor();
      const readsBeforeSettings = reportRequests.filter(request => request.path === '/api/reports').length;
      await platformPage.getByRole('button', { name: /的账号菜单$/ }).click();
      await platformPage.getByRole('menuitem', { name: '账号设置', exact: true }).click();
      await platformPage.getByRole('button', { name: '返回工作台', exact: true }).click();
      await expect(platformPage).toHaveURL(`${origin}/platform/ledger/profit`);
      await platformPage.getByText('平台销售毛利：1.5000').waitFor();
      assert.equal(reportRequests.filter(request => request.path === '/api/reports').length, readsBeforeSettings + 1);
      await expect(platformPage.locator('.usage-reports')).toHaveCount(0);
      assert.equal(reportRequests.some(request => request.method !== 'GET'), false);
      assert.equal(reportRequests.filter(request => request.path === '/api/reports').every(request => request.query === ''), true);
      await writeFile(resolve('.scratch/issue44-results/evidence.json'), JSON.stringify({
        database: name, origin, platform, distributor, terminal, platformAccount, orderId, platformOrderId,
        expenseId, secondExpenseId, purchaseIds, salePurchaseId, totals: platformReport.totals,
        inventory: platformReport.inventory, procurement: platformReport.procurement,
        ledger: platformReport.ledger, csvRows: expectedRows, reportRequests
      }, null, 2));
      await platformContext.close();
      const vite = await createServer({ server: { host: '127.0.0.1', port: 3444, strictPort: true,
        proxy: { '/api': origin } } });
      const devChecks: { path: string; status: number }[] = [];
      try {
        await vite.listen();
        const devOrigin = 'http://127.0.0.1:3444';
        const devContext = await browser.newContext();
        await devContext.addCookies([{ name: 'identity_session', value: accounts[0].token, url: devOrigin }]);
        const devPage = await devContext.newPage();
        for (const [path, text] of [['/platform/ledger/profit', '平台销售毛利：1.5000'],
          ['/platform/ledger/flows', '平台库存与采购流水']]) {
          const response = await devPage.goto(`${devOrigin}${path}`);
          assert.equal(response?.status(), 200);
          await devPage.getByText(text, { exact: false }).waitFor();
          await devPage.reload();
          await devPage.getByText(text, { exact: false }).waitFor();
          await expect(devPage.locator('.platform-report')).toHaveCount(1);
          await expect(devPage.locator('.usage-reports')).toHaveCount(0);
          devChecks.push({ path, status: 200 });
        }
        for (const path of ['/api/unknown-issue44', '/assets/missing-issue44.js', '/unknown-issue44']) {
          const response = await fetch(`${devOrigin}${path}`);
          assert.equal(response.status, 404);
          devChecks.push({ path, status: response.status });
        }
        await devContext.close();
      } finally {
        await vite.close();
      }
      for (const account of [accounts[1], accounts[2], accounts[4]]) {
        const unauthorizedContext = await browser.newContext();
        await unauthorizedContext.addCookies([{ name: 'identity_session', value: account.token,
          url: origin, httpOnly: true, sameSite: 'Strict' }]);
        const unauthorizedPage = await unauthorizedContext.newPage();
        for (const path of ['/platform/ledger/profit', '/platform/ledger/flows']) {
          await unauthorizedPage.goto(`${origin}${path}`);
          await unauthorizedPage.waitForURL(`${origin}${account.role === 'distributor' ? '/distribution/organizations' : '/terminal/search'}`);
          await expect(unauthorizedPage.locator('.platform-report')).toHaveCount(0);
        }
        const report = await (await get('reports', account.token)).json();
        assert.equal(report.totals, undefined);
        assert.equal(report.procurement, undefined);
        assert.equal(report.expenses, undefined);
        assert.equal((await get('reports/own-ledger.csv', account.token)).status, account.role === 'distributor' ? 200 : 403);
        await unauthorizedContext.close();
      }
      assert.equal((await get('reports', '')).status, 401);
      assert.equal((await get('reports/own-ledger.csv', '')).status, 401);
      assert.equal((await fetch(`${origin}/api/unknown-issue44`)).status, 404);
      assert.equal((await fetch(`${origin}/assets/missing-issue44.js`)).status, 404);
      assert.equal((await fetch(`${origin}/unknown-issue44`)).status, 404);
      for (const path of ['/platform/ledger/profit', '/platform/ledger/flows']) {
        const response = await fetch(`${origin}${path}`, { method: 'HEAD' });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      }
      // Reuse one browser context for real login/logout and role changes.
      const switching = await browser.newContext();
      const switchPage = await switching.newPage();
      const login = async (account: typeof accounts[number], pwd = password) => {
        await switchPage.getByLabel('登录账号', { exact: true }).fill(account.role === 'platform' ? 'super_admin' : `${account.id}@test.invalid`);
        await switchPage.getByLabel('密码', { exact: true }).fill(pwd);
        await switchPage.getByRole('button', { name: '登录', exact: true }).click();
      };
      await switchPage.goto(origin);
      for (const account of [accounts[0], accounts[1], accounts[2], accounts[4], accounts[0]]) {
        await login(account);
        await switchPage.waitForURL(`${origin}${account.role === 'platform' ? '/platform/overview' : account.role === 'distributor' ? '/distribution/organizations' : '/terminal/search'}`);
        if (account.role === 'platform') {
          await switchPage.goto(`${origin}/platform/ledger/profit`);
          await switchPage.getByText('平台销售毛利：1.5000').waitFor();
        } else {
          await expect(switchPage.locator('.platform-report')).toHaveCount(0);
          await expect(switchPage.getByRole('link', { name: '账务流水', exact: true })).toHaveCount(0);
        }
        await switchPage.getByRole('button', { name: /的账号菜单$/ }).click();
        await switchPage.getByRole('menuitem', { name: '退出登录', exact: true }).click();
        await switchPage.getByRole('button', { name: '登录', exact: true }).waitFor();
        await expect(switchPage.locator('.platform-report')).toHaveCount(0);
      }
      // Force change on the platform account so the protected endpoint would otherwise be allowed.
      await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '72 hours' WHERE id=$1", [platformAccount]);
      await login(accounts[0]);
      await switchPage.getByRole('heading', { name: '设置新密码' }).waitFor();
      const token = (await switching.cookies()).find(cookie => cookie.name === 'identity_session')!.value;
      for (const path of ['/platform/ledger/profit', '/platform/ledger/flows', '/help', '/account/settings']) {
        await switchPage.goto(`${origin}${path}`);
        await switchPage.getByRole('heading', { name: '设置新密码' }).waitFor();
        await expect(switchPage.locator('.platform-report')).toHaveCount(0);
      }
      assert.equal((await get('reports', token)).status, 403);
      assert.equal((await get('reports/own-ledger.csv', token)).status, 403);
      await switchPage.getByLabel('当前密码', { exact: true }).fill(password);
      await switchPage.getByLabel('新密码', { exact: true }).fill('Issue44ChangedPwd!');
      await switchPage.getByLabel('确认新密码', { exact: true }).fill('Issue44ChangedPwd!');
      await switchPage.getByRole('button', { name: '确认修改并重新登录' }).click();
      await switchPage.getByRole('button', { name: '登录', exact: true }).waitFor();
      assert.equal((await get('reports', token)).status, 401);
      await login(accounts[0], 'Issue44ChangedPwd!');
      await switchPage.waitForURL(`${origin}/platform/overview`);
      await switchPage.goto(`${origin}/platform/ledger/profit`);
      await switchPage.getByText('平台销售毛利：1.5000').waitFor();
      await switching.close();
      const evidencePath = resolve('.scratch/issue44-results/evidence.json');
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
      evidence.devChecks = devChecks;
      evidence.completed = ['CSV download from both pages: seven columns match DB',
        'profit and flows: direct access, refresh, back/forward', 'distributor/admin/sales page denial and scoped HTTP',
        'platform/distributor/admin/sales/platform login/logout', 'must-change gate, password change and old-session revocation'];
      evidence.accountingAfter = (await pool.query(`SELECT
        (SELECT sum(gross_profit) FROM point_transfers WHERE seller_id=$1)::numeric(20,4) AS "salesGrossProfit",
        (SELECT sum(amount) FROM platform_expenses)::numeric(20,4) AS "platformExpenses",
        ((SELECT sum(gross_profit) FROM point_transfers WHERE seller_id=$1)-(SELECT sum(amount) FROM platform_expenses))::numeric(20,4) AS "afterPlatformExpenses"`, [platform])).rows[0];
      assert.deepEqual(evidence.accountingAfter, platformReport.totals);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM procurement_ledger')).rows[0].n, 5);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM point_purchases')).rows[0].n, 3);
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    if (app) await app.close();
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    if (priorKey === undefined) delete process.env.ORG_CONTACT_KEY;
    else process.env.ORG_CONTACT_KEY = priorKey;
    if (priorSmtpKey === undefined) delete process.env.SMTP_CREDENTIAL_KEY;
    else process.env.SMTP_CREDENTIAL_KEY = priorSmtpKey;
  }
});
