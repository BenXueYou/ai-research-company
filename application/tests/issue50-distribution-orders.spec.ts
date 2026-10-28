import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { resolve } from 'node:path';
import { hashPassword } from '../server/identity/policy.js';
import { writeFile } from 'node:fs/promises';
import { migrateOrders } from '../server/commerce/orders-schema.js';

test('Issue50 distribution migration and platform regression preserve contracts, lifecycle and real ledger outcomes', async ({ page }) => {
  page.on('pageerror', failure => console.error('Browser error:', failure.message));
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('需要专用测试数据库地址');
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = database(adminUrl.toString());
  const name = `issue50_${randomUUID().replaceAll('-','')}_test`;
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
    const temporaryRolePassword = 'Issue50-temporary-password';
    const roleHash = await hashPassword(temporaryRolePassword);
    const roles = [
      {
        role: 'distributor',
        organizationId: selectedId,
        id: randomUUID(),
        email: 'distributor@issue40.test',
        defaultPath: '/distribution/organizations'
      },
      {
        role: 'admin',
        organizationId: terminalId,
        id: randomUUID(),
        email: 'admin@issue40.test',
        defaultPath: '/terminal/search'
      },
      {
        role: 'sales',
        organizationId: terminalId,
        id: randomUUID(),
        email: 'sales@issue40.test',
        defaultPath: '/terminal/search'
      }
    ];
    for (const role of roles) {
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,true,clock_timestamp()+interval '1 hour')`, [role.id,role.organizationId,role.email,roleHash,role.role]);
    }
    await pool.query('UPDATE platform_pricing SET minimum_markup=0.1');
    await pool.query('UPDATE platform_inventory SET balance=10,average_cost=2');
    const supplierCalls = {list:0,detail:0,contacts:0};
    const distributionAudit: Record<string,unknown> = {};
    const controlledSupplier = {
      listCompanies:async () => { supplierCalls.list++; throw new Error('订单不应调用供应商查询'); },
      detail:async () => { supplierCalls.detail++; throw new Error('订单不应调用供应商详情'); },
      contacts:async () => { supplierCalls.contacts++; throw new Error('订单不应调用供应商联系人'); }
    };
    app = await createApplication(pool,'http://127.0.0.1:3250', false,
      undefined, controlledSupplier, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      resolve('.scratch/issue50/web'));
    await app.listen(3250,'127.0.0.1');
    const submissions: Record<string,string>[] = [];
    const transfers: Record<string,string>[] = [];
    const reprices: Record<string,string>[] = [];
    const confirmations: Record<string,string>[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/point-orders') && request.method()==='POST')
        submissions.push(request.postDataJSON());
      if (request.url().endsWith('/api/point-orders/transfer') && request.method()==='POST')
        transfers.push(request.postDataJSON());
      if (request.url().endsWith('/api/point-orders/reprice') && request.method()==='POST')
        reprices.push(request.postDataJSON());
      if (request.url().endsWith('/api/point-orders/confirm') && request.method()==='POST')
        confirmations.push(request.postDataJSON());
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
    await expect(page.locator(`#order-buyer option[value="${selectedId}"]`)).toHaveCount(1);
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
    const forwardCanceled = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
    await page.evaluate(() => history.forward());
    await forwardCanceled;
    await expect(page).toHaveURL(/\/platform\/ledger$/);
    await expect(page.getByLabel('点数数量',{exact:true})).toHaveValue('2');
    const forwardAccepted = page.waitForEvent('dialog').then(dialog => dialog.accept());
    await page.evaluate(() => history.forward());
    await forwardAccepted;
    await expect(page).toHaveURL(/\/help$/);
    await page.goBack();
    await expect(page.getByLabel('点数数量',{exact:true})).toHaveValue('');
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
    await page.route('**/api/point-orders/confirm', async route => {
      expect((await route.fetch()).status()).toBe(201);
      await route.abort();
    }, { times: 1 });
    await page.getByRole('button',{name:'登记足额收款'}).click();
    await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
    expect((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved).toBe('3.0000');
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(page.getByText('收款凭证：T07-UI-RECEIPT')).toBeVisible();
    expect(confirmations).toHaveLength(1);
    await page.getByRole('button',{name:'重试原操作'}).click();
    await expect(page.getByText('收款凭证：T07-UI-RECEIPT')).toBeVisible();
    await expect(page.getByRole('button',{name:'重试原操作'})).toHaveCount(0);
    expect(confirmations[1]).toEqual(confirmations[0]);
    expect((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved).toBe('3.0000');
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger')).rows[0].n).toBe(1);
    const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')!.value;
    async function api(path: string, data: Record<string, unknown>) {
      return page.request.post(`/api/${path}`, { data, headers: { Origin: 'http://127.0.0.1:3250', 'X-CSRF-Token': csrf } });
    }
    const nestedId = randomUUID();
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'跨级买方','terminal',$2,0,'fixture',$3,'***')`, [nestedId,selectedId,randomUUID()]);
    expect((await api('point-orders',{
      requestId:randomUUID(),
      buyerId:nestedId,
      quantity:'1',
      unitPrice:'2.2'
    })).status()).toBe(403);
    expect((await api('point-orders',{
      requestId:randomUUID(),
      buyerId:selectedId,
      quantity:'1',
      unitPrice:'2.19'
    })).status()).toBe(409);
    expect((await api('point-orders',{
      requestId:randomUUID(),
      buyerId:selectedId,
      quantity:'0',
      unitPrice:'2.2'
    })).status()).toBe(400);
    expect((await api('point-orders/reprice',{
      requestId:randomUUID(),
      orderId,
      quantity:'4',
      unitPrice:'2.2'
    })).status()).toBe(409);
    await pool.query('UPDATE organizations SET active=false WHERE id=$1',[selectedId]);
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(page.getByRole('button',{name:'完整划拨',exact:true})).toBeDisabled();
    await expect(page.getByText('买方组织已停用，划拨暂停；预留继续保留。')).toBeVisible();
    expect((await api('point-orders/transfer',{requestId:randomUUID(),orderId})).status()).toBe(409);
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'10.0000',reserved:'3.0000'});
    await pool.query('UPDATE organizations SET active=true WHERE id=$1',[selectedId]);
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(page.getByRole('button',{name:'完整划拨',exact:true})).toBeEnabled();
    let releaseTransfer!: () => void;
    let transferArrived!: () => void;
    const arrived = new Promise<void>(resolve => { transferArrived = resolve; });
    const release = new Promise<void>(resolve => { releaseTransfer = resolve; });
    await page.route('**/api/point-orders/transfer', async route => {
      const response = await route.fetch();
      transferArrived();
      await release;
      await route.fulfill({ response });
    }, { times: 1 });
    await page.getByRole('button',{name:'完整划拨'}).click();
    await arrived;
    await page.getByRole('link',{name:'帮助中心'}).click();
    await expect(page).toHaveURL(/\/platform\/ledger$/);
    releaseTransfer();
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
    await page.getByRole('button',{name:'登记足额收款'}).click();
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
    await page.getByLabel('直属买方').selectOption(otherId);
    await page.getByLabel('点数数量',{exact:true}).fill('8');
    await page.route('**/api/point-orders', async route => {
      expect((await route.fetch()).status()).toBe(201);
      await route.abort();
    }, { times: 1 });
    await page.getByRole('button',{name:'建单',exact:true}).click();
    await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(page.getByText('数量 8.0000 × 单价 2.2000 = 17.6000 元')).toBeVisible();
    expect(submissions).toHaveLength(3);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button',{name:'已核实，结束本次核对',exact:true}).click();
    await expect(page.getByRole('button',{name:'重试原操作'})).toHaveCount(0);
    expect(submissions).toHaveLength(3);
    const shortageId = (await pool.query('SELECT id FROM point_orders WHERE buyer_id=$1',[otherId])).rows[0].id;
    const shortageCard = () => page.locator('.point-orders > .workspace-card').filter({hasText:`订单编号：${shortageId}`});
    await shortageCard().getByRole('button',{name:'确认足额收款',exact:true}).click();
    await page.getByLabel('唯一线下收款凭证').fill('SHORTAGE');
    await page.route('**/api/point-orders/confirm', async route => {
      expect((await route.fetch()).status()).toBe(201);
      await route.abort();
    }, {times:1});
    await page.getByRole('button',{name:'登记足额收款',exact:true}).click();
    await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
    const shortageConfirm = confirmations.at(-1)!;
    expect(shortageConfirm).toMatchObject({orderId:shortageId,receiptReference:'SHORTAGE'});
    await page.getByRole('button',{name:'重试原操作'}).click();
    expect(confirmations.at(-1)).toEqual(shortageConfirm);
    await expect(shortageCard().getByRole('heading',{name:'乙买方 · 已收款待补库存'})).toBeVisible();
    expect((await pool.query('SELECT status,receipt_reference,shortage_receipt FROM point_orders WHERE id=$1',[shortageId])).rows[0])
      .toEqual({status:'awaiting_stock',receipt_reference:'SHORTAGE',shortage_receipt:true});
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'7.0000',reserved:'0.0000'});
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT * FROM distributor_inventory WHERE organization_id=$1',[otherId])).rowCount).toBe(0);
    const refundInput = {requestId:randomUUID(),orderId:shortageId,refundEvidence:'缺库存不可退款'};
    expect((await api('point-orders/refund',refundInput)).status()).toBe(409);
    expect((await api('point-orders/reprice',{requestId:randomUUID(),orderId:shortageId,quantity:'1',unitPrice:'99'})).status()).toBe(409);
    expect((await api('point-orders/confirm',{requestId:randomUUID(),orderId:shortageId,receiptReference:'SECOND'})).status()).toBe(409);
    expect((await api('point-orders/transfer',{requestId:randomUUID(),orderId:shortageId})).status()).toBe(409);
    const reserveInput = {requestId:randomUUID(),orderId:shortageId};
    expect((await api('point-orders/reserve',reserveInput)).status()).toBe(409);
    const competitorResponse = await api('point-orders',{requestId:randomUUID(),buyerId:otherId,quantity:'8',unitPrice:'2.2'});
    expect(competitorResponse.status()).toBe(201);
    const competitorId = (await competitorResponse.json()).orderId;
    expect((await api('point-orders/confirm',{requestId:randomUUID(),orderId:competitorId,receiptReference:'SHORTAGE'})).status()).toBe(409);
    expect((await api('point-orders/confirm',{requestId:randomUUID(),orderId:competitorId,receiptReference:'COMPETITOR'})).status()).toBe(201);
    const purchase = async (upstreamPoints: string, amount: string) => {
      const response = await api('procurement/purchases',{
        requestId:randomUUID(),purpose:'sale',upstreamPoints,amount,receiptReference:randomUUID(),evidence:'受控测试采购凭证'
      });
      expect(response.status()).toBe(201);
    };
    // Actual procurement changes cost above the locked sale price; no repricing or second payment.
    await purchase('8','80');
    expect((await pool.query('SELECT average_cost FROM platform_inventory')).rows[0].average_cost).toBe('6.2667');
    expect((await api('organizations/state',{organizationId:otherId,active:false})).status()).toBe(201);
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    await expect(shortageCard().getByRole('button',{name:'补库后整单预留'})).toBeDisabled();
    expect((await api('point-orders/reserve',reserveInput)).status()).toBe(409);
    expect((await api('organizations/state',{organizationId:otherId,active:true})).status()).toBe(201);
    const competingInput = {requestId:randomUUID(),orderId:competitorId};
    const raced = await Promise.all([api('point-orders/reserve',reserveInput),api('point-orders/reserve',competingInput)]);
    expect(raced.map(response => response.status()).sort()).toEqual([201,409]);
    const winningId = raced[0].status() === 201 ? shortageId : competitorId;
    const waitingId = winningId === shortageId ? competitorId : shortageId;
    const winningInput = winningId === shortageId ? reserveInput : competingInput;
    const waitingInput = waitingId === shortageId ? reserveInput : competingInput;
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'15.0000',reserved:'8.0000'});
    expect((await api('point-orders/reserve',winningInput)).status()).toBe(201);
    expect((await api('point-orders/reserve',{requestId:randomUUID(),orderId:winningId})).status()).toBe(409);
    expect((await api('point-orders/refund',{...refundInput,requestId:randomUUID(),orderId:winningId})).status()).toBe(409);
    expect((await api('organizations/state',{organizationId:otherId,active:false})).status()).toBe(201);
    expect((await api('point-orders/transfer',{requestId:randomUUID(),orderId:winningId})).status()).toBe(409);
    expect((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved).toBe('8.0000');
    expect((await api('organizations/state',{organizationId:otherId,active:true})).status()).toBe(201);
    const firstTransfer = {requestId:randomUUID(),orderId:winningId};
    const transferRace = await Promise.all(Array.from({length:4},() => api('point-orders/transfer',firstTransfer)));
    expect(transferRace.map(response => response.status())).toEqual([201,201,201,201]);
    expect((await api('point-orders/reserve',waitingInput)).status()).toBe(409);
    await purchase('1','10');
    await page.getByRole('button',{name:'刷新订单',exact:true}).click();
    const waitingCard = () => page.locator('.point-orders > .workspace-card').filter({hasText:`订单编号：${waitingId}`});
    const reserveRequests: Record<string,string>[] = [];
    page.on('request',request => {
      if (request.url().endsWith('/api/point-orders/reserve') && request.method()==='POST') reserveRequests.push(request.postDataJSON());
    });
    await page.route('**/api/point-orders/reserve',async route => {
      expect((await route.fetch()).status()).toBe(201);
      await route.abort();
    },{times:1});
    await waitingCard().getByRole('button',{name:'补库后整单预留'}).click();
    await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
    page.once('dialog',dialog => dialog.accept());
    await page.getByRole('link',{name:'帮助中心',exact:true}).click();
    await page.goBack();
    await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
    expect(reserveRequests).toHaveLength(1);
    await page.getByRole('button',{name:'重试原操作'}).click();
    await expect.poll(() => reserveRequests.length).toBe(2);
    expect(reserveRequests[1]).toEqual(reserveRequests[0]);
    expect(reserveRequests[0].orderId).toBe(waitingId);
    await expect(waitingCard().getByRole('button',{name:'确认线下整单退款'})).toHaveCount(0);
    expect((await api('point-orders/refund',{...refundInput,requestId:randomUUID(),orderId:waitingId})).status()).toBe(409);
    await page.route('**/api/point-orders/transfer',async route => {
      expect((await route.fetch()).status()).toBe(201);
      await route.abort();
    },{times:1});
    await waitingCard().getByRole('button',{name:'完整划拨',exact:true}).click();
    await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
    await page.getByRole('button',{name:'重试原操作'}).click();
    await expect(waitingCard().getByRole('heading',{name:'乙买方 · 已划拨'})).toBeVisible();
    expect((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0]).toEqual({balance:'0.0000',reserved:'0.0000'});
    expect((await pool.query('SELECT balance,average_cost FROM distributor_inventory WHERE organization_id=$1',[otherId])).rows[0])
      .toEqual({balance:'16.0000',average_cost:'2.2000'});
    const locked = (await pool.query('SELECT quantity,unit_price,amount,status,shortage_receipt FROM point_orders WHERE id=ANY($1::uuid[])',[ [shortageId,competitorId] ])).rows;
    expect(locked).toEqual(Array.from({length:2},() => ({quantity:'8.0000',unit_price:'2.2000',amount:'17.6000',status:'transferred',shortage_receipt:true})));
    expect((await pool.query('SELECT count(*)::int AS n FROM point_transfers WHERE order_id=ANY($1::uuid[])',[[shortageId,competitorId]])).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger WHERE order_id=ANY($1::uuid[])',[[shortageId,competitorId]])).rows[0].n).toBe(2);
    // Repeating the explicit schema initializer preserves existing orders, receipts and ledgers in this test database.
    const client = await pool.connect();
    try { await migrateOrders(client); } finally { client.release(); }
    expect((await pool.query('SELECT shortage_receipt FROM point_orders WHERE id=$1',[shortageId])).rows[0].shortage_receipt).toBe(true);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link',{name:'帮助中心',exact:true}).click();
    await page.getByRole('button',{name:'进入点数与账务',exact:true}).click();
    await expect(page.getByLabel('直属买方')).toHaveValue('');
    async function logout() {
      await page.getByRole('button',{name:/的账号菜单/}).click();
      await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();
      await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    }
    await logout();
    for (const role of roles) {
      await page.getByLabel('登录账号',{exact:true}).fill(role.email);
      await page.getByLabel('密码',{exact:true}).fill(temporaryRolePassword);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await expect(page.getByRole('heading',{name:'先保护好您的账号'})).toBeVisible();
      await page.goto('/distribution/orders');
      await expect(page.getByRole('heading',{name:'先保护好您的账号'})).toBeVisible();
      expect((await page.request.get('/api/point-orders')).status()).toBe(403);
      await page.getByLabel('当前密码',{exact:true}).fill(temporaryRolePassword);
      await page.getByLabel('新密码',{exact:true}).fill(rolePassword);
      await page.getByLabel('确认新密码',{exact:true}).fill(rolePassword);
      await page.getByRole('button',{name:'确认修改并重新登录'}).click();
      await page.getByLabel('登录账号',{exact:true}).fill(role.email);
      await page.getByLabel('密码',{exact:true}).fill(rolePassword);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await expect(page.getByRole('button',{name:`${role.email} 的账号菜单`,exact:true})).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${role.defaultPath}$`));
      if (role.role === 'distributor') {
        const platformHttp = await playwrightRequest.newContext({baseURL:'http://127.0.0.1:3250'});
        try {
          expect((await platformHttp.post('/api/auth/login',{
            data:{email:'super_admin',password:'T07-browser-password'},headers:{Origin:'http://127.0.0.1:3250'}
          })).status()).toBe(200);
          const platformCsrf = (await platformHttp.storageState()).cookies.find(cookie => cookie.name === 'identity_csrf')!.value;
          const platformPost = (path: string,data: Record<string,unknown>) => platformHttp.post(`/api/${path}`,{
            data,headers:{Origin:'http://127.0.0.1:3250','X-CSRF-Token':platformCsrf}
          });
          let distributionCsrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')!.value;
          const distributorPost = (path: string,data: Record<string,unknown>) => page.request.post(`/api/${path}`,{
            data,headers:{Origin:'http://127.0.0.1:3250','X-CSRF-Token':distributionCsrf}
          });
          await page.goto('/distribution/orders');
          await expect(page.getByRole('heading',{name:'直属点数订单'})).toBeVisible();
          await expect(page.locator('.point-orders')).toHaveCount(1);
          await expect(page.locator('#compat-orders')).toHaveCount(0);
          await page.reload();
          await expect(page.getByRole('heading',{name:'直属点数订单'})).toBeVisible();
          const distributionSnapshot = await (await page.request.get('/api/point-orders')).json();
          expect(distributionSnapshot.children).toContainEqual({id:nestedId,name:'跨级买方',kind:'terminal'});
          expect(distributionSnapshot.children.some((child: {id: string}) => child.id === otherId)).toBe(false);
          expect(distributionSnapshot.orders).toEqual([]);
          distributionAudit.selection = {accountId:role.id,organizationId:role.organizationId,snapshot:distributionSnapshot};
          await writeFile(resolve('.scratch/issue50/distribution-selection.json'),JSON.stringify({accountId:role.id,organizationId:role.organizationId,snapshot:distributionSnapshot},null,2));
          const distributionReads = reads.length;
          const distributionPosts = submissions.length;
          await page.getByLabel('点数数量',{exact:true}).fill('99');
          page.once('dialog', dialog => dialog.dismiss());
          await page.getByRole('link',{name:'帮助中心',exact:true}).click();
          await expect(page).toHaveURL(/\/distribution\/orders$/);
          await expect(page.getByLabel('点数数量',{exact:true})).toHaveValue('99');
          page.once('dialog', dialog => dialog.accept());
          await page.getByRole('link',{name:'帮助中心',exact:true}).click();
          await expect(page).toHaveURL(/\/help$/);
          await page.goBack();
          await expect(page.getByLabel('点数数量',{exact:true})).toHaveValue('');
          await page.goForward();
          await expect(page).toHaveURL(/\/help$/);
          await page.goBack();
          await expect(page).toHaveURL(/\/distribution\/orders$/);
          expect(reads.length).toBe(distributionReads);
          expect(submissions.length).toBe(distributionPosts);
          await page.getByLabel('直属买方').selectOption(nestedId);
          await page.getByLabel('点数数量',{exact:true}).fill('4');
          await page.getByLabel('每点售价（人民币）').fill('3');
          await page.getByRole('button',{name:'建单',exact:true}).click();
          await expect(page.getByText('数量 4.0000 × 单价 3.0000 = 12.0000 元')).toBeVisible();
          const distributionOrder = (await pool.query('SELECT id FROM point_orders WHERE buyer_id=$1',[nestedId])).rows[0].id;
          await page.getByRole('button',{name:'调整数量或售价',exact:true}).click();
          await page.getByLabel('点数数量',{exact:true}).last().fill('5');
          await page.getByRole('button',{name:'保存调整',exact:true}).click();
          await expect(page.getByText('数量 5.0000 × 单价 3.0000 = 15.0000 元')).toBeVisible();
          expect(submissions.at(-1)).toMatchObject({buyerId:nestedId,quantity:'4',unitPrice:'3'});
          expect(reprices.at(-1)).toMatchObject({orderId:distributionOrder,quantity:'5',unitPrice:'3.0000'});
          await page.getByRole('button',{name:'确认足额收款',exact:true}).click();
          await page.getByLabel('唯一线下收款凭证').fill('DISTRIBUTION-SHORTAGE');
          await page.route('**/api/point-orders/confirm',async route => {
            expect((await route.fetch()).status()).toBe(201);
            await route.abort();
          },{times:1});
          await page.getByRole('button',{name:'登记足额收款',exact:true}).click();
          await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
          const unknownReads = reads.length;
          const unknownConfirmations = confirmations.length;
          page.once('dialog',dialog => dialog.accept());
          await page.getByRole('link',{name:'帮助中心',exact:true}).click();
          await page.goBack();
          await expect(page.getByLabel('唯一线下收款凭证')).toHaveValue('DISTRIBUTION-SHORTAGE');
          expect(reads.length).toBe(unknownReads);
          expect(confirmations.length).toBe(unknownConfirmations);
          await page.getByRole('button',{name:'重试原操作'}).click();
          await expect(page.getByRole('heading',{name:'跨级买方 · 已收款待补库存'})).toBeVisible();
          expect(confirmations.at(-1)).toEqual(confirmations.at(-2));
          expect((await distributorPost('point-orders/confirm',{requestId:randomUUID(),orderId:distributionOrder,receiptReference:'DUPLICATE'})).status()).toBe(409);
          expect((await distributorPost('point-orders/reprice',{requestId:randomUUID(),orderId:distributionOrder,quantity:'6',unitPrice:'4'})).status()).toBe(409);
          expect((await pool.query('SELECT balance,reserved FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0])
            .toEqual({balance:'3.0000',reserved:'0.0000'});
          expect((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1',[nestedId])).rowCount).toBe(0);
          expect((await distributorPost('point-orders/refund',{requestId:randomUUID(),orderId:distributionOrder,refundEvidence:'不可退'})).status()).toBe(409);
          for (const operation of ['confirm','reserve','transfer','refund']) {
            const extras = operation === 'confirm' ? {receiptReference:'TENANT'} : operation === 'refund' ? {refundEvidence:'TENANT'} : {};
            expect((await distributorPost(`point-orders/${operation}`,{requestId:randomUUID(),orderId:shortageId,...extras})).status()).toBe(403);
          }
          expect((await platformPost('point-orders/reserve',{requestId:randomUUID(),orderId:distributionOrder})).status()).toBe(403);
          expect((await distributorPost('point-orders',{requestId:randomUUID(),buyerId:otherId,quantity:'1',unitPrice:'3'})).status()).toBe(403);
          const secondLevelId = randomUUID();
          const distantId = randomUUID();
          await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
            VALUES($1,'二级分销','distributor',$2,2,'fixture',$3,'***')`,[secondLevelId,selectedId,randomUUID()]);
          await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
            VALUES($1,'跨级终端','terminal',$2,'fixture',$3,'***')`,[distantId,secondLevelId,randomUUID()]);
          expect((await distributorPost('point-orders',{requestId:randomUUID(),buyerId:distantId,quantity:'1',unitPrice:'3'})).status()).toBe(403);
          expect((await page.request.get('/api/company-profiles')).status()).toBe(403);
          // Increase the distributor's cost through a real purchase and parent transfer after its receipt is locked.
          expect((await platformPost('procurement/purchases',{
            requestId:randomUUID(),purpose:'sale',upstreamPoints:'10',amount:'100',receiptReference:randomUUID(),evidence:'分销补库受控凭证'
          })).status()).toBe(201);
          const topup = await platformPost('point-orders',{requestId:randomUUID(),buyerId:selectedId,quantity:'2',unitPrice:'50'});
          expect(topup.status()).toBe(201);
          const topupId = (await topup.json()).orderId;
          expect((await platformPost('point-orders/confirm',{requestId:randomUUID(),orderId:topupId,receiptReference:'DISTRIBUTOR-TOPUP'})).status()).toBe(201);
          expect((await platformPost('point-orders/transfer',{requestId:randomUUID(),orderId:topupId})).status()).toBe(201);
          expect((await pool.query('SELECT average_cost FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0].average_cost).toBe('21.3200');
          expect((await distributorPost('organizations/state',{organizationId:nestedId,active:false})).status()).toBe(201);
          expect((await distributorPost('point-orders/reserve',{requestId:randomUUID(),orderId:distributionOrder})).status()).toBe(409);
          expect((await distributorPost('organizations/state',{organizationId:nestedId,active:true})).status()).toBe(201);
          expect((await platformPost('organizations/state',{organizationId:selectedId,active:false})).status()).toBe(201);
          expect([401,403]).toContain((await distributorPost('point-orders/reserve',{requestId:randomUUID(),orderId:distributionOrder})).status());
          expect((await pool.query('SELECT status,shortage_receipt FROM point_orders WHERE id=$1',[distributionOrder])).rows[0])
            .toEqual({status:'awaiting_stock',shortage_receipt:true});
          expect((await platformPost('organizations/state',{organizationId:selectedId,active:true})).status()).toBe(201);
          await page.goto('/');
          await page.getByLabel('登录账号',{exact:true}).fill(role.email);
          await page.getByLabel('密码',{exact:true}).fill(rolePassword);
          await page.getByRole('button',{name:'登录',exact:true}).click();
          await expect(page.getByRole('button',{name:`${role.email} 的账号菜单`,exact:true})).toBeVisible();
          distributionCsrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')!.value;
          await page.goto('/distribution/orders');
          await page.getByRole('button',{name:'补库后整单预留',exact:true}).click();
          await expect(page.getByRole('heading',{name:'跨级买方 · 已收款并预留'})).toBeVisible();
          expect((await distributorPost('point-orders/refund',{requestId:randomUUID(),orderId:distributionOrder,refundEvidence:'补足后仍不可退'})).status()).toBe(409);
          expect((await distributorPost('organizations/state',{organizationId:nestedId,active:false})).status()).toBe(201);
          await page.getByRole('button',{name:'刷新订单',exact:true}).click();
          await expect(page.getByRole('button',{name:'完整划拨',exact:true})).toBeDisabled();
          expect((await distributorPost('point-orders/transfer',{requestId:randomUUID(),orderId:distributionOrder})).status()).toBe(409);
          expect((await pool.query('SELECT reserved FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0].reserved).toBe('5.0000');
          expect((await distributorPost('organizations/state',{organizationId:nestedId,active:true})).status()).toBe(201);
          await page.getByRole('button',{name:'刷新订单',exact:true}).click();
          await page.route('**/api/point-orders/transfer',async route => {
            expect((await route.fetch()).status()).toBe(201);
            await route.abort();
          },{times:1});
          await page.getByRole('button',{name:'完整划拨',exact:true}).click();
          await expect(page.getByRole('button',{name:'重试原操作'})).toBeVisible();
          await page.getByRole('button',{name:'重试原操作'}).click();
          await expect(page.getByRole('heading',{name:'跨级买方 · 已划拨'})).toBeVisible();
          expect(transfers.at(-1)).toEqual(transfers.at(-2));
          expect((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1',[nestedId])).rows[0].balance).toBe('5.0000');
          expect((await pool.query('SELECT balance,reserved FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0])
            .toEqual({balance:'0.0000',reserved:'0.0000'});
          expect((await pool.query('SELECT sales_amount,sales_cost,gross_profit FROM point_transfers WHERE order_id=$1',[distributionOrder])).rows[0])
            .toEqual({sales_amount:'15.0000',sales_cost:'106.6000',gross_profit:'-91.6000'});
          // Fund stock only through the existing parent trade contract.
          async function fund(quantity: string, receipt: string) {
            const response = await platformPost('point-orders',{requestId:randomUUID(),buyerId:selectedId,quantity,unitPrice:'50'});
            expect(response.status()).toBe(201);
            const orderId = (await response.json()).orderId;
            expect((await platformPost('point-orders/confirm',{requestId:randomUUID(),orderId,receiptReference:receipt})).status()).toBe(201);
            expect((await platformPost('point-orders/transfer',{requestId:randomUUID(),orderId})).status()).toBe(201);
          }
          await fund('2','DISTRIBUTION-REFUND-STOCK');
          await page.getByRole('button',{name:'刷新订单',exact:true}).click();
          await page.getByLabel('直属买方').selectOption(nestedId);
          await page.getByLabel('点数数量',{exact:true}).fill('2');
          await page.getByLabel('每点售价（人民币）').fill('55');
          await page.getByRole('button',{name:'建单',exact:true}).click();
          await expect(page.getByText('数量 2.0000 × 单价 55.0000 = 110.0000 元')).toBeVisible();
          const normalOrder = (await pool.query("SELECT id FROM point_orders WHERE seller_id=$1 AND status='unpaid'",[selectedId])).rows[0].id;
          await page.getByRole('button',{name:'确认足额收款',exact:true}).click();
          await page.getByLabel('唯一线下收款凭证').fill('DISTRIBUTION-REFUND');
          await page.getByRole('button',{name:'登记足额收款',exact:true}).click();
          await expect(page.getByRole('button',{name:'确认线下整单退款',exact:true})).toBeVisible();
          await page.getByRole('button',{name:'确认线下整单退款',exact:true}).click();
          await page.getByLabel('线下退款完成依据').fill('DISTRIBUTION-REFUND-EVIDENCE');
          await page.getByRole('button',{name:'确认已退款并释放预留',exact:true}).click();
          await expect(page.getByText('退款 110.0000 元；依据：DISTRIBUTION-REFUND-EVIDENCE')).toBeVisible();
          expect(refunds.at(-1)).toMatchObject({orderId:normalOrder,refundEvidence:'DISTRIBUTION-REFUND-EVIDENCE'});
          expect((await distributorPost('point-orders/refund',refunds.at(-1)!)).status()).toBe(201);
          expect((await distributorPost('point-orders/refund',{...refunds.at(-1),requestId:randomUUID()})).status()).toBe(409);
          expect((await pool.query('SELECT balance,reserved FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0]).toEqual({balance:'2.0000',reserved:'0.0000'});
          // Two independently paid orders compete for one complete reservation.
          const competition: string[] = [];
          for (const receipt of ['DISTRIBUTION-RACE-A','DISTRIBUTION-RACE-B']) {
            const response = await distributorPost('point-orders',{requestId:randomUUID(),buyerId:nestedId,quantity:'3',unitPrice:'55'});
            expect(response.status()).toBe(201);
            const orderId = (await response.json()).orderId;
            competition.push(orderId);
            expect((await distributorPost('point-orders/confirm',{requestId:randomUUID(),orderId,receiptReference:receipt})).status()).toBe(201);
          }
          await fund('1','DISTRIBUTION-RACE-STOCK');
          const raceInputs = competition.map(orderId => ({requestId:randomUUID(),orderId}));
          const raceResults = await Promise.all(raceInputs.map(input => distributorPost('point-orders/reserve',input)));
          expect(raceResults.map(response => response.status()).sort()).toEqual([201,409]);
          distributionAudit.competition = {inputs:raceInputs,statuses:raceResults.map(response => response.status())};
          const winnerIndex = raceResults[0].status() === 201 ? 0 : 1;
          const winningTransfer = {requestId:randomUUID(),orderId:competition[winnerIndex]};
          expect((await distributorPost('point-orders/reserve',raceInputs[winnerIndex])).status()).toBe(201);
          expect((await pool.query('SELECT balance,reserved FROM distributor_inventory WHERE organization_id=$1',[selectedId])).rows[0]).toEqual({balance:'3.0000',reserved:'3.0000'});
          const repeats = await Promise.all(Array.from({length:3},() => distributorPost('point-orders/transfer',winningTransfer)));
          expect(repeats.map(response => response.status())).toEqual([201,201,201]);
          distributionAudit.transferReplay = {input:winningTransfer,statuses:repeats.map(response => response.status())};
          expect((await distributorPost('point-orders/transfer',{...winningTransfer,requestId:randomUUID()})).status()).toBe(409);
          expect((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1',[nestedId])).rows[0].balance).toBe('8.0000');
          expect((await pool.query('SELECT count(*)::int AS n FROM point_transfers WHERE order_id=$1',[winningTransfer.orderId])).rows[0].n).toBe(1);
          // The real Vite history middleware proxies the same backend session.
          const { createServer } = await import('vite');
          const vite = await createServer({configFile:resolve('config/playwright/vite.issue50.config.ts')});
          try {
            await vite.listen();
            const devPage = await page.context().newPage();
            await devPage.goto('http://127.0.0.1:5250/distribution/orders');
            await expect(devPage.getByRole('heading',{name:'直属点数订单'})).toBeVisible();
            await devPage.reload();
            await expect(devPage.locator('.point-orders')).toHaveCount(1);
            await devPage.close();
          } finally { await vite.close(); }
          await page.getByRole('button',{name:'刷新订单',exact:true}).click();
          await expect(page.getByRole('heading',{name:'跨级买方 · 已收款待补库存'})).toBeVisible();
          // Session destruction clears cached drafts even when a response arrives late.
          await page.getByLabel('点数数量',{exact:true}).fill('777');
          let releaseLate!: () => void;
          let lateArrived!: () => void;
          const lateReady = new Promise<void>(resolve => {lateArrived = resolve;});
          const lateRelease = new Promise<void>(resolve => {releaseLate = resolve;});
          await page.route('**/api/point-orders',async route => {
            const response = await route.fetch();
            lateArrived();
            await lateRelease;
            await route.fulfill({response});
          },{times:1});
          await page.getByRole('button',{name:'刷新订单',exact:true}).click();
          await lateReady;
          await pool.query('DELETE FROM sessions WHERE account_id=$1',[role.id]);
          await page.getByRole('button',{name:'刷新订单',exact:true}).click();
          await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
          releaseLate();
          await expect(page.locator('.point-orders')).toHaveCount(0);
          await page.getByLabel('登录账号',{exact:true}).fill(role.email);
          await page.getByLabel('密码',{exact:true}).fill(rolePassword);
          await page.getByRole('button',{name:'登录',exact:true}).click();
          await expect(page.getByRole('button',{name:`${role.email} 的账号菜单`,exact:true})).toBeVisible();
          await page.goto('/distribution/orders');
          await expect(page.getByLabel('点数数量',{exact:true})).toHaveValue('');
        } finally { await platformHttp.dispose(); }
      }
      await page.goto('/platform/ledger');
      await expect(page).toHaveURL(new RegExp(`${role.defaultPath}$`));
      await expect(page.getByText('T07-UI-RECEIPT')).toHaveCount(0);
      const roleCsrf = (await page.context().cookies()).find(cookie => cookie.name === 'identity_csrf')!.value;
      const denied = await page.request.post('/api/point-orders/refund', {
        data: {requestId:randomUUID(),orderId:refundOrderId,refundEvidence:'越权退款'},
        headers: {Origin:'http://127.0.0.1:3250','X-CSRF-Token':roleCsrf}
      });
      expect(denied.status()).toBe(403);
      for (const operation of ['confirm','reserve','transfer']) {
        const response = await page.request.post(`/api/point-orders/${operation}`,{
          data:{requestId:randomUUID(),orderId:shortageId,...(operation === 'confirm' ? {receiptReference:'FORBIDDEN'} : {})},
          headers:{Origin:'http://127.0.0.1:3250','X-CSRF-Token':roleCsrf}
        });
        expect(response.status()).toBe(403);
      }
      if (role.role !== 'distributor') expect((await page.request.get('/api/point-orders')).status()).toBe(403);
      if (role.role !== 'distributor') {
        await page.goto('/distribution/orders');
        await expect(page).toHaveURL(new RegExp(`${role.defaultPath}$`));
      }
      await logout();
    }
    await page.getByLabel('登录账号',{exact:true}).fill('super_admin');
    await page.getByLabel('密码',{exact:true}).fill('T07-browser-password');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await expect(page.getByRole('button',{name:'super_admin 的账号菜单',exact:true})).toBeVisible();
    await page.goto('/platform/ledger');
    await expect(page.getByLabel('直属买方')).toHaveValue('');
    await expect(page.getByText('历史销售成本 6.0000 元，毛利 0.6000 元')).toBeVisible();
    expect(supplierCalls).toEqual({list:0,detail:0,contacts:0});
    await writeFile(resolve('.scratch/issue50/evidence.json'), JSON.stringify({
      database: name,
      platformId,
      selectedId,
      otherId,
      terminalId,
      nestedId,
      roles,
      submissions,
      reprices,
      confirmations,
      transfers,
      refunds,
      supplierCalls,
      distributionAudit,
      reserveRequests,
      competition:{shortageId,competitorId,winningId,waitingId,statuses:raced.map(response => response.status())},
      orders: (await pool.query('SELECT id,buyer_id,seller_id,quantity,unit_price,amount,status,shortage_receipt,receipt_reference,created_by,confirmed_by,confirmed_at FROM point_orders ORDER BY created_at')).rows,
      inventory: (await pool.query('SELECT balance,reserved,average_cost FROM platform_inventory')).rows,
      distributorInventory: (await pool.query('SELECT * FROM distributor_inventory ORDER BY organization_id')).rows,
      buyerBalances: (await pool.query('SELECT organization_id,balance FROM internal_point_accounts ORDER BY organization_id')).rows,
      reservationLedger: (await pool.query('SELECT * FROM point_order_ledger ORDER BY id')).rows,
      procurementLedger: (await pool.query('SELECT * FROM procurement_ledger ORDER BY id')).rows,
      transfersLedger: (await pool.query('SELECT * FROM point_transfers')).rows,
      refundsLedger: (await pool.query('SELECT * FROM point_order_refunds')).rows,
      requestRecords: (await pool.query('SELECT request_id,actor_id,operation,payload,result FROM point_order_requests ORDER BY request_id')).rows,
      requests: (await pool.query('SELECT operation,count(*)::int AS count FROM point_order_requests GROUP BY operation ORDER BY operation')).rows
    }, null, 2));
  } finally {
    await app?.close();
    await pool.end();
    if (!/^issue50_[0-9a-f]{32}_test$/.test(name)) throw new Error('拒绝清理非本次测试库');
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});

