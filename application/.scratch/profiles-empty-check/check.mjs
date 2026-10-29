import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const server=await createServer({server:{port:3298,host:'127.0.0.1'}});await server.listen();
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:3298/.scratch/profiles-empty-check/index.html');
 await page.getByRole('heading',{name:'暂无企业档案',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'去找企业'}).getAttribute('href'),'/terminal/search');
 await page.locator('select').selectOption('following');
 assert.equal(await page.getByRole('heading',{name:'暂无企业档案',exact:true}).count(),1);
 await page.getByRole('button',{name:'筛选档案'}).click();
 await page.getByRole('heading',{name:'未找到匹配档案',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'去找企业'}).count(),0);
 assert.deepEqual(await page.evaluate(()=>window.requests),[{path:'company-profiles/list',body:{deleted:false}},{path:'company-profiles/list',body:{deleted:false,customerStatus:'following'}}]);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('.profiles-empty').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 console.log('PASS: initial empty state, search link, applied filter state, unchanged request values, mobile card');
} finally {await browser.close();await server.close();}
