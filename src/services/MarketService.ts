import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { GnafService } from './GnafService.js';

// @ts-ignore
chromium.use(StealthPlugin());

export interface SuburbTrend {
    source: string;
    suburb: string;
    medianPrices: any[];
    marketPerformance?: any[];
    growth?: any;
    rent?: any;
    url: string;
}

export class MarketService {
    private gnafService: GnafService;

    constructor() {
        this.gnafService = new GnafService();
    }

    private getProxyConfig() {
        const proxyUrl = process.env.HTTP_PROXY;
        if (!proxyUrl) return null;
        return { server: proxyUrl };
    }

    async getSuburbTrends(suburb: string): Promise<SuburbTrend[]> {
        const results: SuburbTrend[] = [];
        console.error(`[MarketService] Resolving trends for: ${suburb}`);
        
        const browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox'],
            proxy: this.getProxyConfig() || undefined
        });

        try {
            // 1. Resolve Domain Slug
            console.error(`[MarketService] Resolving Domain slug for: ${suburb}`);
            const domainSlug = await this.resolveDomainSlug(suburb);
            console.error(`[MarketService] Domain slug resolved to: ${domainSlug}`);
            if (domainSlug) {
                const domainData = await this.fetchDomainTrends(browser, domainSlug);
                if (domainData) {
                    console.error(`[MarketService] Domain data fetched successfully.`);
                    results.push(domainData);
                }
            }

            // 2. Resolve YIP Data
            console.error(`[MarketService] Resolving YIP metadata for: ${suburb}`);
            const metadata = await this.gnafService.getSuburbMetadata(suburb);
            console.error(`[MarketService] YIP metadata: ${JSON.stringify(metadata)}`);
            if (metadata) {
                const yipData = await this.fetchYIPTrends(browser, metadata);
                if (yipData) {
                    console.error(`[MarketService] YIP data fetched successfully.`);
                    results.push(yipData);
                }
            }

        } catch (e: any) {
            console.error('[MarketService] Error fetching trends:', e.message);
        } finally {
            await browser.close();
        }

        return results;
    }

    private async resolveDomainSlug(suburb: string): Promise<string | null> {
        try {
            const url = `https://www.domain.com.au/phoenix/api/locations/autocomplete/v2?prefixText=${encodeURIComponent(suburb)}`;
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

        // Fallback: Use G-NAF metadata to build a probable slug
        const metadata = await this.gnafService.getSuburbMetadata(suburb);
        if (metadata) {
            const slug = `${metadata.suburb.toLowerCase().replace(/\s+/g, '-')}-${metadata.state}-${metadata.postcode}`;
            console.error(`[MarketService] Using fallback Domain slug: ${slug}`);
            return slug;
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
                suburb: slug,
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

    private async fetchYIPTrends(browser: any, metadata: { suburb: string, state: string, postcode: string }): Promise<SuburbTrend | null> {
        // YIP URL: https://www.yourinvestmentpropertymag.com.au/top-suburbs/vic/3156-ferntree-gully
        const slug = `${metadata.postcode}-${metadata.suburb.toLowerCase().replace(/\s+/g, '-')}`;
        const url = `https://www.yourinvestmentpropertymag.com.au/top-suburbs/${metadata.state}/${slug}`;
        console.error(`[MarketService] Fetching YIP trends: ${url}`);

        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(3000);

            const data = await page.evaluate(() => {
                const table = document.querySelector('table');
                if (!table) return null;

                const rows = Array.from(table.querySelectorAll('tr'));
                const headers = Array.from(rows[0].querySelectorAll('th, td')).map(h => h.textContent?.trim());
                
                const stats = rows.slice(1).map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const label = cells[0]?.textContent?.trim();
                    const houseValue = cells[1]?.textContent?.trim();
                    const unitValue = cells[2]?.textContent?.trim();
                    return { label, houseValue, unitValue };
                });

                return { stats };
            });

            if (!data) return null;

            return {
                source: 'Your Investment Property',
                suburb: metadata.suburb,
                medianPrices: data.stats,
                url
            };
        } catch (e: any) {
            console.error(`[MarketService] YIP fetch failed: ${e.message}`);
            return null;
        } finally {
            await page.close();
        }
    }
}