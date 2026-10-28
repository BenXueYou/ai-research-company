import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { createApplication } from './app.js';
import { migrate } from './database.js';
import { digest } from './identity/identity.js';

test('T28 scoped reporting through HTTP and PostgreSQL', async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required');
  const name = `t28_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  const dbUrl = new URL(source);
  dbUrl.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: dbUrl.toString() });
  const origin = 'http://127.0.0.1:3188';
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
      { id: randomUUID(), org: outsider, role: 'admin', token: 't28-outsider' }
    ];
    for (const account of accounts) {
      if (account.role !== 'platform') await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,'hash',$4,false)`, [account.id, account.org, `${account.id}@test.invalid`, account.role]);
      else await pool.query('UPDATE accounts SET must_change=false WHERE id=$1', [account.id]);
      await pool.query('INSERT INTO sessions(token_hash,account_id,csrf_hash) VALUES($1,$2,$3)',
        [digest(account.token), account.id, digest('csrf')]);
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
    await pool.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id)
      VALUES($1,'failure','loss-1',0.5000,'bill',$2)`, [expenseId, platformAccount]);
    await pool.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id)
      VALUES($1,'excess','loss-2',0.2500,'bill',$2)`, [randomUUID(), platformAccount]);
    await pool.query(`INSERT INTO point_purchases(id,purpose,upstream_points,coefficient_snapshot,generated_internal_points,
      amount,receipt_reference,evidence,expense_id,actor_id)
      VALUES($1,'failure',1,1,0,0.5000,'topup-1','receipt',$2,$3)`, [randomUUID(), expenseId, platformAccount]);
    await assert.rejects(pool.query(`INSERT INTO platform_expenses(id,purpose,source_reference,amount,evidence,actor_id)
      VALUES($1,'failure','loss-1',0.5000,'duplicate',$2)`, [randomUUID(), platformAccount]),
    { code: '23505' });
    app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, resolve('.scratch/t28-web'));
    await app.listen(3188, '127.0.0.1');
    const get = (path: string, token: string) => fetch(`${origin}/api/${path}`, {
      headers: { Cookie: `identity_session=${token}` }
    });
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
      const platformContext = await browser.newContext();
      await platformContext.addCookies([{ name: 'identity_session', value: accounts[0].token,
        url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const platformPage = await platformContext.newPage();
      await platformPage.goto(origin);
      await platformPage.getByText('平台承担费用：0.7500').waitFor();
      await platformPage.getByText('扣除平台承担费用后：0.7500').waitFor();
      await platformPage.getByText(`${outsider} · terminal · 停用`).waitFor();
      await platformPage.goto(`${origin}/platform/ledger/profit`);
      console.log('profit page', await platformPage.url(), (await platformPage.locator('body').innerText()).slice(0, 500));
      await platformPage.getByRole('heading', { name: '交易与利润' }).waitFor();
      await platformPage.getByText('平台销售毛利：1.5000').waitFor();
      await platformPage.goto(`${origin}/platform/ledger/flows`);
      await platformPage.getByRole('heading', { name: '账务流水' }).waitFor();
      await platformPage.getByText('平台库存与采购流水').waitFor();
      await platformContext.close();
      const unauthorizedContext = await browser.newContext();
      await unauthorizedContext.addCookies([{ name: 'identity_session', value: accounts[2].token,
        url: origin, httpOnly: true, sameSite: 'Strict' }]);
      const unauthorizedPage = await unauthorizedContext.newPage();
      await unauthorizedPage.goto(`${origin}/platform/ledger/profit`);
      await unauthorizedPage.waitForURL(`${origin}/terminal/search`);
      await unauthorizedContext.close();
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

