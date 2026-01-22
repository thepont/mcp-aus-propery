import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';
import { SuburbTrend } from '../types.js';

// @ts-ignore
chromium.use(StealthPlugin());

export class MarketService {
    
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

    private async resolveSuburbMetadata(page: any, suburb: string): Promise<{ state: string, postcode: string, yipSlug: string, pvValue: string } | null> {
        const searchString = encodeURIComponent(suburb);
        const apiUrl = `https://www.propertyvalue.com.au/?op=myrp_widgets.freemiumInvestorSLAS.singleLineSearchHandler&subop=getSuggestionList&searchCategories=1%2C2%2C3%2C4&searchString=${searchString}&maxSuggestionResults=5`;
        
        try {
            const response = await page.evaluate(async (url: string) => {
                const res = await fetch(url, {
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                return res.json();
            }, apiUrl);

            if (Array.isArray(response) && response.length > 0) {
                const match = response.find((r: any) => r.data.category === "3") || response[0];
                const pvValue = match.value;
                
                const parts = pvValue.split(' ');
                const postcode = parts[parts.length - 1];
                const state = parts[parts.length - 2].toLowerCase();
                const suburbName = parts.slice(0, parts.length - 2).join(' ');

                const yipSlug = `${postcode}-${suburbName.toLowerCase().replace(/\s+/g, '-')}`;
                return { state, postcode, yipSlug, pvValue };
            }
        } catch (e: any) {
            console.error(`[MarketService] Failed to resolve suburb metadata via PropertyValue API: ${e.message}`);
        }
        return null;
    }

    async getSuburbTrends(suburb: string): Promise<SuburbTrend[]> {
        const results: SuburbTrend[] = [];
        console.error(`[MarketService] Resolving trends for: ${suburb}`);
        
        const browser = await this.launchBrowser();

        try {
            const page = await browser.newPage();
            await page.goto('https://www.propertyvalue.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 });

            const suburbMetadata = await this.resolveSuburbMetadata(page, suburb);

            if (!suburbMetadata) {
                console.error(`[MarketService] Could not resolve metadata for suburb: ${suburb}`);
                return results;
            }

            // 1. Fetch Domain Trends
            console.error(`[MarketService] Resolving Domain slug for: ${suburb}`);
            const domainSlug = await this.resolveDomainSlug(suburbMetadata.pvValue);
            if (domainSlug) {
                const domainData = await this.fetchDomainTrends(browser, domainSlug);
                if (domainData) {
                    console.error(`[MarketService] Domain data fetched successfully.`);
                    results.push(domainData);
                }
            } else {
                console.error(`[MarketService] Could not resolve Domain slug for: ${suburb}`);
            }

            // 2. Fetch YIP (CoreLogic via YIP page) Trends
            console.error(`[MarketService] Fetching YIP/CoreLogic trends for: ${suburb}`);
            const yipData = await this.fetchYIPTrends(browser, suburbMetadata);
            if (yipData) {
                console.error(`[MarketService] YIP/CoreLogic data fetched successfully.`);
                results.push(yipData);
            } else {
                console.error(`[MarketService] Failed to fetch YIP/CoreLogic trends for: ${suburb}`);
            }

        } catch (e: any) {
            console.error('[MarketService] Error fetching trends:', e.message);
        } finally {
            await browser.close();
        }

        return results;
    }

    private async resolveDomainSlug(suburbFullAddress: string): Promise<string | null> {
        try {
            const url = `https://www.domain.com.au/phoenix/api/locations/autocomplete/v2?prefixText=${encodeURIComponent(suburbFullAddress)}`;
            const config: any = { timeout: 10000 };
            const proxy = process.env.HTTP_PROXY;
            if (proxy) config.httpsAgent = new HttpsProxyAgent(proxy);

            const res = await axios.get(url, config);
            if (res.data && res.data.length > 0) {
                return res.data[0].value;
            }
        } catch (e) {
            console.error(`[MarketService] Domain autocomplete failed: ${e.message}`);
        }
        return null;
    }

    private async fetchDomainTrends(browser: any, slug: string): Promise<SuburbTrend | null> {
        const url = `https://www.domain.com.au/suburb-profile/${slug}`;
        console.error(`[MarketService] Fetching Domain trends: ${url}`);
        
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(3000);

            const data = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tbody[data-testid="insight"] tr'));
                const medianPrices = rows.map(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 6) return null;
                    return {
                        bedrooms: cells[0].textContent?.trim(),
                        type: cells[1].textContent?.trim(),
                        medianPrice: cells[2].textContent?.trim(),
                        daysOnMarket: cells[3].textContent?.trim(),
                        clearanceRate: cells[4].textContent?.trim(),
                        soldThisYear: cells[5].textContent?.trim()
                    };
                }).filter(Boolean);

                const performance = Array.from(document.querySelectorAll('[data-testid="market-performance-stat"]')).map(el => ({
                    label: el.querySelector('[data-testid="market-performance-label"]')?.textContent?.trim(),
                    value: el.querySelector('[data-testid="market-performance-value"]')?.textContent?.trim()
                }));

                return { medianPrices, performance };
            });

