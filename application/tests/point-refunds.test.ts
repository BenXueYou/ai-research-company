import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';

test('T09 refund releases only a confirmed reserved order once', async () => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('需要专用测试数据库地址');
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = database(adminUrl.toString());
  const name = `t09_${randomUUID().replaceAll('-','')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const testUrl = new URL(base); testUrl.pathname = `/${name}`;
  const pool = database(testUrl.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:3099';
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    await migrate(pool);
    const sellerId = (await pool.query("SELECT organization_id FROM accounts WHERE username='super_admin'")).rows[0].organization_id;
    const buyerId = randomUUID(), otherId = randomUUID();
    for (const [id,label] of [[buyerId,'直属买方'],[otherId,'其他直属买方']]) await pool.query(`INSERT INTO organizations
      (id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'distributor',$3,1,'fixture',$4,'***')`,[id,label,sellerId,randomUUID()]);
    const otherAccount = randomUUID();
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'other@t09.test',$3,'distributor',false)`,[otherAccount,otherId,await hashPassword('T09-controlled-password')]);
    await pool.query('UPDATE platform_pricing SET minimum_markup=0.01');
    await pool.query('UPDATE platform_inventory SET balance=8,average_cost=2');
    app = await createApplication(pool,origin); await app.listen(3099,'127.0.0.1');
    type Session = { cookie:string; csrf:string };
    const http = (path:string,body?:object,session?:Session) => fetch(`${origin}/api/${path}`,{
      method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session?.cookie??'','X-CSRF-Token':session?.csrf??''},body:body?JSON.stringify(body):undefined
    });
    async function login(email:string,password:string):Promise<Session> {
      const response = await http('auth/login',{email,password}); assert.equal(response.status,200);
      const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
      return {cookie:cookies.join('; '),csrf:cookies.find(item => item.startsWith('identity_csrf='))!.slice(14)};
    }
    let seller = await login('super_admin','init@Base123');
    assert.equal((await http('auth/password',{currentPassword:'init@Base123',newPassword:'T09-controlled-password',confirmPassword:'T09-controlled-password'},seller)).status,200);
    seller = await login('super_admin','T09-controlled-password');
    const other = await login('other@t09.test','T09-controlled-password');
    async function order(quantity:string) {
      const response = await http('point-orders',{requestId:randomUUID(),buyerId,quantity,unitPrice:'2.2'},seller);
      assert.equal(response.status,201); return (await response.json()).orderId as string;
    }
    const orderId = await order('3');
    const refund = {requestId:randomUUID(),orderId,refundEvidence:'T09 bank refund receipt'};
    assert.equal((await http('point-orders/refund',refund,seller)).status,409);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'0.0000');
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId,receiptReference:'T09 payment receipt'},seller)).status,201);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'3.0000');
    assert.equal((await http('point-orders/refund',refund,other)).status,403);
    assert.equal((await http('point-orders/refund',{...refund,requestId:randomUUID(),orderId:randomUUID()},seller)).status,403);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'3.0000');
    const responses = await Promise.all([http('point-orders/refund',refund,seller),http('point-orders/refund',refund,seller)]);
    assert.deepEqual(responses.map(item => item.status),[201,201]);
    assert.equal((await http('point-orders/refund',{...refund,requestId:randomUUID()},seller)).status,409);
    assert.equal((await http('point-orders/transfer',{requestId:randomUUID(),orderId},seller)).status,409);
    assert.equal((await pool.query('SELECT status FROM point_orders WHERE id=$1',[orderId])).rows[0].status,'refunded');
    assert.deepEqual((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0],{balance:'8.0000',reserved:'0.0000'});
    const record = (await pool.query('SELECT seller_id,actor_id,amount,evidence,released_quantity,reserved_after,created_at FROM point_order_refunds WHERE order_id=$1',[orderId])).rows[0];
    assert.equal(record.seller_id,sellerId); assert.equal(record.amount,'6.6000');
    assert.equal(record.evidence,refund.refundEvidence); assert.equal(record.released_quantity,'3.0000');
    assert.equal(record.reserved_after,'0.0000'); assert.ok(record.actor_id); assert.ok(record.created_at);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM point_order_refunds')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM point_transfers')).rows[0].n,0);
    const transferredId = await order('1');
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:transferredId,receiptReference:'T09 second payment'},seller)).status,201);
    assert.equal((await http('point-orders/transfer',{requestId:randomUUID(),orderId:transferredId},seller)).status,201);
    assert.equal((await http('point-orders/refund',{requestId:randomUUID(),orderId:transferredId,refundEvidence:'invalid'},seller)).status,409);
    assert.deepEqual((await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0],{balance:'7.0000',reserved:'0.0000'});
  } finally {
    await app?.close(); await pool.end(); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
});
