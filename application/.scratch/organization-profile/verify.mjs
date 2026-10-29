import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
for (const role of ['platform', 'distributor']) {
 const context = await browser.newContext({viewport:{width:1440,height:1000}});
 const page = await context.newPage(); page.on('pageerror',e=>console.log('PAGEERROR',e.message)); page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 let active=true; const calls=[];
 await page.route(/^http:\/\/127\.0\.0\.1:5297\/api\//, async route=>{
  const req=route.request(), path=new URL(req.url()).pathname, body=req.method()==='POST'?req.postDataJSON():null;
  if(body) calls.push({path,body});
  let json={};
  if(path==='/api/auth/session') json={id:'operator-account',loginName:'reviewer',email:'reviewer@example.com',role,mustChange:false};
  if(path==='/api/organizations'&&!body) json={parentName:'当前组织',allowedKinds:['terminal'],children:[{id:'organization-distinct',accountId:'administrator-distinct',name:'华东国际贸易有限公司',kind:'terminal',active,phoneMasked:'138****0000',email:'administrator.long-address@example.com'}]};
  if(path==='/api/organizations/state') active=body.active;
  if(path==='/api/password-resets') json={email:'administrator.long-address@example.com',temporaryPassword:'Temporary-test-123!',expiresAt:'2027-01-01T00:00:00Z'};
  await route.fulfill({json});
 });
 const base=role==='platform'?'/platform':'/distribution';
 await page.goto('http://127.0.0.1:5297'+base+'/organizations?id=organization-distinct');
 await expect(page.locator('.profile-identity h3')).toHaveText('华东国际贸易有限公司');
 await expect(page.locator('.profile-status')).toHaveText('启用');
 await page.screenshot({path:`.scratch/organization-profile/${role}-desktop.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:`.scratch/organization-profile/${role}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'停用组织',exact:true}).click();
 await expect(page.locator('.profile-status')).toHaveText('停用');
 expect(calls.find(x=>x.path==='/api/organizations/state').body).toEqual({organizationId:'organization-distinct',active:false});
 await page.getByRole('button',{name:'恢复组织',exact:true}).click();
 await expect(page.locator('.profile-status')).toHaveText('启用');
 await page.getByRole('button',{name:'重置管理员密码',exact:true}).click();
 await expect.poll(()=>calls.find(x=>x.path==='/api/password-resets')?.body.accountId).toBe('administrator-distinct');
 await expect(page.getByTestId('handoff-password')).toBeVisible();
 await expect(page.getByRole('button',{name:'重置管理员密码',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'已保存，关闭凭据',exact:true}).click();
 await expect(page.getByTestId('handoff-password')).toHaveCount(0);
 await page.getByRole('link',{name:'点数订单与售价',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(base+(role==='platform'?'/ledger':'/orders')+'$'));
 await page.goto('http://127.0.0.1:5297'+base+'/organizations?id=missing');
 await expect(page.getByText('未找到直属下级，请返回列表核对。')).toBeVisible();
 console.log(role+': desktop/mobile, no overflow, state parameters, reset account parameters, credential guard/close, order link, missing detail passed');
 await context.close();
}
} finally {await browser.close();}
