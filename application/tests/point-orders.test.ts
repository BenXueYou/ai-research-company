import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';

test('T07 HTTP and PostgreSQL order reservation', async () => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('需要专用测试数据库地址');
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = database(adminUrl.toString());
  const name = `t07_${randomUUID().replaceAll('-','')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const testUrl = new URL(base);
  testUrl.pathname = `/${name}`;
  const pool = database(testUrl.toString());
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
  const origin = 'http://127.0.0.1:3097';
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    await migrate(pool);
    app = await createApplication(pool,origin);
    await app.listen(3097,'127.0.0.1');
    type Session = { cookie:string; csrf:string };
    async function http(path:string,body?:object,session?:Session) {
      return fetch(`${origin}/api/${path}`,{ method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session?.cookie??'','X-CSRF-Token':session?.csrf??''},body:body?JSON.stringify(body):undefined });
    }
    async function login(email:string,password:string):Promise<Session> {
      const response = await http('auth/login',{email,password});
      assert.equal(response.status,200);
      const cookies = response.headers.getSetCookie().map(item=>item.split(';')[0]);
      return {cookie:cookies.join('; '),csrf:cookies.find(item=>item.startsWith('identity_csrf='))!.slice(14)};
    }
    const platformId = (await pool.query("SELECT organization_id FROM accounts WHERE username='super_admin'")).rows[0].organization_id;
    const buyerId = randomUUID();
    const strangerId = randomUUID();
    const hash = await hashPassword('T07-controlled-password');
    for (const [id,parent,name] of [[buyerId,platformId,'直属买方'],[strangerId,null,'其他组织']] as const) {
      await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,'distributor',$3,1,'fixture',$4,'***')`, [id,name,parent ?? platformId,randomUUID()]);
    }
    const strangerAccount = randomUUID();
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'stranger@t07.test',$3,'distributor',false)`, [strangerAccount,strangerId,hash]);
    let platform = await login('super_admin','init@Base123');
    assert.equal((await http('auth/password',{currentPassword:'init@Base123',newPassword:'T07-controlled-password',confirmPassword:'T07-controlled-password'},platform)).status,200);
    platform = await login('super_admin','T07-controlled-password');
    const stranger = await login('stranger@t07.test','T07-controlled-password');
    await pool.query("UPDATE platform_pricing SET minimum_markup=0.1"); // Explicit controlled test configuration.
    await pool.query("UPDATE platform_inventory SET balance=10,average_cost=2"); // Explicit controlled stock fixture.
    const create = (quantity='6',unitPrice='2.2',buyer=buyerId) => ({requestId:randomUUID(),buyerId:buyer,quantity,unitPrice});
    assert.equal((await http('point-orders',create('1','2.19'),platform)).status,409);
    assert.equal((await http('point-orders',create('1','2.2',strangerId),stranger)).status,403);
    const input = create();
    const response = await http('point-orders',input,platform);
    assert.equal(response.status,201);
    const order = await response.json();
    assert.equal(order.amount,'13.2000');
    assert.equal((await http('point-orders',input,platform)).status,201);
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:order.orderId,receiptReference:'R-1'},stranger)).status,403);
    await pool.query("UPDATE platform_inventory SET average_cost=3");
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:order.orderId,receiptReference:'R-1'},platform)).status,409);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'0.0000');
    await pool.query("UPDATE platform_inventory SET average_cost=2");
    const first = {requestId:randomUUID(),orderId:order.orderId,receiptReference:'R-1'};
    const confirmations = await Promise.all([http('point-orders/confirm',first,platform),http('point-orders/confirm',first,platform)]);
    assert.deepEqual(confirmations.map(item=>item.status),[201,201]);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'6.0000');
    assert.equal((await http('point-orders/reprice',{requestId:randomUUID(),orderId:order.orderId,quantity:'7',unitPrice:'3'},platform)).status,409);
    const second = await (await http('point-orders',create(),platform)).json();
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:second.orderId,receiptReference:'R-2'},platform)).status,201);
    assert.deepEqual((await pool.query('SELECT status,shortage_receipt FROM point_orders WHERE id=$1',[second.orderId])).rows[0],
      {status:'awaiting_stock',shortage_receipt:true});
    const third = await (await http('point-orders',create('1'),platform)).json();
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:third.orderId,receiptReference:'R-1'},platform)).status,409);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'6.0000');
    const fourth = await (await http('point-orders',create('4'),platform)).json();
    const fifth = await (await http('point-orders',create('4'),platform)).json();
    const competing = await Promise.all([
      http('point-orders/confirm',{requestId:randomUUID(),orderId:fourth.orderId,receiptReference:'R-4'},platform),
      http('point-orders/confirm',{requestId:randomUUID(),orderId:fifth.orderId,receiptReference:'R-5'},platform)
    ]);
    assert.deepEqual(competing.map(item=>item.status),[201,201]);
    assert.deepEqual((await pool.query('SELECT status FROM point_orders WHERE id=ANY($1::uuid[]) ORDER BY status',[[fourth.orderId,fifth.orderId]])).rows.map(item=>item.status),
      ['awaiting_stock','reserved']);
    assert.equal((await pool.query('SELECT reserved FROM platform_inventory')).rows[0].reserved,'10.0000');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM point_order_ledger')).rows[0].n,2);
    assert.equal((await http('point-orders',undefined,platform)).status,200);
    assert.equal((await http('point-orders',undefined,stranger)).status,200);
  } finally {
    await app?.close();
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
