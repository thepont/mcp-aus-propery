import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { SuburbTrend } from '../types.js'; // Assuming SuburbTrend is also used here now

// @ts-ignore
chromium.use(StealthPlugin());

export interface PropertyEstimate {
    address: string;
    attributes: {
        beds: string;
        baths: string;
        cars: string;
        landSize: string;
    };
    listing: {
        status: string;
        price: string;
        agency: string;
    };
    estimate: {
        range: string;
        confidence: string;
    };
    history: {
        lastSold: string;
    };
    url: string;
    sources: Array<{ name: string, url: string }>; // Added sources array
}

export class PropertyValueService {
    
    private getProxyConfig() {
        const proxyUrl = process.env.HTTP_PROXY;
        if (!proxyUrl) return null;
        return { server: proxyUrl };
    }

    private async launchBrowser() {
        return await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            proxy: this.getProxyConfig() || undefined
        });
    }

    private async resolveSearch(page: any, query: string): Promise<any> {
        const searchString = encodeURIComponent(query);
        const apiUrl = `https://www.propertyvalue.com.au/?op=myrp_widgets.freemiumInvestorSLAS.singleLineSearchHandler&subop=getSuggestionList&searchCategories=1%2C2%2C3%2C4&searchString=${searchString}&maxSuggestionResults=5`;
        
        return await page.evaluate(async (url: string) => {
            const res = await fetch(url, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            return res.json();
        }, apiUrl);
    }

    async getEstimate(address: string): Promise<PropertyEstimate | null> {
        console.error(`[PropertyValueService] Getting estimate for: ${address}`);
        
        const browser = await this.launchBrowser();

        try {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 1000 },
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            const page = await context.newPage();
            
            // 1. Go to homepage to set session/cookies
            await page.goto('https://www.propertyvalue.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });

            // 2. Call API to resolve address
            const response = await this.resolveSearch(page, address);

            if (!Array.isArray(response) || response.length === 0) {
                console.error('[PropertyValueService] No property found for address');
                return null;
            }

            const match = response[0];
            const propertyId = match.data.propertyId;
            const cleanAddress = match.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const targetUrl = `https://www.propertyvalue.com.au/property/${cleanAddress}/${propertyId}`;

            console.error(`[PropertyValueService] Resolved to URL: ${targetUrl}`);

            // 3. Navigate to property page
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Wait for key elements to ensure hydration
            try {
                await page.waitForSelector('#propEstimatedPrice', { timeout: 10000 });
            } catch (e) {
                // Ignore timeout
            }

            // 4. Extract data
            const html = await page.content();
            const $ = cheerio.load(html);

            const pageAddress = $('#paddress').text().trim().replace(/\s+/g, ' ');
            const beds = $('#bed').val() as string || '0';
            const forSaleStatus = $('.for-sale').text().trim();
            const listedPrice = $('.head-value .price').text().trim();
            const agency = $('#property-details-agency-name').text().trim();
            const estimateRange = $('#propEstimatedPrice').text().trim();
            
            let confidence = $('.medium.confidence').first().text().trim();
            if (!confidence) confidence = $('.high.confidence').first().text().trim();
            if (!confidence) confidence = $('.low.confidence').first().text().trim();
            confidence = confidence ? confidence.replace(/\s+/g, ' ') : '';

            const lastSoldText = $('p:contains("Last sold for")').text().trim();

            const getNextText = (selector: string) => {
                const el = $(selector);
                if (el.length && el[0].next && el[0].next.type === 'text') {
                    return (el[0].next as any).data.trim().replace('/', '').trim();
                }
                return '';
            };

            const baths = getNextText('i.bathrooms');
            const cars = getNextText('i.parking');
            const landSizePart = getNextText('i.sq');
            const landSizeSup = $('i.sq').nextAll('sup').first().text(); 
            const landSize = landSizePart ? `${landSizePart}${landSizeSup}` : '';

            return {
                address: pageAddress || match.value,
                attributes: {
                    beds,
                    baths: baths || '0',
                    cars: cars || '0',
                    landSize: landSize || ''
                },
                listing: {
                    status: forSaleStatus,
                    price: listedPrice,
                    agency
                },
                estimate: {
                    range: estimateRange,
                    confidence
                },
                history: {
                    lastSold: lastSoldText
                },
                url: targetUrl,
                sources: [{ name: 'PropertyValue.com.au (CoreLogic)', url: targetUrl }] // Populate sources
            };

        } catch (e: any) {
            console.error(`[PropertyValueService] Error: ${e.message}`);
            return null;
        } finally {
            await browser.close();
        }
    }

    async getSuburbTrends(suburb: string): Promise<SuburbTrend | null> {
        console.error(`[PropertyValueService] Getting suburb trends for: ${suburb}`);
        
        const browser = await this.launchBrowser();

        try {
            const context = await browser.newContext({
                viewport: { width: 1280, height: 1000 },
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            const page = await context.newPage();
            await page.goto('https://www.propertyvalue.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });

            const response = await this.resolveSearch(page, suburb);

            if (!Array.isArray(response) || response.length === 0) {
                console.error('[PropertyValueService] No suburb found');
                return null;
            }

            // Prefer category 3 (Suburb), fallback to first result
            const match = response.find((r: any) => r.data.category === "3") || response[0];
            
            // Construct URL: Name-Postcode-State (e.g., Nagambie-3608-VIC)
            const parts = match.value.split(' ');
            const postcode = parts[parts.length - 1];
            const state = parts[parts.length - 2];
            const name = parts.slice(0, parts.length - 2).join('-');
            const slug = `${name}-${postcode}-${state}`;
            
            const targetUrl = `https://www.propertyvalue.com.au/suburb/${slug}`;
            console.error(`[PropertyValueService] Resolved to URL: ${targetUrl}`);

            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Wait for metrics to be populated (optional, sometimes they are static HTML)
            try {
                await page.waitForSelector('#market-trends-metric-box-values', { timeout: 10000 });
            } catch (e) { }

            const html = await page.content();
            const $ = cheerio.load(html);

            const metrics = {
                medianValue: $('#metric-box-1').text().trim(),
                propertiesSold: $('#metric-box-2').text().trim(),
                medianRent: $('#metric-box-3').text().trim(),
                medianGrossYield: $('#metric-box-4').text().trim(),
                avgDaysOnMarket: $('#metric-box-5').text().trim(),
                avgVendorDiscount: $('#metric-box-6').text().trim(),
                medianPriceChange1yr: $('#metric-box-7').text().trim(),
            };

            const description = $('.suburbInfo_description_bsg').text().trim().replace(/\s+/g, ' ');

            return {
                source: 'PropertyValue.com.au (CoreLogic)',
                sources: [{ name: 'PropertyValue.com.au (CoreLogic)', url: targetUrl }], // Populate sources
                suburb: match.value,
                description,
                metrics,
                url: targetUrl
            };

        } catch (e: any) {
            console.error(`[PropertyValueService] Error: ${e.message}`);
            return null;
        } finally {
            await browser.close();
        }
    }
}