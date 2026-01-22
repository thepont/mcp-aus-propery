import { BaseScout, IndustrialListing, SearchParams } from '../types.js';
import { GnafService } from '../services/GnafService.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { devices } from 'playwright';

interface DomainState {
  scanId: string;
  queue: string[];
  totalCount: number;
  lastRun: string;
}

export class DomainScout extends BaseScout {
  readonly name = 'domain';
  private gnafService: GnafService;
  private readonly SITEMAP_URL = 'https://www.domain.com.au/sitemap-listings-sale.xml';
  private readonly STATE_FILE = 'data/domain_state.json';
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  constructor() {
    super();
    this.gnafService = new GnafService(); // Connects to ./data/mcp.db via Singleton
  }

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  /**
   * Domain-specific high-stealth context (Mobile)
   */
  private async createHighStealthContext(browser: any): Promise<any> {
      // Choose a realistic mobile device profile
      const mobileDevices = ['iPhone 13', 'iPhone 14', 'Pixel 7'];
      const deviceName = mobileDevices[Math.floor(Math.random() * mobileDevices.length)];
      const deviceProfile = devices[deviceName];

      // Generate a fingerprint that matches the device type
      const fingerprintData = (this as any).constructor.fingerprintGenerator.getFingerprint({
          devices: ['mobile'],
          browsers: [deviceName.includes('iPhone') ? 'safari' : 'chrome'],
          locales: ['en-AU'],
      });

      const { fingerprint } = fingerprintData as any;

      const context = await browser.newContext({
          ...deviceProfile,
          userAgent: fingerprint.navigator.userAgent,
          locale: 'en-AU',
          timezoneId: 'Australia/Sydney',
          ignoreHTTPSErrors: true
      });

      // Inject the advanced hardware fingerprint
      await (this as any).constructor.fingerprintInjector.attachFingerprintToPlaywright(context, fingerprintData);
      
      return context;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    const isGeneralSync = !criteria.location || criteria.location === 'Any';
    
    if (isGeneralSync) {
      return this.backgroundSync(criteria);
    } else {
      return this.targetedSearch(criteria);
    }
  }

  /**
   * Background sync logic (G-NAF based)
   */
  private async backgroundSync(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error('[Domain] Starting background sync...');
    let state = this.loadState();

    if (!state.scanId) {
        state.scanId = crypto.randomUUID();
        console.error(`[Domain] Starting new scan session: ${state.scanId}`);
    }

    if (state.queue.length === 0) {
        console.error('[Domain] Queue empty. Fetching fresh sitemap...');
        const urls = await this.fetchSitemapUrls();
        if (urls.length > 0) {
            state.queue = urls;
            state.totalCount = urls.length;
        } else {
            return [];
        }
    }
    
    const listings: IndustrialListing[] = [];
    let matchCount = 0;
    const total = state.totalCount || state.queue.length;
    const currentProcessed = total - state.queue.length;
    this.logProgress(currentProcessed, total);

    const BATCH_SIZE = 50; 
    const batch = state.queue.splice(0, BATCH_SIZE);

    for (const url of batch) {
      const addressData = this.parseUrl(url);
      if (!addressData) continue;

      const gnafPid = await this.gnafService.resolveAddress(addressData.addressString);
      if (gnafPid) {
        await this.gnafService.updateListing(gnafPid, url, undefined, state.scanId);
        matchCount++;
        listings.push({
            address: addressData.addressString,
            source: 'domain',
            sourceUrl: url,
            description: 'Matched G-NAF Property',
            listingType: 'sale',
            metadata: { gnafPid, scanId: state.scanId }
        });
      }
    }

    if (state.queue.length === 0) {
        await this.gnafService.pruneListings('domain', state.scanId);
        state.scanId = ''; 
    }

    this.saveState(state);
    return listings;
  }

  /**
   * Targeted search logic
   */
  private async targetedSearch(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[Domain] Performing targeted search for: ${criteria.location}`);
    
    // User provided URL structure: https://www.domain.com.au/sale/?excludeunderoffer=1&suburb=ballarat-central-vic-3350
    const locationSlug = criteria.location.toLowerCase().replace(/,\s*/g, '-').replace(/\s+/g, '-');
    const baseUrl = `https://www.domain.com.au/sale/`;
    
    const params = new URLSearchParams();
    params.append('excludeunderoffer', '1');
    params.append('suburb', locationSlug);
    
    const propertyType = criteria.propertyType === 'residential' ? 'house' : (criteria.propertyType || 'industrial');
    params.append('ptype', propertyType);
    
    if (criteria.maxPrice) params.append('price', `0-${criteria.maxPrice}`);

    const searchUrl = `${baseUrl}?${params.toString()}`;
    console.error(`[Domain] Fetching URL: ${searchUrl}`);
    
    try {
      const proxy = this.getProxyConfig();
      
      if (!this.browser) {
          const { chromium } = await import('playwright-extra');
          this.browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            proxy: proxy ? { server: proxy.server } : undefined
          });
          this.isSharedBrowser = false;
      }

