import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/pengxueyou/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base='C:/PXY/ai-research-company';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const results=[],errors=[];
try {
for(const variant of ['A','B','C']){
 const file='原型V2.html';
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///'+base+'/原型设计/'+file+'?variant='+variant);await page.waitForFunction(()=>!!window.accountPrototype);
 await page.waitForTimeout(100);
 const check=async(name,fn)=>{await fn();results.push(variant+': '+name);console.log('PASS '+file+' '+name)};
 const snap=()=>page.evaluate(()=>accountPrototype.snapshot());
 const modal=name=>name==='关闭'?page.locator('#modal button').filter({hasText:/^关闭$/}).click():page.locator('#modal').getByRole('button',{name,exact:true}).click();
 const login=async(email,password)=>{await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill(password);await page.locator('#view').getByRole('button',{name:'登录',exact:true}).click();await page.waitForTimeout(100)};
 await page.locator('#role').selectOption('platform');await page.getByRole('button',{name:'开户（直属下级）'}).click();
 await check('开户必填和自动生成密码',async()=>{assert.equal(await page.locator('#childPhone').getAttribute('required'),'');assert.equal(await page.locator('#childEmail').getAttribute('required'),'');assert.equal(await page.locator('#modal input[type=password]').count(),0);await page.evaluate(()=>accountCreateChild());assert.equal((await snap()).organizations.length,3)});
 await page.locator('#childName').fill('开户测试企业');await page.locator('#childPhone').fill('+86 13800001234');await page.locator('#childEmail').fill('new-admin@example.test');await modal('确认开户');await page.waitForSelector('#handoffPassword');
 let first=await page.locator('#handoffPassword').inputValue();
 await check('开户原值与组织/用户标识保持分离',async()=>{let s=await snap();const a=s.accounts.find(x=>x.login==='new-admin@example.test'),o=s.organizations.find(x=>x.id===a.org);assert.notEqual(a.id,o.id);assert.equal(o.phone,'+86 13800001234');assert.equal(o.parent,'platform-demo');assert.equal(a.mustChange,true);assert.equal(await page.locator('#handoffEmail').inputValue(),a.login);assert.ok(first.length>0);assert.equal(JSON.stringify(s).includes(first),false)});
 await check('一键复制邮箱和密码、失败提示及可重试',async()=>{await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}}));await modal('一键复制账号信息');assert.match(await page.locator('#copyStatus').innerText(),/复制失败/);await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedCredential=text}}}));await modal('一键复制账号信息');assert.equal(await page.evaluate(()=>window.copiedCredential),'登录邮箱：new-admin@example.test\n临时密码：'+first);assert.match(await page.locator('#copyStatus').innerText(),/已复制/)});
 if(variant==='A')await page.screenshot({path:base+'/tmp/account-opening-desktop.png',fullPage:true});
 await modal('关闭');await page.getByRole('button',{name:'开户（直属下级）'}).click();await page.locator('#childName').fill('重复企业');await page.locator('#childPhone').fill('different phone');await page.locator('#childEmail').fill('new-admin@example.test');await modal('确认开户');
 await check('跨组织重复邮箱阻止，未留下组织',async()=>{assert.match(await page.locator('#accountError').innerText(),/邮箱已占用/);assert.equal((await snap()).organizations.length,4)});await modal('关闭');
 const org=(await snap()).organizations.find(x=>x.name==='开户测试企业');await page.evaluate(id=>accountChildDetail(id),org.id);await modal('重置管理员密码');await modal('确认生成临时密码');await page.waitForSelector('#handoffPassword');const second=await page.locator('#handoffPassword').inputValue();assert.notEqual(first,second);await modal('关闭');await page.getByRole('button',{name:'退出登录',exact:true}).click();await login('new-admin@example.test',first);
 await check('重置后旧密码立即失效',async()=>{assert.match(await page.locator('#accountError').innerText(),/邮箱或密码不正确/)});
 await login('new-admin@example.test',second);
 await check('临时密码登录强制改密且不能导航绕过',async()=>{assert.match(await page.locator('#view').innerText(),/首次登录/);assert.equal(await page.locator('#role').isDisabled(),true);await page.evaluate(()=>go('企业档案库'));assert.match(await page.locator('#view').innerText(),/首次登录/);await page.evaluate(()=>ordersView());assert.equal(await page.locator('#orderQuantity').count(),0)});
 await page.locator('#accountNewPassword').fill('my-new-password');await page.locator('#accountConfirmPassword').fill('mismatch');await page.getByRole('button',{name:'设置密码并继续'}).click();assert.match(await page.locator('#accountError').first().innerText(),/两次输入一致/);await page.locator('#accountConfirmPassword').fill('my-new-password');await page.getByRole('button',{name:'设置密码并继续'}).click();await page.waitForTimeout(100);
 await check('新账号改密成功且与旧企业数据隔离',async()=>{assert.match(await page.locator('#view').innerText(),/账号已就绪/);assert.equal(await page.locator('#nav button').count(),0);assert.equal(await page.locator('#view').getByText('Atlas Outdoor LLC').count(),0)});
 await page.getByRole('button',{name:'账号设置',exact:true}).click();await page.locator('#currentPassword').fill('wrong');await page.locator('#accountNewPassword').fill('second-personal-password');await page.locator('#accountConfirmPassword').fill('second-personal-password');await modal('修改密码');await page.waitForTimeout(100);assert.match(await page.locator('#accountModalError').innerText(),/当前密码不正确/);await page.locator('#currentPassword').fill('my-new-password');await modal('修改密码');await page.waitForSelector('#loginEmail');await login('new-admin@example.test','second-personal-password');
 await check('主动改密校验当前密码、成功退出并可新密码登录',async()=>{assert.match(await page.locator('#view').innerText(),/账号已就绪/)});
 await page.locator('#role').selectOption('distributor');await page.evaluate(id=>accountChildDetail(id),org.id);
 await check('直属上级重置权限不能跨级',async()=>{assert.match(await page.locator('#toast').innerText(),/仅直属上级/);assert.equal(await page.locator('#dialog.open').count(),0)});
 await page.locator('#role').selectOption('admin');await page.evaluate(()=>go('成员管理'));await page.getByRole('button',{name:'创建成员',exact:true}).click();assert.equal(await page.locator('#memberPassword').count(),0);await page.locator('#memberName').fill('测试成员');await page.locator('#memberLogin').fill('member-new@example.test');await modal('创建本企业成员');await page.waitForSelector('#handoffPassword');await modal('关闭');await page.getByRole('button',{name:'重置密码',exact:true}).last().click();await modal('确认生成临时密码');await page.waitForSelector('#handoffPassword');const memberPassword=await page.locator('#handoffPassword').inputValue();await modal('关闭');await page.getByRole('button',{name:'停用',exact:true}).last().click();await page.getByRole('button',{name:'退出登录',exact:true}).click();await login('member-new@example.test',memberPassword);
 await check('成员自动密码、重置、停用后不能登录及历史保留',async()=>{assert.match(await page.locator('#accountError').innerText(),/账号已停用/);assert.equal(await page.evaluate(()=>prototypeState.members.length),2);assert.equal(await page.evaluate(()=>prototypeState.archives[0].id),'local-company-101')});
 await page.getByRole('button',{name:'忘记密码',exact:true}).click();await check('忘记密码包含平台运维恢复说明',async()=>assert.match(await page.locator('#modal').innerText(),/指定运维人员/));await modal('关闭');
 await page.setViewportSize({width:390,height:844});await check('窄屏登录无横向溢出',async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)));if(variant==='A')await page.screenshot({path:base+'/tmp/account-login-mobile.png',fullPage:true});
 await page.locator('#role').selectOption('platform');await page.getByRole('button',{name:'开户（直属下级）'}).click();await check('窄屏开户弹窗无横向溢出',async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)));if(variant==='A')await page.screenshot({path:base+'/tmp/account-opening-mobile.png',fullPage:true});
 await context.close();
}
assert.deepEqual(errors,[]);await fs.writeFile(base+'/tmp/account-verification.json',JSON.stringify({checks:results.length,passed:results,errors,scope:'Memory-only prototype; no backend authentication or production recovery tool'},null,2));
}finally{await browser.close()}

