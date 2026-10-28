import {createServer} from 'vite';
import {chromium} from '@playwright/test';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch();const page=await browser.newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/auth/session'?{id:'layout-account',email:'admin@example.test',loginName:'admin@example.test',role:'admin',mustChange:false}:{batches:[]}}));
console.log(server.resolvedUrls.local[0]);await page.goto(server.resolvedUrls.local[0]+'terminal/emails');await page.waitForTimeout(3000);console.log((await page.locator('body').innerText()).slice(0,2000));
await browser.close();await server.close();
