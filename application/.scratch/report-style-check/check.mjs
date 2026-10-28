import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
for (const kind of ['profit','ledger']) for (const width of [1440,375]) {
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.goto(`http://127.0.0.1:43144/.scratch/report-style-check/?kind=${kind}`);
 await page.getByText(kind==='profit'?'授权交易':'平台库存与采购流水',{exact:true}).waitFor();
 const result=await page.evaluate(()=>({calls:window.calls, regions:[...document.querySelectorAll('.table-wrap')].map(e=>({label:e.getAttribute('aria-label'),overflow:getComputedStyle(e).overflowX,scroll:e.scrollWidth,client:e.clientWidth})),bodyWidth:document.documentElement.scrollWidth, viewport:innerWidth, export:document.querySelector('.export-link').getAttribute('href'),exportBackground:getComputedStyle(document.querySelector('.export-link')).backgroundColor}));
 await page.getByRole('button',{name:'刷新'}).click();
 const calls=await page.evaluate(()=>window.calls);
 if(result.export!='/api/reports/own-ledger.csv'||result.exportBackground==='rgba(0, 0, 0, 0)'||calls.length!==2||calls.some(x=>x!=='reports')||result.regions.some(x=>x.overflow!=='auto')||result.bodyWidth>width) throw Error(JSON.stringify({kind,width,result,calls}));
 console.log(JSON.stringify({kind,width,...result,refreshCalls:calls.length}));
 await page.close();
}
await browser.close();
