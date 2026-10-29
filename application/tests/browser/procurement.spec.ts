import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { procurementHttp } from '../procurement-helpers.js';

test('T06 browser real purchasing, expense selection provenance and pricing', async ({ page }) => {
  const previousCwd = process.cwd();
  process.chdir(resolve(previousCwd, '.scratch/t06/runtime'));
  const { pool, name, app } = await procurementHttp(3096);
  console.log(`T06 UI isolated evidence database: ${name}`);
  const errors: string[] = [];
  const submissions: {path: string; body: Record<string,string>}[] = [];
  page.on('pageerror',error => errors.push(error.message));
  page.on('request',request => {
    if (request.url().includes('/api/procurement/') && request.method()==='POST')
      submissions.push({path: new URL(request.url()).pathname,body: request.postDataJSON()});
  });
  async function login(email: string, password: string) {
    await page.getByLabel('登录账号',{exact: true}).fill(email);
    await page.getByLabel('密码',{exact: true}).fill(password);
    await page.getByRole('button',{name: '登录',exact: true}).click();
  }
  async function fillPurchase(receipt: string, amount: string, points: string) {
    await page.getByLabel('采购上游点数',{exact: true}).fill(points);
    await page.getByLabel('采购人民币金额',{exact: true}).fill(amount);
    await page.getByLabel('采购凭证编号',{exact: true}).fill(receipt);
    await page.getByLabel('采购核对依据',{exact: true}).fill('Controlled UI receipt evidence');
  }
  async function buy() {
    const response = page.waitForResponse(response => response.url().endsWith('/api/procurement/purchases') && response.request().method()==='POST');
    await page.getByRole('button',{name: '确认采购入账',exact: true}).click();
    const received = await response;
    expect(received.status()).toBe(201);
    return received.json();
  }
  try {
    await page.goto('/');
    await login('super_admin','init@Base123');
    await expect(page.getByRole('heading',{name: '先保护好您的账号'})).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/procurement')).status)).toBe(403);
    const password = 'T06-browser-controlled-password';
    await page.getByLabel('当前密码',{exact: true}).fill('init@Base123');
    await page.getByLabel('新密码',{exact: true}).fill(password);
    await page.getByLabel('确认新密码',{exact: true}).fill(password);
    await page.getByRole('button',{name: '确认修改并重新登录'}).click();
    await expect(page.getByRole('heading',{name: '登录工作空间'})).toBeVisible();
    await login('super_admin',password);
    await expect(page.getByRole('heading',{name: '平台采购与计价'})).toBeVisible();
    await expect(page.getByText('接口单价未配置，付费查询不可执行。',{exact: true})).toBeVisible();
    await fillPurchase('UI-SALE-REF-A','20','100');
    const first = await buy();
    await expect(page.getByTestId('inventory-balance')).toHaveText('100.0000');
    await expect(page.getByTestId('inventory-cost')).toHaveText('0.2000');
    await expect(page.getByTestId('minimum-price')).toHaveText('0.2020');
    const account = (await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
    expect(new Set([account.id,account.organization_id,first.id]).size).toBe(3);
    expect(submissions[0].body).toMatchObject({purpose: 'sale',upstreamPoints: '100',amount: '20',receiptReference: 'UI-SALE-REF-A'});
    expect(Object.keys(submissions[0].body).sort()).toEqual(['amount','evidence','purpose','receiptReference','requestId','upstreamPoints'].sort());
    // Simulate a response lost after the server commits, then resubmit unchanged form.
    await fillPurchase('UI-SALE-LOST-RESPONSE','20','100');
    await page.route('**/api/procurement/purchases',async route => {
      await route.fetch();
      await route.abort('failed');
    },{times: 1});
    await page.getByRole('button',{name: '确认采购入账',exact: true}).click();
    await expect(page.getByRole('button',{name: '确认采购入账',exact: true})).toBeEnabled();
    await buy();
    await expect(page.getByTestId('inventory-balance')).toHaveText('200.0000');
    expect(submissions[1].body.requestId).toBe(submissions[2].body.requestId);
    expect((await pool.query('SELECT count(*)::integer AS n FROM point_purchases')).rows[0].n).toBe(2);
    await page.getByLabel('费用人民币金额',{exact: true}).fill('5');
    await page.getByLabel('费用来源编号',{exact: true}).fill('UI-QUERY-LOSS-REF-B');
    await page.getByLabel('费用核对依据',{exact: true}).fill('Upstream failed-query bill evidence');
    const lossResponse = page.waitForResponse(response => response.url().endsWith('/api/procurement/expenses'));
    await page.getByRole('button',{name: '确认费用',exact: true}).click();
    const loss = await (await lossResponse).json();
    await expect(page.getByTestId('borne-expenses')).toHaveText('5.0000');
    await page.getByLabel('采购用途',{exact: true}).selectOption('failure');
    await page.getByLabel('关联已记费用',{exact: true}).selectOption({label: 'UI-QUERY-LOSS-REF-B · 5.0000元'});
    await expect(page.getByLabel('关联已记费用',{exact: true})).toHaveValue(loss.id);
    await fillPurchase('UI-TOPUP-REF-C','5','10');
    const credited = await buy();
    expect(new Set([account.id,account.organization_id,first.id,loss.id,credited.id]).size).toBe(5);
    const lastPurchase = submissions.filter(item => item.path.endsWith('/purchases')).at(-1)!;
    expect(lastPurchase.body.expenseId).toBe(loss.id);
    expect(lastPurchase.body.receiptReference).toBe('UI-TOPUP-REF-C');
    expect(credited.expenseId).toBe(loss.id);
    await expect(page.getByTestId('inventory-balance')).toHaveText('200.0000');
    await expect(page.getByTestId('inventory-cost')).toHaveText('0.2000');
    await expect(page.getByTestId('borne-expenses')).toHaveText('5.0000');
    await expect(page.getByTestId('cash-outflow')).toHaveText('45.0000');
    const stored = (await pool.query('SELECT expense_id,actor_id,generated_internal_points FROM point_purchases WHERE id=$1',[credited.id])).rows[0];
    expect(stored).toEqual({expense_id: loss.id,actor_id: account.id,generated_internal_points: '0.0000'});
    await page.getByLabel('最低加价率',{exact: true}).fill('0.02');
    await page.getByLabel('接口路径',{exact: true}).fill('/v2/company/detail');
    await page.getByLabel('上游接口单价（上游点数/计费单位）',{exact: true}).fill('0.12345');
    await page.getByLabel('已核实本页最大计费量',{exact: true}).fill('1');
    await page.getByLabel('计价核实依据',{exact: true}).fill('Controlled fixture, not supplier pricing');
    await page.getByLabel('计价依据类型',{exact: true}).selectOption('controlled_test');
    await page.getByRole('button',{name: '保存计价配置',exact: true}).click();
    await expect(page.getByTestId('minimum-price')).toHaveText('0.2040');
    await expect(page.getByText(/\/v2\/company\/detail：0.1235/)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('inventory-balance')).toHaveText('200.0000');
    await expect(page.getByTestId('borne-expenses')).toHaveText('5.0000');
    expect(errors).toEqual([]);
    await page.screenshot({path: resolve(process.cwd(),'procurement-ui.png'),fullPage: true});
    console.log('T06 UI provenance verified: organizationId != accountId != salePurchaseId != expenseId != topupPurchaseId; selected option value = POST.expenseId = stored expense_id; actor_id from session.');
  } finally {
    await app.close();
    await pool.end();
    process.chdir(previousCwd);
  }
});
