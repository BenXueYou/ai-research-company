import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve('.scratch/issue40/web');
const output = resolve('.scratch/issue40-style');
await mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname.startsWith('/assets/') ? resolve(root, `.${pathname}`) : resolve(root, 'index.html');
    response.setHeader('Content-Type', { '.js':'text/javascript', '.css':'text/css', '.html':'text/html' }[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(3340, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const orders = ['unpaid','awaiting_stock','reserved','transferred','refunded'].map((status, index) => ({
    id:`10000000-0000-4000-8000-00000000000${index}`,
    buyerId:`20000000-0000-4000-8000-00000000000${index}`,
    buyerName:['华东贸易有限公司','远航进出口有限公司','海川国际贸易','恒信商贸','智联供应链'][index],
    buyerActive:true, quantity:'1200.0000', unitPrice:'0.2200', amount:'264.0000',
    status, shortageReceipt:status==='awaiting_stock', receiptReference:'BANK-20261028',
    salesCost:'240.0000', grossProfit:'24.0000', refundAmount:'264.0000', refundEvidence:'银行退款回执'
  }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/auth/session'
      ? {id:'30000000-0000-4000-8000-000000000001',email:null,loginName:'super_admin',role:'platform',mustChange:false}
      : path === '/api/point-orders'
        ? {children:orders.map(order => ({id:order.buyerId,name:order.buyerName,kind:'distributor'})),inventory:{balance:'12800.0000',reserved:'1200.0000',average_cost:'0.2000'},pricing:{minimum_markup:'0.1'},orders}
        : {};
    return route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:3340/platform/ledger');
  await page.getByRole('heading',{name:'直属点数订单',exact:true}).waitFor();
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Mobile viewport overflow');
  console.log('Visual fixture: desktop/mobile rendered; no viewport overflow. Business APIs mocked for visual inspection only.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
