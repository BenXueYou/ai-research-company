import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';

test('Issue59 terminal usage scopes real three-source ledger and remains read-only across navigation and sessions', async ({ page }) => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const source = new URL(base);
  source.pathname = '/postgres';
  const admin = database(source.toString());
  const name = `issue59_${randomUUID().replaceAll('-', '')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  source.pathname = `/${name}`;
  const pool = database(source.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:3459';
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  let devApp: Awaited<ReturnType<typeof createApplication>> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const supplierCalls: string[] = [];
  const unexpected = async () => { supplierCalls.push('unexpected'); throw new Error('Unexpected supplier call'); };
  const vendor = { listCompanies: unexpected, detail: unexpected, contacts: unexpected };
  const password = 'Issue59-fixture-password!';
  const ids: Record<string, string[]> = {};
  try {
    await migrate(pool);
    const hash = await hashPassword(password);
    await pool.query('UPDATE accounts SET password_hash=$1,must_change=false', [hash]);
    const platform = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    const terminal = randomUUID(); const outsider = randomUUID(); const distributor = randomUUID();
    for (const [id, kind] of [[terminal, 'terminal'], [outsider, 'terminal'], [distributor, 'distributor']]) {
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,$3,$4,$5,'fixture',$6,'***')`, [id, `usage-${id}`, kind, platform.organization_id, kind === 'distributor' ? 1 : 0, randomUUID()]);
    }
    const actors = [
      { id: randomUUID(), org: terminal, role: 'admin', email: 'admin@issue59.test' },
      { id: randomUUID(), org: terminal, role: 'sales', email: 'sales@issue59.test' },
      { id: randomUUID(), org: outsider, role: 'admin', email: 'other@issue59.test' },
      { id: randomUUID(), org: distributor, role: 'distributor', email: 'distributor@issue59.test' }
    ];
    for (const actor of actors) await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,$5,false)`, [actor.id, actor.org, actor.email, hash, actor.role]);
    for (const actor of [actors[0], actors[2]]) {
      const search = randomUUID(); const candidate = randomUUID(); const detail = randomUUID();
      const profile = randomUUID(); const contact = randomUUID(); const product = randomUUID();
      ids[actor.org] = [search, candidate, detail, profile, contact, product];
      await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
        VALUES($1,$2,$3,'usage fixture','USA',1,20,1,'verified')`, [search, actor.org, actor.id]);
      await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country)
        VALUES($1,$2,$3,$4,'fixture','USA')`, [candidate, search, actor.org, `source-${actor.org}`]);
      await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'fixture','USA',2,10,$5,'settled')`, [detail, actor.org, actor.id, candidate, randomUUID()]);
      await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
        VALUES($1,$2,$3,'fixture','USA','{}',$4)`, [profile, actor.org, `vendor-${actor.org}`, detail]);
      await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,$4,'fixture',ARRAY['buyer'],1,20,2,8,$5,'pending')`, [contact, actor.org, actor.id, profile, randomUUID()]);
      await pool.query(`INSERT INTO product_search_pages(id,organization_id,actor_id,product_desc,buyer_country_code3,start_date,end_date,page_no,page_size,coefficient,maximum_points,price_version,state)
        VALUES($1,$2,$3,'fixture','USA','2026-01-01','2026-02-01',1,20,2,6,$4,'zero')`, [product, actor.org, actor.id, randomUUID()]);
      // Detail settles 4 from a 10-point hold; contact retains 8; zero-result product releases 6.
      for (const [table, field, ref, rows] of [
        ['query_point_ledger', 'query_id', detail, [['freeze', 10, 100, 10], ['settle', 4, 96, 0]]],
        ['company_contact_point_ledger', 'query_id', contact, [['freeze', 8, 96, 8]]],
        ['product_search_ledger', 'page_id', product, [['freeze', 6, 96, 14], ['release', 6, 96, 8]]]
      ] as const) {
        for (const [event, amount, balance, frozen] of rows) await pool.query(`INSERT INTO ${table}(${field},organization_id,actor_id,event,amount,balance_after,frozen_after)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [ref, actor.org, actor.id, event, amount, balance + (actor.org === terminal ? 0 : 200), frozen]);
      }
      await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen) VALUES($1,$2,8)', [actor.org, actor.org === terminal ? 96 : 296]);
    }
    const distinct = [terminal, outsider, distributor, platform.id, platform.organization_id, ...actors.map(x => x.id), ...Object.values(ids).flat()];
    expect(new Set(distinct).size).toBe(distinct.length);
    app = await createApplication(pool, origin, false, undefined, vendor, undefined, vendor, undefined, vendor,
      { buyerCountryFilterVerified: true, importerNames: unexpected }, undefined, undefined, resolve('.scratch/issue59/web'));
    await app.listen(3459, '127.0.0.1');
    expect((await page.request.get(`${origin}/api/reports`)).status()).toBe(401);
    const login = async (email: string, root = origin) => {
      await page.goto(`${root}/terminal/usage`);
      await page.getByLabel('登录账号', { exact: true }).fill(email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: `${email} 的账号菜单`, exact: true })).toBeVisible();
    };
    const logout = async (email: string) => {
      await page.getByRole('button', { name: `${email} 的账号菜单`, exact: true }).click();
      await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    };
    const usage = page.getByRole('region', { name: '本企业点数用量' });
    await login(actors[0].email);
    await page.goto(`${origin}/terminal/usage`);
    await expect(usage.getByText('余额：96.0000 点', { exact: true })).toBeVisible();
    await expect(usage.getByText('查询冻结：8.0000 点', { exact: true })).toBeVisible();
    await expect(usage.locator('tbody tr')).toHaveCount(5);
    const report = await (await page.request.get(`${origin}/api/reports`)).json();
    expect(Object.keys(report).sort()).toEqual(['accounts', 'ledger', 'role']);
    const expectedLedger = (await pool.query(`SELECT 'detail' AS source,id::text,query_id AS "referenceId",event,amount,balance_after AS "balanceAfter",frozen_after AS "frozenAfter"
      FROM query_point_ledger WHERE organization_id=$1 UNION ALL SELECT 'contact',id::text,query_id,event,amount,balance_after,frozen_after
      FROM company_contact_point_ledger WHERE organization_id=$1 UNION ALL SELECT 'product',id::text,page_id,event,amount,balance_after,frozen_after
      FROM product_search_ledger WHERE organization_id=$1`, [terminal])).rows;
    for (const row of expectedLedger) {
      const shown = usage.locator('tbody tr').filter({ has: page.getByRole('cell', { name: row.referenceId, exact: true }) }).filter({ has: page.getByRole('cell', { name: row.event, exact: true }) });
      await expect(shown).toHaveCount(1);
      for (const value of [row.source, row.id, row.amount, row.balanceAfter, row.frozenAfter]) await expect(shown.getByRole('cell', { name: value, exact: true }).first()).toBeVisible();
      expect(report.ledger).toContainEqual(expect.objectContaining(row));
    }
    await expect(usage).not.toContainText(outsider);
    await expect(usage).not.toContainText('销售预留');
    await expect(usage.getByRole('link')).toHaveCount(0);
    await page.screenshot({ path: resolve('.scratch/issue59/usage-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(usage.getByText('余额：96.0000 点', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve('.scratch/issue59/usage-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    expect((await page.request.get(`${origin}/api/reports/own-ledger.csv`)).status()).toBe(403);
    // Existing API ignores client scope selectors; the returned scope stays with the session.
    const forged = await (await page.request.get(`${origin}/api/reports?organizationId=${outsider}`)).json();
    expect(forged).toEqual(report);
    expect(JSON.stringify(forged)).not.toContain(ids[outsider][2]);
    const tables = ['internal_point_accounts', 'query_point_ledger', 'company_contact_point_ledger', 'product_search_ledger',
      'company_detail_queries', 'company_contact_queries', 'product_search_pages', 'platform_inventory', 'point_orders', 'procurement_ledger'];
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of tables) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
      return JSON.stringify(result);
    };
    const before = await snapshot();
    const reads: string[] = []; const writes: string[] = []; const readPosts: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return;
      if (request.method() === 'GET') reads.push(url.pathname + url.search);
      else if (url.pathname === '/api/company-profiles/list') readPosts.push(url.pathname);
      else if (!url.pathname.startsWith('/api/auth/')) writes.push(url.pathname);
    });
    await page.reload(); await expect(usage.locator('tbody tr')).toHaveCount(5);
    await expect(page.locator('.console-breadcrumb')).toContainText('点数用量');
    await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '点数用量', exact: true })).toHaveAttribute('aria-current', 'page');
    await usage.getByRole('button', { name: '刷新用量' }).click(); await expect(usage.locator('tbody tr')).toHaveCount(5);
    await page.getByRole('button', { name: `${actors[0].email} 的账号菜单`, exact: true }).click();
    await page.getByRole('menuitem', { name: '账号设置', exact: true }).click();
    await expect(usage).toHaveCount(0);
    const count = reads.filter(x => x === '/api/reports').length;
    await page.goBack(); await expect(usage.locator('tbody tr')).toHaveCount(5);
    expect(reads.filter(x => x === '/api/reports').length).toBe(count + 1);
    await page.goForward(); await expect(usage).toHaveCount(0);
    await page.goBack(); await expect(usage.locator('tbody tr')).toHaveCount(5);
    expect(await snapshot()).toBe(before);
    // Real backend failure, followed by recovery, with no synthetic API response.
    await pool.query('ALTER TABLE internal_point_accounts RENAME TO issue59_unavailable_accounts');
    await usage.getByRole('button', { name: '刷新用量' }).click();
    await expect(usage.getByRole('alert')).toBeVisible(); await expect(usage.locator('tbody tr')).toHaveCount(0);
    await expect(usage).not.toContainText('余额：0');
    await pool.query('ALTER TABLE issue59_unavailable_accounts RENAME TO internal_point_accounts');
    await usage.getByRole('button', { name: '刷新用量' }).click(); await expect(usage.locator('tbody tr')).toHaveCount(5);
    await pool.query('DELETE FROM internal_point_accounts WHERE organization_id=$1', [terminal]);
    await usage.getByRole('button', { name: '刷新用量' }).click();
    await expect(usage.getByText('暂无账户余额数据，请稍后刷新核实。')).toBeVisible();
    await expect(usage).not.toContainText('余额：0');
    await pool.query('INSERT INTO internal_point_accounts(organization_id,balance,query_frozen) VALUES($1,96,8)', [terminal]);
    await logout(actors[0].email);
    await login(actors[1].email); await page.goto(`${origin}/terminal/usage`);
    await expect(usage.getByText('余额：96.0000 点', { exact: true })).toBeVisible();
    expect(await (await page.request.get(`${origin}/api/reports`)).json()).toEqual(report);
    expect((await page.request.get(`${origin}/api/reports/own-ledger.csv`)).status()).toBe(403);
    // Delay the real response across logout/account change; late data cannot repopulate the new view.
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/reports', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); }, { times: 1 });
    await usage.getByRole('button', { name: '刷新用量' }).click();
    await expect(usage.getByRole('status')).toContainText('正在读取用量');
    await logout(actors[1].email); await login(actors[2].email);
    release(); await page.goto(`${origin}/terminal/usage`);
    await expect(usage.getByText('余额：296.0000 点', { exact: true })).toBeVisible();
    await expect(usage).not.toContainText(ids[terminal][2]);
    await pool.query('UPDATE organizations SET active=false WHERE id=$1', [outsider]);
    expect((await page.request.get(`${origin}/api/reports`)).status()).toBe(401);
    await pool.query('UPDATE organizations SET active=true WHERE id=$1', [outsider]);
    await logout(actors[2].email);
    for (const [email, path] of [['super_admin', '/platform/overview'], [actors[3].email, '/distribution/organizations']]) {
      await login(email); await page.goto(`${origin}/terminal/usage`);
      await expect(page).toHaveURL(`${origin}${path}`); await expect(usage).toHaveCount(0);
      await logout(email);
    }
    await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [actors[0].id]);
    await login(actors[0].email);
    await expect(page.getByRole('heading', { name: '先保护好您的账号' })).toBeVisible();
    expect((await page.request.get(`${origin}/api/reports`)).status()).toBe(403);
    await expect(usage).toHaveCount(0);
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill('Issue59-changed-password!');
    await page.getByLabel('确认新密码', { exact: true }).fill('Issue59-changed-password!');
    await page.getByRole('button', { name: '确认修改并重新登录' }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    expect((await page.request.get(`${origin}/api/reports`)).status()).toBe(401);
    devApp = await createApplication(pool, 'http://127.0.0.1:3460', false, undefined, vendor, undefined, vendor, undefined, vendor,
      { buyerCountryFilterVerified: true, importerNames: unexpected }, undefined, undefined, resolve('.scratch/issue59/web'));
    await devApp.listen(3461, '127.0.0.1');
    vite = await createServer({ server: { host: '127.0.0.1', port: 3460, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3461' } } });
    await vite.listen();
    await login(actors[1].email, 'http://127.0.0.1:3460');
    await page.goto('http://127.0.0.1:3460/terminal/usage'); await expect(usage.locator('tbody tr')).toHaveCount(5);
    await page.reload(); await expect(usage.locator('tbody tr')).toHaveCount(5);
    for (const root of [origin, 'http://127.0.0.1:3460']) {
      expect((await page.request.get(`${root}/api/issue59-unknown`)).headers()['content-type']).not.toContain('text/html');
      expect((await page.request.get(`${root}/issue59-missing.js`)).status()).toBe(404);
    }
    expect(writes).toEqual([]); expect(supplierCalls).toEqual([]); expect(await snapshot()).toBe(before);
    await writeFile(resolve('../docs/delivery/application/ISSUE-59-EVIDENCE.json'), JSON.stringify({
      database: name, sources: expectedLedger, roles: ['admin', 'sales', 'other admin', 'platform', 'distributor'],
      request: 'GET /api/reports without body/query; organization from session',
      identifiers: ids, balances: { own: '96.0000', other: '296.0000', frozen: '8.0000' },
      navigationWrites: writes, otherPageReadPosts: readPosts, supplierCalls, unchangedBusinessTables: tables,
      missingAccountAndDatabaseFailure: true, lateSessionResponse: true, nestAndViteHistory: true,
      forcedPasswordChange: true, crossTenantSelectorIgnored: true, csvDenied: true
    }, null, 2));
  } finally {
    await vite?.close(); await devApp?.close(); await app?.close(); await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
});