            return {
                source: 'Domain',
                sources: [{ name: 'Domain.com.au', url: url }],
                suburb: slug,
                description: "", // Domain doesn't easily provide a suburb description in the main view
                medianPrices: data.medianPrices,
                marketPerformance: data.performance,
                url
            };
        } catch (e: any) {
            console.error(`[MarketService] Domain fetch failed: ${e.message}`);
            return null;
        } finally {
            await page.close();
        }
    }

    private async fetchYIPTrends(browser: any, metadata: { state: string, postcode: string, yipSlug: string, pvValue: string }): Promise<SuburbTrend | null> {
        const url = `https://www.yourinvestmentpropertymag.com.au/top-suburbs/${metadata.state}/${metadata.yipSlug}`;
        console.error(`[MarketService] Fetching YIP Trends from: ${url}`);

        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            const coreLogicData = await page.evaluate(() => {
                const yipChartsElement = document.querySelector('yip-charts');
                if (yipChartsElement) {
                    return {
                        token: yipChartsElement.getAttribute('token'),
                        localityId: yipChartsElement.getAttribute('locality-id')
                    };
                }
                return null;
            });

            if (!coreLogicData || !coreLogicData.token || !coreLogicData.localityId) {
                console.error('[MarketService] Failed to extract CoreLogic token or localityId from YIP page.');
                return null;
            }

            const coreLogicApiUrl = 'https://api.corelogic.asia/statistics/v1/statistics.json';
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-AU,en;q=0.9,fr;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Authorization': `Bearer ${coreLogicData.token}`,
                'Content-Type': 'application/json',
                'Origin': 'https://www.yourinvestmentpropertymag.com.au',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Referer': url,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site'
            };

            const payload = {
                seriesRequestList: [
                    // Median Price (Value) - 11
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 11, "propertyTypeId": 1 },
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 11, "propertyTypeId": 2 },
                    // 12-month growth (Median Price Change) - 69
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 69, "propertyTypeId": 1 },
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 69, "propertyTypeId": 2 },
                    // Weekly median rent - 49
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 49, "propertyTypeId": 1 },
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 49, "propertyTypeId": 2 },
                    // Gross rental yield - 10
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 10, "propertyTypeId": 1 },
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 10, "propertyTypeId": 2 },
                    // Number of Sales (12m) - 37
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 37, "propertyTypeId": 1 },
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 37, "propertyTypeId": 2 },
                    // Avg. Days on Market (12m) - 32
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 32, "propertyTypeId": 1 },
                    { "interval": 1, "fromDate": "2024-01-01", "toDate": "2026-12-31", "locationId": coreLogicData.localityId, "locationTypeId": 8, "metricTypeId": 32, "propertyTypeId": 2 }
                ]
            };

            const config: any = { headers: headers, timeout: 30000 };
            const proxy = process.env.HTTP_PROXY;
            if (proxy) config.httpsAgent = new HttpsProxyAgent(proxy);

            const coreLogicResponse = await axios.post(coreLogicApiUrl, payload, config);
            const coreLogicMetrics = coreLogicResponse.data;
            
            // Process original YIP page for any additional data (e.g. static text, overview)
            const $ = cheerio.load(await page.content());
            const yipSummary = $('.article-content p').first().text().trim();
            
            return {
                source: 'Your Investment Property (CoreLogic API)',
                sources: [{ name: 'Your Investment Property (CoreLogic API)', url: url }],
                suburb: metadata.pvValue,
                description: yipSummary,
                medianPrices: [], 
                marketPerformance: [],
                url: url,
                coreLogicMetrics: coreLogicMetrics
            };

        } catch (e: any) {
            console.error(`[MarketService] YIP/CoreLogic API fetch failed: ${e.message}`);
            return null;
        } finally {
            await page.close();
        }
    }
}