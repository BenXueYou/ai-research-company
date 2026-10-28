import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { resolve } from 'node:path';
import { hashPassword } from '../server/identity/policy.js';
import { writeFile } from 'node:fs/promises';

test('T07/T08 browser selects the exact direct buyer, reserves and transfers once', async ({ page }) => {
  page.on('pageerror', failure => console.error('Browser error:', failure.message));
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('需要专用测试数据库地址');
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = database(adminUrl.toString());
  const name = `issue40_${randomUUID().replaceAll('-','')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const testUrl = new URL(base);
  testUrl.pathname = `/${name}`;
  const pool = database(testUrl.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    await migrate(pool);
    const platformId = (await pool.query("SELECT organization_id FROM accounts WHERE username='super_admin'")).rows[0].organization_id;
    const selectedId = randomUUID();
    const otherId = randomUUID();
    for (const [id,name] of [[selectedId,'甲买方'],[otherId,'乙买方']]) {
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,'distributor',$3,1,'fixture',$4,'***')`, [id,name,platformId,randomUUID()]);
    }
    const terminalId = randomUUID();
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'角色终端','terminal',$2,'fixture',$3,'***')`, [terminalId,platformId,randomUUID()]);
    const rolePassword = 'Issue40-role-password';
    const roleHash = await hashPassword(rolePassword);
    const roles = [
      { role: 'distributor', organizationId: selectedId, id: randomUUID(), email: 'distributor@issue40.test', defaultPath: '/distribution/organizations' },
      { role: 'admin', organizationId: terminalId, id: randomUUID(), email: 'admin@issue40.test', defaultPath: '/terminal/search' },
      { role: 'sales', organizationId: terminalId, id: randomUUID(), email: 'sales@issue40.test', defaultPath: '/terminal/search' }
    ];
    for (const role of roles) {
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,$3,$4,$5,false)`, [role.id,role.organizationId,role.email,roleHash,role.role]);
    }
    await pool.query('UPDATE platform_pricing SET minimum_markup=0.1');
    await pool.query('UPDATE platform_inventory SET balance=10,average_cost=2');
    app = await createApplication(pool,'http://127.0.0.1:3140', false,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      resolve('.scratch/issue40/web'));
    await app.listen(3140,'127.0.0.1');
    const submissions: Record<string,string>[] = [];
    const transfers: Record<string,string>[] = [];
    const reprices: Record<string,string>[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/point-orders') && request.method()==='POST')
        submissions.push(request.postDataJSON());
      if (request.url().endsWith('/api/point-orders/transfer') && request.method()==='POST')
        transfers.push(request.postDataJSON());
      if (request.url().endsWith('/api/point-orders/reprice') && request.method()==='POST')
        reprices.push(request.postDataJSON());
    });
    await page.goto('/');
    await page.getByLabel('登录账号',{exact:true}).fill('super_admin');
    await page.getByLabel('密码',{exact:true}).fill('init@Base123');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.getByLabel('当前密码',{exact:true}).fill('init@Base123');
    await page.getByLabel('新密码',{exact:true}).fill('T07-browser-password');
    await page.getByLabel('确认新密码',{exact:true}).fill('T07-browser-password');
    await page.getByRole('button',{name:'确认修改并重新登录'}).click();
    await page.getByLabel('登录账号',{exact:true}).fill('super_admin');
    await page.getByLabel('密码',{exact:true}).fill('T07-browser-password');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await expect(page).toHaveURL(/\/platform\/overview$/);
    await page.goto('/platform/ledger');
    await expect(page.getByRole('heading',{name:'直属点数订单'})).toBeVisible();
    await expect(page.locator('#compat-organizations')).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading',{name:'直属点数订单'})).toBeVisible();
    const reads: string[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/point-orders') && request.method() === 'GET') reads.push(request.url());
    });
    await page.getByLabel('直属买方').selectOption(selectedId);
    await page.getByLabel('点数数量',{exact:true}).fill('2');
    await page.getByLabel('每点售价（人民币）').fill('2.2');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link',{name:'帮助中心'}).click();
    await expect(page).toHaveURL(/\/platform\/ledger$/);
    await expect(page.getByLabel('直属买方')).toHaveValue(selectedId);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link',{name:'帮助中心'}).click();
    await expect(page).toHaveURL(/\/help$/);
    await page.goBack();
    await expect(page.getByLabel('点数数量',{exact:true})).toHaveValue('');
    await expect(page.getByLabel('直属买方')).toHaveValue('');
    expect(reads).toHaveLength(0);
    await page.getByLabel('直属买方').selectOption(selectedId);
    await page.getByLabel('点数数量',{exact:true}).fill('2');
    await page.getByLabel('每点售价（人民币）').fill('2.2');
    await page.getByRole('button',{name:'建单'}).click();
    await expect(page.getByText('数量 2.0000 × 单价 2.2000 = 4.4000 元')).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({buyerId:selectedId,quantity:'2',unitPrice:'2.2'});
    expect(submissions[0].buyerId).not.toBe(otherId);
    const stored = (await pool.query('SELECT buyer_id,seller_id,quantity,amount FROM point_orders')).rows[0];
    expect(stored).toEqual({buyer_id:selectedId,seller_id:platformId,quantity:'2.0000',amount:'4.4000'});
    const orderId = (await pool.query('SELECT id FROM point_orders')).rows[0].id;
    await page.getByRole('button',{name:'调整数量或售价'}).click();
    await page.getByLabel('点数数量',{exact:true}).last().fill('3');
    await page.route('**/api/point-orders/reprice', async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort();
    }, { times: 1 });
    await page.getByRole('button',{name:'保存调整'}).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await pool.query('SELECT quantity FROM point_orders WHERE id=$1',[orderId])).rows[0].quantity).toBe('3.0000');
    const readsBeforeUnknownLeave = reads.length;
    const postsBeforeUnknownLeave = reprices.length;
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link',{name:'帮助中心'}).click();
    await expect(page).toHaveURL(/\/platform\/ledger$/);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link',{name:'帮助中心'}).click();
    await page.getByRole('button',{name:'进入点数与账务',exact:true}).click();
    await expect(page.getByLabel('点数数量',{exact:true}).last()).toHaveValue('3');
    expect(reads).toHaveLength(readsBeforeUnknownLeave);
    expect(reprices).toHaveLength(postsBeforeUnknownLeave);
    await page.getByRole('button',{name:'重试原操作'}).click();
    await expect(page.getByText('数量 3.0000 × 单价 2.2000 = 6.6000 元')).toBeVisible();
    expect(reprices[0]).toMatchObject({orderId,quantity:'3',unitPrice:'2.2000'});
    expect(reprices[1]).toEqual(reprices[0]);
    expect(orderId).not.toBe(selectedId);
    await page.getByRole('button',{name:'确认足额收款'}).click();
    await page.getByLabel('唯一线下收款凭证').fill('T07-UI-RECEIPT');
    await page.getByRole('button',{name:'确认并预留'}).click();
    await expect(page.getByText('收款凭证：T07-UI-RECEIPT')).toBeVisible();
    expect((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved).toBe('3.0000');
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger')).rows[0].n).toBe(1);
    const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')!.value;
    async function api(path: string, data: Record<string, unknown>) {
      return page.request.post(`/api/${path}`, { data, headers: { Origin: 'http://127.0.0.1:3140', 'X-CSRF-Token': csrf } });
    }
    const nestedId = randomUUID();
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'跨级买方','terminal',$2,0,'fixture',$3,'***')`, [nestedId,selectedId,randomUUID()]);
    expect((await api('point-orders',{requestId:randomUUID(),buyerId:nestedId,quantity:'1',unitPrice:'2.2'})).status()).toBe(403);
    expect((await api('point-orders',{requestId:randomUUID(),buyerId:selectedId,quantity:'1',unitPrice:'2.19'})).status()).toBe(409);
    expect((await api('point-orders',{requestId:randomUUID(),buyerId:selectedId,quantity:'0',unitPrice:'2.2'})).status()).toBe(400);
    expect((await api('point-orders/reprice',{requestId:randomUUID(),orderId,quantity:'4',unitPrice:'2.2'})).status()).toBe(409);
    await pool.query('UPDATE organizations SET active=false WHERE id=$1',[selectedId]);
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(page.getByRole('button',{name:'完整划拨',exact:true})).toBeDisabled();
    await expect(page.getByText('买方组织已停用，划拨暂停；预留继续保留。')).toBeVisible();
    expect((await api('point-orders/transfer',{requestId:randomUUID(),orderId})).status()).toBe(409);
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'10.0000',reserved:'3.0000'});
    await pool.query('UPDATE organizations SET active=true WHERE id=$1',[selectedId]);
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(page.getByRole('button',{name:'完整划拨',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'完整划拨'}).click();
    await expect(page.getByText('历史销售成本 6.0000 元，毛利 0.6000 元')).toBeVisible();
    expect(transfers).toHaveLength(1);
    expect(transfers[0].orderId).toBe((await pool.query('SELECT id FROM point_orders')).rows[0].id);
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'7.0000',reserved:'0.0000'});
    expect((await pool.query('SELECT balance,average_cost FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0])
      .toEqual({balance:'3.0000',average_cost:'2.2000'});
    expect((await api('point-orders/transfer',transfers[0])).status()).toBe(201);
    expect((await api('point-orders/transfer',{requestId:randomUUID(),orderId})).status()).toBe(409);
    expect((await api('point-orders/refund',{requestId:randomUUID(),orderId,refundEvidence:'不合法的已划拨退款'})).status()).toBe(409);
    expect((await pool.query('SELECT count(*)::int AS n FROM point_transfers')).rows[0].n).toBe(1);
    const refunds: Record<string,string>[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/point-orders/refund') && request.method()==='POST')
        refunds.push(request.postDataJSON());
    });
    await page.getByLabel('点数数量',{exact:true}).fill('2');
    await page.getByRole('button',{name:'建单'}).click();
    await expect(page.getByText('数量 2.0000 × 单价 2.2000 = 4.4000 元')).toBeVisible();
    const refundOrderId = (await pool.query("SELECT id FROM point_orders WHERE status='unpaid'")).rows[0].id;
    expect((await api('point-orders/refund',{requestId:randomUUID(),orderId:refundOrderId,refundEvidence:'未收款退款'})).status()).toBe(409);
    expect((await api('point-orders/confirm',{requestId:randomUUID(),orderId:refundOrderId,receiptReference:'T07-UI-RECEIPT'})).status()).toBe(409);
    await page.getByRole('button',{name:'确认足额收款'}).click();
    await page.getByLabel('唯一线下收款凭证').fill('T09-UI-RECEIPT');
    await page.getByRole('button',{name:'确认并预留'}).click();
    await expect(page.getByText('收款凭证：T09-UI-RECEIPT')).toBeVisible();
    expect((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved).toBe('2.0000');
    await page.getByRole('button',{name:'确认线下整单退款'}).click();
    expect((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved).toBe('2.0000');
    await page.getByLabel('线下退款完成依据').fill('T09-UI-REFUND');
    await page.getByRole('button',{name:'确认已退款并释放预留'}).click();
    await expect(page.getByText('退款 4.4000 元；依据：T09-UI-REFUND')).toBeVisible();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({orderId:refundOrderId,refundEvidence:'T09-UI-REFUND'});
    expect(refunds[0].orderId).not.toBe(stored.buyer_id);
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'7.0000',reserved:'0.0000'});
    expect((await api('point-orders/refund',refunds[0])).status()).toBe(201);
    expect((await api('point-orders/refund',{requestId:randomUUID(),orderId:refundOrderId,refundEvidence:'重复退款'})).status()).toBe(409);
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_refunds')).rows[0].n).toBe(1);
    const shortage = await api('point-orders',{requestId:randomUUID(),buyerId:otherId,quantity:'8',unitPrice:'2.2'});
    const shortageId = (await shortage.json()).orderId;
    expect(shortage.status()).toBe(201);
    expect((await api('point-orders/confirm',{requestId:randomUUID(),orderId:shortageId,receiptReference:'SHORTAGE'})).status()).toBe(409);
    expect((await pool.query('SELECT status,receipt_reference FROM point_orders WHERE id=$1',[shortageId])).rows[0])
      .toEqual({status:'unpaid',receipt_reference:null});
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'7.0000',reserved:'0.0000'});
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger')).rows[0].n).toBe(2);
    async function logout() {
      await page.getByRole('button',{name:/的账号菜单/}).click();
      await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();
      await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    }
    await logout();
    for (const role of roles) {
      await page.getByLabel('登录账号',{exact:true}).fill(role.email);
      await page.getByLabel('密码',{exact:true}).fill(rolePassword);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await expect(page, `Role ${role.role}: ${(await page.locator('body').innerText()).slice(0,800)}`).toHaveURL(new RegExp(`${role.defaultPath}$`));
      await page.goto('/platform/ledger');
      await expect(page).toHaveURL(new RegExp(`${role.defaultPath}$`));
      await expect(page.getByText('T07-UI-RECEIPT')).toHaveCount(0);
      const roleCsrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')!.value;
      const denied = await page.request.post('/api/point-orders/refund', {
        data: {requestId:randomUUID(),orderId:refundOrderId,refundEvidence:'越权退款'},
        headers: {Origin:'http://127.0.0.1:3140','X-CSRF-Token':roleCsrf}
      });
      expect(denied.status()).toBe(403);
      if (role.role !== 'distributor') expect((await page.request.get('/api/point-orders')).status()).toBe(403);
      await logout();
    }
    await page.getByLabel('登录账号',{exact:true}).fill('super_admin');
    await page.getByLabel('密码',{exact:true}).fill('T07-browser-password');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.goto('/platform/ledger');
    await expect(page.getByLabel('直属买方')).toHaveValue('');
    await expect(page.getByText('历史销售成本 6.0000 元，毛利 0.6000 元')).toBeVisible();
    await writeFile(resolve('.scratch/issue40/evidence.json'), JSON.stringify({
      database: name, platformId, selectedId, otherId, terminalId, nestedId, roles,
      submissions, reprices, transfers, refunds,
      orders: (await pool.query('SELECT id,buyer_id,seller_id,quantity,unit_price,amount,status,receipt_reference FROM point_orders ORDER BY created_at')).rows,
      inventory: (await pool.query('SELECT balance,reserved,average_cost FROM platform_inventory')).rows,
      transfersLedger: (await pool.query('SELECT * FROM point_transfers')).rows,
      refundsLedger: (await pool.query('SELECT * FROM point_order_refunds')).rows,
      requests: (await pool.query('SELECT operation,count(*)::int AS count FROM point_order_requests GROUP BY operation ORDER BY operation')).rows
    }, null, 2));
  } finally {
    await app?.close();
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});

