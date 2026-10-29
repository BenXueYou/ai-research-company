import { test, expect } from '@playwright/test';
import express from 'express';
import { resolve } from 'node:path';

test('对账独立路由保留表单与查询标识来源', async ({ page }) => {
  const server = express();
  server.use(express.static(resolve('dist/web')));
  server.get(['/platform/reconciliation', '/platform/reconciliation/upstream'], (_request, response) => {
    response.sendFile(resolve('dist/web/index.html'));
  });
  const listener = server.listen(3323, '127.0.0.1');
  const origin = 'http://127.0.0.1:3323';
  const query = {
    id: 'detail-row-id',
    fileId: 'detail-file-id',
    queryId: 'detail-query-id',
    name: '测试企业',
    countryCode3: 'CHN',
    state: 'pending',
    maximumPoints: '10',
    coefficient: '1',
    traceId: null,
    billingReference: null,
    result: null,
    lossPurpose: null,
    lossUpstreamPoints: null,
    expenseId: null,
    lateResults: []
  };
  const reads: string[] = [];
  const submissions: Array<Record<string, unknown>> = [];
  let reject = true;
  let role = 'platform';
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: `${role}-account`, email: null, loginName: role, role, mustChange: false })
  }));
  await page.route('**/api/company-*/reconciliations', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET') {
      reads.push(path);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.includes('company-details') ? [query] : []) });
      return;
    }
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: reject ? 403 : 200,
      contentType: 'application/json',
      body: JSON.stringify(reject ? { message: '无权核对' } : {})
    });
  });
  await page.route('**/api/product-searches/reconciliations', route => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/upstream-monitor', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false, snapshot: null, usage: null, usageUnavailable: false, limits: null, events: [] })
  }));
  try {
    await page.goto(`${origin}/platform/reconciliation`);
    await expect(page.getByRole('heading', { name: '查询结果人工核对' })).toBeVisible();
    await expect(page.getByRole('region', { name: '腾道共享账号监控' })).toBeVisible();
    expect(reads).toHaveLength(3);
    await page.getByRole('button', { name: '核对', exact: true }).click();
    await page.getByLabel('供应商账单引用').fill('bill-1');
    await page.getByLabel('traceId').fill('trace-1');
    await page.getByLabel('实际上游扣点（失败或迟到结果如已知请填写）').fill('2');
    await page.getByLabel('可查看结果 JSON（含原始 id 与 countryCode3）').fill('{"id":"result-id","countryCode3":"CHN"}');
    await page.getByLabel('核对依据').fill('人工核实');
    await page.getByRole('link', { name: '查看上游监控页面' }).click();
    await page.goBack();
    await expect(page.getByLabel('供应商账单引用')).toHaveValue('bill-1');
    expect(reads).toHaveLength(3);
    await page.getByRole('button', { name: '确认并留痕' }).click();
    await expect(page.getByRole('alert')).toContainText('无权核对');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].queryId).toBe(query.queryId);
    expect(submissions[0].queryId).not.toBe(query.id);
    expect(submissions[0].queryId).not.toBe(query.fileId);
    reject = false;
    await page.getByRole('button', { name: '确认并留痕' }).click();
    await expect(page.getByRole('status')).toContainText('核对已完成');
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[1]).toEqual({
      queryId: 'detail-query-id',
      billingReference: 'bill-1',
      traceId: 'trace-1',
      evidence: '人工核实',
      result: { id: 'result-id', countryCode3: 'CHN' },
      upstreamPoints: '2',
      outcome: 'settled'
    });
    await page.getByRole('link', { name: '运营概览' }).click();
    await expect(page.locator('#compat-organizations')).toBeVisible();
    await expect(page.getByRole('heading', { name: '查询结果人工核对' })).toHaveCount(0);
    await page.getByRole('link', { name: '上游与对账', exact: true }).click();
    await expect(page.getByRole('heading', { name: '查询结果人工核对' })).toBeVisible();
    expect(reads).toHaveLength(6);
    role = 'admin';
    await page.reload();
    await expect(page).toHaveURL(`${origin}/terminal/search`);
    await expect(page.getByRole('heading', { name: '查询结果人工核对' })).toHaveCount(0);
  } finally {
    listener.close();
  }
});
