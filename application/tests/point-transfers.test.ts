import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';

test('T08 HTTP transfer is atomic, once only, and snapshots gross profit', async () => {
  const base=process.env.TEST_DATABASE_URL;
  if (!base || !new URL(base).pathname.endsWith('_test')) throw new Error('需要专用测试数据库地址');
  const adminUrl=new URL(base); adminUrl.pathname='/postgres';
  const admin=database(adminUrl.toString());
  const name=`t08_${randomUUID().replaceAll('-','')}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const testUrl=new URL(base); testUrl.pathname=`/${name}`;
  const pool=database(testUrl.toString());
  process.env.ORG_CONTACT_KEY=randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY=randomBytes(32).toString('hex');
  const origin='http://127.0.0.1:3098';
  let app:Awaited<ReturnType<typeof createApplication>>|undefined;
  try {
    await migrate(pool);
    app=await createApplication(pool,origin); await app.listen(3098,'127.0.0.1');
    type Session={cookie:string;csrf:string};
    const http=(path:string,body?:object,session?:Session)=>fetch(`${origin}/api/${path}`,{
      method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session?.cookie??'','X-CSRF-Token':session?.csrf??''},body:body?JSON.stringify(body):undefined
    });
    async function login(email:string,password:string):Promise<Session> {
      const response=await http('auth/login',{email,password}); assert.equal(response.status,200);
      const cookies=response.headers.getSetCookie().map(item=>item.split(';')[0]);
      return {cookie:cookies.join('; '),csrf:cookies.find(item=>item.startsWith('identity_csrf='))!.slice(14)};
    }
    const sellerId=(await pool.query("SELECT organization_id FROM accounts WHERE username='super_admin'")).rows[0].organization_id;
    const buyerId=randomUUID(), otherId=randomUUID(), terminalId=randomUUID();
    for (const [id,label] of [[buyerId,'甲分销'],[otherId,'乙分销']]) await pool.query(`INSERT INTO organizations
      (id,name,kind,parent_id,distributor_level,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'distributor',$3,1,'fixture',$4,'***')`,[id,label,sellerId,randomUUID()]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'终端买方','terminal',$2,'fixture',$3,'***')`,[terminalId,sellerId,randomUUID()]);
    const password='T08-controlled-password';
    const buyerAccount=randomUUID();
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,'buyer@t08.test',$3,'distributor',false)`,[buyerAccount,buyerId,await hashPassword(password)]);
    let platform=await login('super_admin','init@Base123');
    assert.equal((await http('auth/password',{currentPassword:'init@Base123',newPassword:password,confirmPassword:password},platform)).status,200);
    platform=await login('super_admin',password);
    const buyer=await login('buyer@t08.test',password);
    await pool.query('UPDATE platform_pricing SET minimum_markup=0.1');
    await pool.query('UPDATE platform_inventory SET balance=10,average_cost=2');
    await pool.query('INSERT INTO distributor_inventory(organization_id,balance,average_cost) VALUES($1,4,1)',[buyerId]);
    const create=async(quantity:string,price:string)=>{
      const response=await http('point-orders',{requestId:randomUUID(),buyerId,quantity,unitPrice:price},platform);
      assert.equal(response.status,201); return (await response.json()).orderId as string;
    };
    const orderId=await create('3','2.2');
    const transfer={requestId:randomUUID(),orderId};
    assert.equal((await http('point-orders/transfer',transfer,platform)).status,409);
    assert.equal((await http('point-orders/transfer',transfer,buyer)).status,403);
    assert.equal((await pool.query('SELECT count(*)::int n FROM point_transfers')).rows[0].n,0);
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId,receiptReference:'T08-R1'},platform)).status,201);
    await pool.query('UPDATE platform_inventory SET average_cost=3');
    const outcomes=await Promise.all([http('point-orders/transfer',transfer,platform),http('point-orders/transfer',transfer,platform)]);
    assert.deepEqual(outcomes.map(item=>item.status),[201,201]);
    assert.equal((await http('point-orders/transfer',{requestId:randomUUID(),orderId},platform)).status,409);
    const stock=(await pool.query('SELECT balance,reserved FROM platform_inventory')).rows[0];
    assert.equal(stock.balance,'7.0000'); assert.equal(stock.reserved,'0.0000');
    const bought=(await pool.query('SELECT balance,average_cost FROM distributor_inventory WHERE organization_id=$1',[buyerId])).rows[0];
    assert.equal(bought.balance,'7.0000'); assert.equal(bought.average_cost,'1.5143');
    const history=(await pool.query('SELECT sales_unit_cost,sales_cost,sales_amount,gross_profit FROM point_transfers WHERE order_id=$1',[orderId])).rows[0];
    assert.deepEqual(history,{sales_unit_cost:'3.0000',sales_cost:'9.0000',sales_amount:'6.6000',gross_profit:'-2.4000'});
    await pool.query('UPDATE platform_inventory SET average_cost=5');
    await pool.query('UPDATE distributor_inventory SET average_cost=8 WHERE organization_id=$1',[buyerId]);
    assert.deepEqual((await pool.query('SELECT sales_unit_cost,sales_cost,sales_amount,gross_profit FROM point_transfers WHERE order_id=$1',[orderId])).rows[0],history);
    const second=await create('1','5.5');
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:second,receiptReference:'T08-R2'},platform)).status,201);
    assert.equal((await http('point-orders/transfer',{requestId:randomUUID(),orderId:second},buyer)).status,403);
    const terminalOrder=await http('point-orders',{requestId:randomUUID(),buyerId:terminalId,quantity:'1',unitPrice:'5.5'},platform);
    assert.equal(terminalOrder.status,201);
    const terminalOrderId=(await terminalOrder.json()).orderId;
    assert.equal((await http('point-orders/confirm',{requestId:randomUUID(),orderId:terminalOrderId,receiptReference:'T08-R3'},platform)).status,201);
    assert.equal((await http('point-orders/transfer',{requestId:randomUUID(),orderId:terminalOrderId},platform)).status,201);
    assert.equal((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1',[terminalId])).rows[0].balance,'1.0000');
  } finally {
    await app?.close(); await pool.end(); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
});
