import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) throw Error('专用测试库必填');
const pool = database(process.env.TEST_DATABASE_URL);
await pool.query('DROP SCHEMA public CASCADE');
await pool.query('CREATE SCHEMA public');
process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex'); process.env.SMTP_CREDENTIAL_KEY = randomBytes(32).toString('hex');
let app: any, browser: any;
const listCalls: unknown[] = [], productCalls: unknown[] = [], requests: any[] = [];
const list = { async listCompanies(input: any) { listCalls.push(input); return {content:[{id:'vendor-list-111',name:'Association Buyer',country:'TUR'}],page:input.pageNo,size:input.pageSize,total:1}; } };
const importer = { buyerCountryFilterVerified:true as const, async importerNames(input: any) {productCalls.push(input); return {content:[{name:'Association Buyer'}],page:input.pageNo,size:input.pageSize,total:1,actualUpstreamPoints:'0.4321'};} };
try {
 await migrate(pool); const platform=(await pool.query("SELECT id,organization_id FROM accounts WHERE username='super_admin'")).rows[0];
 const org=randomUUID(), admin=randomUUID(), sales=randomUUID(), profile=randomUUID(), contact=randomUUID(), cq=randomUUID(), history=randomUUID();
 const password='Issue03-fixture-Password!'; const hash=await hashPassword(password);
 await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,'Fixture','terminal',$2,'enc',$3,'***')`,[org,platform.organization_id,randomUUID()]);
 for(const [id,role] of [[admin,'admin'],[sales,'sales']]) await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,false)`,[id,org,`${role}@issue03.test`,hash,role]);
 await pool.query(`INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,20)`,[org]);
 await pool.query('UPDATE platform_pricing SET coefficient=1');
 await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id) VALUES('/v2/trade/importers-name',0.5,2,'controlled','controlled_test',$1,$2)`,[randomUUID(),platform.id]);
 await pool.query(`INSERT INTO company_profiles(id,organization_id,name,country_code3,detail_id,detail,identity_state,detail_state,main_products) VALUES($1,$2,'Association Buyer','TUR','detail-data-222',$3,'verified','ready','manual preserved')`,[profile,org,{id:'detail-data-222'}]);
 await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,page_no,page_size,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Association Buyer',ARRAY['CEO'],1,20,1,1,$5,'settled')`,[cq,org,admin,profile,randomUUID()]);
 await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,returned_company_name,ownership_status,email,source_payload) VALUES($1,$2,$3,$4,'mailsou-444','Association Buyer','Association Buyer','matched','contact@example.test',$5)`,[contact,org,profile,cq,{id:'contact-source-555',fileId:'contact-file-666'}]);
 await pool.query(`INSERT INTO timeline_manual_records(id,organization_id,company_id,type,event_time,content,created_by) VALUES($1,$2,$3,'note',now(),'history preserved',$4)`,[history,org,profile,admin]);
 const srv=createServer(); await new Promise<void>(r=>srv.listen(0,'127.0.0.1',r)); const port=(srv.address() as any).port; await new Promise<void>(r=>srv.close(()=>r())); const origin=`http://127.0.0.1:${port}`;
 await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id) VALUES('/v2/company',1,1,'controlled','controlled_test',$1,$2)`,[randomUUID(),platform.id]);
 app=await createApplication(pool,origin,false,undefined,list,undefined,{ detail: async()=>{throw Error('unexpected name lookup');}, recordLookup:{interfacePath:'/v2/company',evidenceReference:'controlled-browser-contract',supplierVerified:false,detail:async(input:any)=>({data:{id:input.recordId,name:input.name,countryCode3:input.countryCode3,website:'fixture.example'}})}},undefined,undefined,importer,undefined,undefined,resolve('.scratch/company-sources/web')); await app.listen(port,'127.0.0.1');
 browser=await chromium.launch({headless:true}); const context=await browser.newContext({viewport:{width:1440,height:1000}}); const page=await context.newPage(); page.setDefaultTimeout(5000);
 page.on('request',(r: import('@playwright/test').Request)=>{if(r.method()==='POST' && r.url().includes('/company-profile-import')) requests.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
 async function login(role:string){await page.goto(origin+'/terminal/search'); await page.getByLabel('登录账号',{exact:true}).fill(role+'@issue03.test'); await page.getByLabel('密码',{exact:true}).fill(password); await page.getByRole('button',{name:'登录',exact:true}).click(); await expect(page.getByRole('button',{name:`${role}@issue03.test 的账号菜单`})).toBeVisible();}
 async function layouts(name:string){for(const width of [1440,900,390]){await page.setViewportSize({width,height:1000}); await page.locator('[aria-label="选择企业档案"]').filter({visible:true}).first().scrollIntoViewIfNeeded().catch(()=>{}); await page.screenshot({path:`.scratch/company-sources/${name}-${width}.png`,fullPage:true}); const size=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,viewport:innerWidth})); console.log('layout',name,width,JSON.stringify(size)); if(size.doc>size.viewport+1) throw Error('document overflow '+name+' '+width);}}
 async function selectAssociation(root:any, makeNew=false){const section=root.getByRole('region',{name:'选择企业档案'}); await expect(section).toBeVisible(); await section.scrollIntoViewIfNeeded(); await layouts(root===company?'company':'product'); await section.locator('.el-select').click(); await page.getByRole('option',{name:makeNew?'作为另一家入库':new RegExp(profile)}).click(); await section.getByRole('button',{name:'确认选择'}).click(); await expect(section).toHaveCount(0);}
 await login('admin'); await page.getByRole('tab',{name:'按公司名'}).click(); const company=page.locator('.company-search'); await company.getByLabel('公司名称',{exact:true}).fill('Association'); await company.getByRole('button',{name:'免费查询'}).click(); await expect(company.getByText('Association Buyer',{exact:true})).toBeVisible();
 const companyId=(await pool.query('SELECT id FROM company_candidates WHERE organization_id=$1',[org])).rows[0].id;
 const before=JSON.stringify((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',[org])).rows); const ledgerBefore=(await pool.query('SELECT count(*)::int n FROM query_point_ledger')).rows[0].n;
 await company.getByRole('button',{name:'保存选中企业'}).click(); await selectAssociation(company); await expect(company.getByRole('link',{name:'打开初始档案 · Association Buyer'})).toHaveAttribute('href',`/terminal/profiles?id=${profile}`);
 let companyReq=requests.find(r=>r.path.endsWith('company-profile-imports')); let companyResolution=requests.find(r=>r.path.endsWith('company-profile-import-resolutions'));
 if(companyReq.body.items[0].sourceRecordId!==companyId || companyResolution.body.items[0].sourceRecordId!==companyId || companyResolution.body.items[0].profileId!==profile) throw Error('company id mapping');
 if(JSON.stringify((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',[org])).rows)!==before || (await pool.query('SELECT count(*)::int n FROM query_point_ledger')).rows[0].n!==ledgerBefore || listCalls.length!==1) throw Error('company import changed ledger or vendor calls');

 await company.getByRole('link',{name:'打开初始档案 · Association Buyer'}).click();
 const panel=page.getByRole('region',{name:'企业资料来源'}); await expect(panel).toBeVisible();
 await panel.locator('.el-select').click(); await page.getByRole('option',{name:/资料编号 vendor-list-111/}).click();
 await panel.getByRole('button',{name:'确认资料选择',exact:true}).click();
 await expect(panel.getByText(/已选择：Association Buyer/)).toBeVisible();
 await panel.getByRole('button',{name:'查看所选资料详情'}).click();
 await panel.getByRole('button',{name:'确认费用并查询'}).click();
 await expect(panel.getByRole('status')).toHaveText('详情已获取，可查看资料；费用仍待确认。');
 await panel.getByRole('button',{name:'设为档案展示资料'}).click();
 await expect(panel.getByRole('button',{name:'当前展示资料'})).toBeDisabled();
 for(const width of [1440,900,390]) {
   await page.setViewportSize({width,height:1000}); await panel.scrollIntoViewIfNeeded();
   await page.screenshot({path:`.scratch/company-sources/source-panel-${width}.png`,fullPage:true});
   const bounds=await panel.boundingBox(); if(!bounds || bounds.width>width || bounds.x<0) throw Error('source panel overflow');
 }
 await page.getByRole('button',{name:'admin@issue03.test 的账号菜单'}).click(); await page.getByRole('menuitem',{name:'退出登录'}).click(); await expect(page.getByLabel('登录账号',{exact:true})).toBeVisible(); await login('sales');
 await page.getByRole('tab',{name:'按产品词'}).click(); const product=page.locator('.product-search'); await product.getByLabel('产品词',{exact:true}).fill('industrial pump'); const country=product.locator('.country-select').getByRole('combobox'); await country.fill('TUR'); await page.getByRole('option',{name:/(?:^|\s)TUR$/}).click(); await country.press('Escape'); await product.getByLabel('贸易开始日期').fill('2026-01-01'); await product.getByLabel('贸易结束日期').fill('2026-06-30'); await product.getByRole('button',{name:'查看第 1 页报价'}).click(); await product.getByRole('button',{name:'确认本页费用并查询'}).click(); await expect(product.locator('.candidate-row strong').first()).toHaveText('Association Buyer'); await product.locator('.candidate-row').first().scrollIntoViewIfNeeded(); await expect(product.locator('.candidate-row strong').first()).toBeVisible();
 const productId=(await pool.query('SELECT id FROM product_search_candidates WHERE organization_id=$1',[org])).rows[0].id; const prodBefore=JSON.stringify((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',[org])).rows); const ledgerProduct=(await pool.query('SELECT count(*)::int n FROM product_search_ledger')).rows[0].n;
 await product.getByRole('button',{name:'保存选中企业'}).click(); await selectAssociation(product); await expect(product.getByRole('link',{name:'打开初始档案 · Association Buyer'})).toHaveAttribute('href',`/terminal/profiles?id=${profile}`);
 const pReq=requests.filter(r=>r.path.endsWith('company-profile-imports')).at(-1); const pRes=requests.filter(r=>r.path.endsWith('company-profile-import-resolutions')).at(-1);
 if(pReq.body.items[0].sourceRecordId!==productId || pRes.body.items[0].sourceRecordId!==productId || pRes.body.items[0].profileId!==profile) throw Error('product id mapping');
 if(JSON.stringify((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1',[org])).rows)!==prodBefore || (await pool.query('SELECT count(*)::int n FROM product_search_ledger')).rows[0].n!==ledgerProduct || productCalls.length!==1) throw Error('product import changed ledger or vendor calls');
 const preserved=(await pool.query(`SELECT p.id,p.main_products,c.id contact_id,c.mailsou_id,c.source_payload,t.id history_id,t.content FROM company_profiles p JOIN company_contacts c ON c.profile_id=p.id JOIN timeline_manual_records t ON t.company_id=p.id WHERE p.id=$1`,[profile])).rows[0]; if(preserved.main_products!=='manual preserved'||preserved.contact_id!==contact||preserved.history_id!==history||preserved.content!=='history preserved') throw Error('history preservation');
 console.log('PASS',JSON.stringify({companyId,productId,profile,sourceId:'vendor-list-111',detailId:'detail-data-222',companyReq:companyReq.body,companyResolution:companyResolution.body,productReq:pReq.body,productResolution:pRes.body,pointBefore:prodBefore,listCalls:listCalls.length,productCalls:productCalls.length,preserved}));
} finally {if(browser) await browser.close(); if(app) await app.close(); await pool.end();}


