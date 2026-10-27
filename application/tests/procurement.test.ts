import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { procurementHttp } from './procurement-helpers.js';
import { hashPassword } from '../server/policy.js';
import { migrate } from '../server/database.js';
import { ProcurementService } from '../server/procurement.js';
import { IdentityService } from '../server/identity.js';
import { createApplication } from '../server/app.js';

test('T06 real HTTP/PostgreSQL accounting, pricing, permissions and concurrency', async t => {
  const { pool, name, app, http, login } = await procurementHttp();
  console.log(`T06 isolated evidence database: ${name}`);
  const password = 'T06-controlled-password-2026';
  let platform = await login('super_admin','init@Base123');
  const purchase = (overrides = {}) => ({ requestId: randomUUID(), purpose: 'sale', upstreamPoints: '100', amount: '20', receiptReference: randomUUID(), evidence: 'T06 controlled receipt', ...overrides });
  const expense = (overrides = {}) => ({ requestId: randomUUID(), purpose: 'failure', amount: '5', sourceReference: randomUUID(), evidence: 'T06 controlled upstream bill', ...overrides });
  const overview = async () => {
    const response = await http('procurement',undefined,platform);
    assert.equal(response.status,200);
    return response.json();
  };
  const post = (path: string, body: object) => http(`procurement/${path}`,body,platform);
  try {
    await t.test('anonymous, must-change, CSRF and X bypass rejected without accounting writes', async () => {
      assert.equal((await http('procurement')).status,401);
      assert.equal((await post('purchases',purchase())).status,403);
      assert.equal((await http('auth/password',{ currentPassword: 'init@Base123', newPassword: password, confirmPassword: password },platform)).status,200);
      platform = await login('super_admin',password);
      assert.equal((await http('procurement/purchases',purchase(),{ ...platform,csrf: 'invalid' })).status,403);
      assert.equal((await post('pricing',{requestId: randomUUID(),coefficient: '2',evidence: 'bypass'})).status,400);
      const initial = await overview();
      assert.equal(initial.pricing.coefficient,'1.0000');
      assert.equal(initial.pricing.minimum_markup,'0.0100');
      assert.equal(initial.prices.length,0);
      assert.equal(initial.ledger.length,0);
    });
    await t.test('concurrent duplicate receipt and request have one accounting effect', async () => {
      const input = purchase();
      const responses = await Promise.all(Array.from({length: 6},() => post('purchases',input)));
      assert.deepEqual(responses.map(item => item.status),[201,201,201,201,201,201]);
      const ids = await Promise.all(responses.map(item => item.json()));
      assert.equal(new Set(ids.map(item => item.id)).size,1);
      const duplicate = await post('purchases',{...input,requestId: randomUUID()});
      assert.equal(duplicate.status,409);
      assert.equal((await post('purchases',{...input,amount: '99'})).status,409);
      const result = await overview();
      assert.equal(result.inventory.balance,'100.0000');
      assert.equal(result.inventory.average_cost,'0.2000');
      assert.equal(result.inventory.minimum_sale_price,'0.2020');
      assert.equal(result.purchases.length,1);
      assert.equal(result.ledger.length,1);
    });
    await t.test('different effective X fixture snapshots, multiple purchases, HALF_UP decimals', async () => {
      // T27 effective configuration fixture only: there is deliberately no public X mutation endpoint.
      await pool.query('UPDATE platform_pricing SET coefficient=2');
      assert.equal((await post('purchases',purchase({upstreamPoints: '50',amount: '40'}))).status,201);
      let result = await overview();
      assert.equal(result.inventory.balance,'200.0000');
      assert.equal(result.inventory.average_cost,'0.3000');
      assert.equal(result.inventory.minimum_sale_price,'0.3030');
      assert.deepEqual(result.purchases.map((item: {coefficient_snapshot: string}) => item.coefficient_snapshot),['1.0000','2.0000']);
      await pool.query('UPDATE platform_pricing SET coefficient=1.2345');
      const rounded = await post('purchases',purchase({upstreamPoints: '1.00005',amount: '0.12345'}));
      assert.equal(rounded.status,201);
      assert.equal((await rounded.json()).generatedInternalPoints,'1.2346');
      result = await overview();
      assert.equal(result.inventory.balance,'201.2346');
      assert.equal(result.inventory.average_cost,'0.2988');
      assert.equal(result.purchases[2].amount,'0.1235');
      assert.equal(result.purchases[0].generated_internal_points,'100.0000');
      assert.equal((await post('purchases',purchase({amount: '0.00001'}))).status,400);
      assert.equal((await post('purchases',purchase({upstreamPoints: '0.00001'}))).status,400);
    });
    await t.test('coverage, failure and excess expenses reconcile without duplicate loss', async () => {
      const before = await overview();
      const lossInput = expense();
      const losses = await Promise.all([post('expenses',lossInput),post('expenses',lossInput)]);
      assert.equal(losses[0].status,201);
      const loss = await losses[0].json();
      assert.equal((await losses[1].json()).id,loss.id);
      assert.equal((await post('expenses',{...lossInput,requestId: randomUUID()})).status,409);
      assert.equal((await post('purchases',purchase({purpose: 'failure',amount: '6',expenseId: loss.id}))).status,400);
      assert.equal((await post('purchases',purchase({purpose: 'excess',amount: '5',expenseId: loss.id}))).status,400);
      assert.equal((await post('purchases',purchase({purpose: 'failure',amount: '5',expenseId: randomUUID()}))).status,400);
      const input = purchase({purpose: 'failure',amount: '5',upstreamPoints: '10',expenseId: loss.id});
      assert.equal((await post('purchases',purchase({purpose: 'failure',amount: '5'}))).status,400);
      const credited = await post('purchases',input);
      assert.equal(credited.status,201);
      const creditedBody = await credited.json();
      assert.equal(creditedBody.expenseId,loss.id);
      assert.notEqual(creditedBody.id,loss.id);
      assert.equal(creditedBody.generatedInternalPoints,'0.0000');
      assert.equal((await post('purchases',purchase({purpose: 'failure',amount: '5',expenseId: loss.id}))).status,409);
      const excessResponse = await post('expenses',expense({purpose: 'excess',amount: '2'}));
      const excess = await excessResponse.json();
      await Promise.all([
        post('purchases',purchase({purpose: 'coverage',amount: '3',upstreamPoints: '6'})).then(response => assert.equal(response.status,201)),
        post('purchases',purchase({purpose: 'excess',amount: '2',upstreamPoints: '4',expenseId: excess.id})).then(response => assert.equal(response.status,201))
      ]);
      const after = await overview();
      assert.equal(after.inventory.balance,before.inventory.balance);
      assert.equal(after.inventory.average_cost,before.inventory.average_cost);
      assert.equal(after.inventory.minimum_sale_price,before.inventory.minimum_sale_price);
      assert.equal(after.totals.expenses,'10.0000');
      assert.equal(after.totals.cash_outflow,'70.1235');
      assert.equal(after.totals.recorded_upstream_credits,'171.0001');
      assert.equal(after.expenses.length,3);
      const linked = after.expenses.find((item: {id: string}) => item.id===loss.id);
      assert.equal(linked.purchase_id,creditedBody.id);
    });
    await t.test('concurrent distinct purchases use serialized moving cost and append-only accounting', async () => {
      await pool.query('UPDATE platform_pricing SET coefficient=1');
      const platformOrg = (await pool.query("SELECT organization_id FROM accounts WHERE username='super_admin'")).rows[0].organization_id;
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,'other-platform@t06.test',$3,'platform',false)`,[randomUUID(),platformOrg,await hashPassword(password)]);
      const otherPlatform = await login('other-platform@t06.test',password);
      const responses = await Promise.all([post('purchases',purchase({upstreamPoints: '10',amount: '3'})),http('procurement/purchases',purchase({upstreamPoints: '10',amount: '3'}),otherPlatform)]);
      for (const response of responses) assert.equal(response.status,201);
      const result = await overview();
      assert.equal(result.inventory.balance,'221.2346');
      assert.equal(result.inventory.average_cost,'0.2989');
      const sums = (await pool.query(`SELECT sum(internal_delta)::numeric(20,4) AS balance,sum(expense_delta)::numeric(20,4) AS expenses,
        sum(cash_outflow)::numeric(20,4) AS cash FROM procurement_ledger`)).rows[0];
      assert.equal(sums.balance,result.inventory.balance);
      assert.equal(sums.expenses,result.totals.expenses);
      assert.equal(sums.cash,result.totals.cash_outflow);
      for (const table of ['procurement_ledger','point_purchases','platform_expenses']) {
        await assert.rejects(pool.query(`DELETE FROM ${table}`),/append only/);
      }
      await assert.rejects(pool.query('UPDATE procurement_ledger SET internal_delta=999'),/append only/);
      await migrate(pool);
      assert.equal((await overview()).inventory.balance,result.inventory.balance);
    });
    await t.test('verified pricing/version audit; production refuses controlled test configuration', async () => {
      const config = { requestId: randomUUID(), interfacePath: '/v2/company/detail', upstreamUnitPrice: '0.12345', maximumBillableUnits: '1', evidence: 'controlled fixture only', evidenceType: 'controlled_test', minimumMarkup: '0.02005' };
      assert.equal((await post('pricing',config)).status,201);
      const result = await overview();
      assert.equal(result.prices[0].upstream_unit_price,'0.1235');
      assert.equal(result.pricing.minimum_markup,'0.0201');
      assert.equal(result.prices[0].maximum_billable_units,1);
      assert.equal((await post('pricing',{...config,requestId: randomUUID(),maximumBillableUnits: ''})).status,400);
      assert.equal((await post('pricing',{...config,requestId: randomUUID(),evidence: ''})).status,400);
      const token = platform.cookie.split('; ').find(part => part.startsWith('identity_session='))!.slice(17);
      const identity = await new IdentityService(pool).authenticate(token);
      await assert.rejects(new ProcurementService(pool,true).mutate(identity,token,'pricing',{...config,requestId: randomUUID()}),/生产计价/);
      const productionApp = await createApplication(pool,'https://t06.example',true);
      await productionApp.listen(3097,'127.0.0.1');
      try {
        const rejection = await fetch('http://127.0.0.1:3097/api/procurement/pricing',{method: 'POST',
          headers: {Origin: 'https://t06.example','Content-Type': 'application/json',Cookie: platform.cookie,'X-CSRF-Token': platform.csrf},
          body: JSON.stringify({...config,requestId: randomUUID()})});
        assert.equal(rejection.status,400);
        const productionInfo = await fetch('http://127.0.0.1:3097/api/procurement',{headers: {Cookie: platform.cookie}});
        assert.equal((await productionInfo.json()).prices.length,0);
      } finally { await productionApp.close(); }
    });
    await t.test('other roles, forged organization/account and inactive platform cannot write or read', async () => {
      const baseline = await overview();
      for (const role of ['distributor','admin','sales']) {
        const accountId = randomUUID();
        const orgId = randomUUID();
        await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'T06 isolated role fixture','platform')",[orgId]);
        await pool.query('INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,false)',[accountId,orgId,`${role}@t06.test`,await hashPassword(password),role]);
        assert.notEqual(accountId,orgId);
        const session = await login(`${role}@t06.test`,password);
        assert.equal((await http('procurement',undefined,session)).status,403);
        for (const [path,input] of [['purchases',purchase()],['expenses',expense()],['pricing',{requestId: randomUUID(),minimumMarkup: '0.01',evidence: 'test'}]] as const)
          assert.equal((await http(`procurement/${path}`,input,session)).status,403);
      }
      assert.equal((await post('purchases',{...purchase(),organizationId: randomUUID(),accountId: randomUUID()})).status,400);
      const after = await overview();
      assert.equal(after.ledger.length,baseline.ledger.length);
      assert.deepEqual(after.inventory,baseline.inventory);
      await pool.query("UPDATE accounts SET active=false WHERE username='super_admin'");
      assert.equal((await post('purchases',purchase())).status,401);
    });
  } finally { await app.close(); await pool.end(); }
});
