import {chromium} from 'file:///C:/Users/pengxueyou/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='C:/PXY/ai-research-company';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];
for(const variant of ['A','B','C']){
 await page.goto('file:///'+base+'/原型设计/原型V2.html?variant='+variant);
 for(const role of ['admin','sales','distributor','platform']){
  await page.locator('#role').selectOption(role);
  const labels=await page.locator('#nav button').allTextContents();
  for(const label of labels){
   await page.locator('#nav button').filter({hasText:label}).click();
   assert.equal(await page.locator('#currentModule').textContent(),label);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${variant}/${role}/${label}: overflow`);
   checks.push(`${variant}/${role}/${label}`);
  }
 }
 await page.locator('#role').selectOption('admin');
 await page.screenshot({path:base+`/archive/tmp/v2-layout-${variant}.png`,fullPage:true});
 await page.getByRole('button',{name:'企业档案库',exact:true}).click();
 await page.screenshot({path:base+`/archive/tmp/v2-archive-${variant}.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 for(const label of await page.locator('#nav button').allTextContents()){
  await page.locator('#nav button').filter({hasText:label}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`mobile ${variant}/${label}`);
 }
 await page.setViewportSize({width:1440,height:1000});
}
await page.goto('file:///'+base+'/原型设计/原型V2.html');
await page.getByRole('button',{name:'下一个布局',exact:true}).click();
assert.match(page.url(),/variant=B/);
await page.keyboard.press('ArrowRight');assert.match(page.url(),/variant=C/);
await page.locator('#keyword').focus();await page.keyboard.press('ArrowRight');assert.match(page.url(),/variant=C/);
await page.getByRole('button',{name:'演示状态',exact:true}).click();assert.match(await page.locator('#prototypeStateJson').textContent(),/"variant": "C"/);
assert.deepEqual(errors,[]);
await fs.writeFile(base+'/archive/tmp/v2-layout-verification.json',JSON.stringify({desktopModuleChecks:checks.length,mobileModuleChecks:18,variantAndKeyboardChecks:'passed',scriptErrors:errors,checks},null,2));
console.log(`${checks.length} desktop module checks, 18 mobile module checks and variant controls passed.`);
await browser.close();
