import { createServer } from 'vite';
import { chromium } from '@playwright/test';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch();
try {
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(`${server.resolvedUrls.local[0]}.scratch/email-style/harness.html?empty`);
 await page.locator('.records-empty').waitFor();
 const size=await page.locator('.records-empty').boundingBox();
 const svg=await page.locator('.records-empty svg').boundingBox();
 console.log(JSON.stringify({size,svg}));
 await page.screenshot({path:'.scratch/email-style/empty-before.png',fullPage:true});
 if(size.height>500 || svg.width>120 || svg.height>120) throw new Error('Empty state illustration exceeds intended size');
} finally {await browser.close();await server.close();}
