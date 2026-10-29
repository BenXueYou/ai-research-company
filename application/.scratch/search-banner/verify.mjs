import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome' });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5187/.scratch/search-banner/index.html');
 await expect(page.getByRole('heading',{level:1})).toHaveText('找到目标企业，发现合作机会');
 await page.screenshot({path:'.scratch/search-banner/desktop.png',fullPage:true});
 await page.locator('#company-name').fill('Sample Company');
 await page.getByRole('link',{name:'按产品词发现',exact:true}).click();
 await expect(page.locator('#product-search h2')).toBeInViewport();
 await page.locator('#product-desc').fill('ceramic pump');
 await page.locator('#trade-start').fill('2026-01-01');
 await page.locator('#trade-end').fill('2026-06-30');
 const country=page.locator('#product-search .el-select');
 await country.click();
 await page.getByRole('option').filter({hasText:'土耳其'}).click();
 await page.getByRole('link',{name:'按公司名查找',exact:true}).click();
 await expect(page.locator('#company-name')).toHaveValue('Sample Company');
 await page.getByRole('button',{name:'免费查询',exact:true}).click();
 await expect(page.getByText('本页没有匹配企业',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'按产品词发现',exact:true}).click();
 await expect(page.locator('#product-desc')).toHaveValue('ceramic pump');
 await page.getByRole('button',{name:'查看第 1 页报价',exact:true}).click();
 await expect(page.getByRole('button',{name:'确认本页费用并查询'})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 const calls=await page.evaluate(()=>window.calls);
 expect(calls).toEqual([{path:'company-profiles'},{path:'company-searches',body:{name:'Sample Company',countryCodes:'CHN',pageNo:1,pageSize:20}},{path:'product-searches/quote',body:{productDesc:'ceramic pump',buyerCountryCode3:'TUR',startDate:'2026-01-01',endDate:'2026-06-30',pageNo:1,pageSize:20}}]);
 for(const width of [390,600,760,1024]) {
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width===390) await page.screenshot({path:'.scratch/search-banner/mobile.png',fullPage:true});
 }
 expect(errors).toEqual([]);
 console.log('PASS: desktop/mobile layout, anchors preserve both forms, CHN free search, TUR product quote, cancel without execution; no page errors.');
} finally { await browser.close(); }
