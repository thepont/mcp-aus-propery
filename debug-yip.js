import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// @ts-ignore
chromium.use(StealthPlugin());

async function investigate() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const targetUrl = 'https://www.yourinvestmentpropertymag.com.au/top-suburbs/vic/3156-ferntree-gully';
    
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        const data = await page.evaluate(() => {
            const results = {};
            results.title = document.title;
            // Look for table or data points
            results.tables = Array.from(document.querySelectorAll('table')).map(t => t.innerText.substring(0, 200));
            results.h1 = document.querySelector('h1')?.innerText;
            
            // Try to find specific data points like "Median price"
            const divs = Array.from(document.querySelectorAll('div, span, p')).filter(el => el.innerText.includes('Median price'));
            results.dataPoints = divs.map(d => d.parentElement?.innerText.substring(0, 200)).slice(0, 10);

            return results;
        });

        console.log('🏗️ YIP Data:', JSON.stringify(data, null, 2));

    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        await browser.close();
    }
}

investigate();