      const context = await this.createHighStealthContext(this.browser);
      const page = await context.newPage();

      console.error(`[Domain] Navigating to: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for results
      try {
          await page.waitForSelector('[data-testid="listing-card"], .listing-result', { timeout: 20000 });
      } catch (e) {
          console.error(`[Domain] Timeout waiting for listing cards.`);
      }

      const listings = await page.evaluate(() => {
          const results: any[] = [];
          // Mobile might have different selectors, let's be broad
          const cards = document.querySelectorAll('[data-testid="listing-card"], .listing-result, [class*="PropertyCard"]');
          cards.forEach(el => {
              const address = el.querySelector('[data-testid="address-wrapper"], [class*="Address"]')?.textContent?.trim();
              const link = el.querySelector('a')?.getAttribute('href');
              const price = el.querySelector('[data-testid="listing-card-price"], [class*="Price"]')?.textContent?.trim();
              
              if (address && link) {
                  results.push({
                      address,
                      url: link.startsWith('http') ? link : `https://www.domain.com.au${link}`,
                      priceDisplay: price
                  });
              }
          });
          return results;
      });

      if (listings.length === 0) {
          const title = await page.title();
          const content = await page.content();
          console.error(`[Domain] DEBUG: Title="${title}", Content Length: ${content.length}`);
          if (content.includes('unusual traffic') || content.includes('Captcha')) {
              console.error(`[Domain] 🛑 BLOCK DETECTED (Captcha/Traffic)`);
          }
      }

      if (!this.isSharedBrowser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await page.close();
          await context.close();
      }

      console.error(`[Domain] Targeted search found ${listings.length} listings.`);
      return listings.map(l => ({
          address: l.address,
          source: this.name,
          sourceUrl: l.url,
          description: 'On-demand search result',
          priceDisplay: l.priceDisplay
      }));

    } catch (error: any) {
      console.error(`[Domain] Targeted search failed:`, error.message);
      return [];
    }
  }

  private loadState(): DomainState {
    if (fs.existsSync(this.STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(this.STATE_FILE, 'utf-8'));
      if (s.totalCount === undefined) s.totalCount = s.queue.length;
      return s;
    }
    return { scanId: '', queue: [], totalCount: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: DomainState): void {
    state.lastRun = new Date().toISOString();
    if (!fs.existsSync('data')) fs.mkdirSync('data');
    fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2));
  }

  private async fetchSitemapUrls(): Promise<string[]> {
    try {
      // Logic to fetch recursive sitemaps if this is an index, 
      // but 'sitemap-listings-sale.xml' is often a flat list or split by date.
      // We'll assume it's a list for now or handled via recursion if needed.
      const response = await axios.get(this.SITEMAP_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
      });
      
      const parser = new XMLParser();
      const result = parser.parse(response.data);
      const urls: string[] = [];
      
      const urlSet = result.urlset?.url || [];
      if (Array.isArray(urlSet)) {
        urlSet.forEach((u: any) => urls.push(u.loc));
      } else if (urlSet.loc) {
        urls.push(urlSet.loc);
      }
      
      return urls;
    } catch (error) {
      console.error('[Domain] Sitemap fetch failed:', error);
      return [];
    }
  }

  private parseUrl(url: string): { addressString: string, id: string } | null {
    try {
      // Example: https://www.domain.com.au/23-some-street-suburb-nsw-2000-2018829332
      const match = url.match(/domain\.com\.au\/(.+)-(\d+)$/);
      if (match) {
        const slug = match[1];
        const id = match[2];
        // Convert slug to address string: "23-some-street-suburb-nsw-2000" -> "23 some street suburb nsw 2000"
        const addressString = slug.replace(/-/g, ' '); 
        return { addressString, id };
      }
    } catch (e) { }
    return null;
  }

  async cleanup(): Promise<void> {
    if (this.browser && !this.isSharedBrowser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}