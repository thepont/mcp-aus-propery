import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing, PropertyType, ListingType } from '../types.js';
import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';

// @ts-ignore
chromium.use(StealthPlugin());

interface ColliersState {
  lastPage: number;
  totalProperties: number;
  lastRun: string;
  isBlocked?: boolean;
}

/**
 * Colliers Australia Scout
 * 
 * Uses Coveo Search API with dynamic token extraction.
 */
export class ColliersScout extends BaseScout {
  readonly name = 'Colliers Australia';
  private readonly siteUrl = 'https://www.colliers.com.au/en-au/properties';
  private readonly searchApiUrl = 'https://www.colliers.com.au/coveo/rest/search/v2';
  
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  protected get stateFile(): string {
    return `data/colliers_state.json`;
  }

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  private async extractToken(): Promise<string | null> {
    console.error(`[${this.name}] Extracting Coveo token with advanced stealth...`);
    
    try {
      const proxy = this.getProxyConfig();
      if (!this.browser) {
        const launchArgs = [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--use-gl=desktop'
        ];

        this.browser = await chromium.launch({ 
          headless: true,
          args: launchArgs,
          proxy: proxy ? { server: proxy.server } : undefined
        });
        this.isSharedBrowser = false;
      }

      const context = await this.createStealthContext(this.browser);
      
      const page = await context.newPage();
      let extractedToken: string | null = null;

      // Intercept token or search requests
      page.on('request', request => {
        const url = request.url();
        const headers = request.headers();
        
        if (headers['authorization'] && (url.includes('coveo') || url.includes('search'))) {
          extractedToken = headers['authorization'];
          // console.log(`[${this.name}] 🔑 Captured token from request`);
        }
      });

      // Explicitly wait for the token response
      const tokenPromise = page.waitForResponse(response => 
        response.url().includes('coveo/rest/token'),
        { timeout: 60000 }
      ).catch(() => null);

      console.error(`[${this.name}] Navigating to properties page...`);
      await page.goto(this.siteUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      
      // Wait for any potential Cloudflare interstitial to pass
      console.error(`[${this.name}] Waiting for page stability/interstitial...`);
      await this.sleep(10000); 
      
      // Human-like behavior: Random movements
      await page.mouse.move(Math.random() * 500, Math.random() * 500);
      await page.mouse.wheel(0, 400);
      await this.sleep(2000);
      await page.mouse.wheel(0, -200);
      
      if (!extractedToken) {
        await tokenPromise;
      }

      // Final check of window object
      if (!extractedToken) {
        extractedToken = await page.evaluate(() => {
          return (window as any).coveoToken || (window as any).Coveo?.accessToken;
        });
      }

      if (!extractedToken) {
        const title = await page.title();
        console.error(`[${this.name}] Token not found. Page title: "${title}"`);
        if (title.includes('Cloudflare') || title.includes('Verify')) {
          console.error(`[${this.name}] 🛑 Cloudflare block detected.`);
        }
      }

      await context.close();
      return extractedToken;
    } catch (error) {
      console.error(`[${this.name}] Token extraction failed:`, error);
      return null;
    }
  }

  private async getToken(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiry) return this.cachedToken;
    
    const token = await this.extractToken();
    if (token) {
      this.cachedToken = token;
      this.tokenExpiry = now + (30 * 60 * 1000); // 30 mins
    }
    return token;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
      const state = this.loadState();

      if (state.isBlocked && state.lastRun) {
        const hoursSinceBlock = (new Date().getTime() - new Date(state.lastRun).getTime()) / (1000 * 60 * 60);
        if (hoursSinceBlock < 1) return [];
        state.isBlocked = false;
      }

      const token = await this.getToken();
      if (!token) throw new Error('No valid token available');

      const isGeneralSync = !criteria.location || criteria.location === 'Any';
      const pageToFetch = isGeneralSync ? state.lastPage : 0;

      console.error(`[${this.name}] Searching Coveo (Page ${pageToFetch})...`);

      const aq = [
        '( @propertyforsaleorleasecomputed=="All Listings" )',
        '( @country==DF3C44166377480A8755A3F6D1358DB4 )',
        '( @hidez32xfromz32xsearch==0 )'
      ];

      if (criteria.location && criteria.location !== 'Any') {
        aq.push(`( @address*="${criteria.location}" OR @suburb*="${criteria.location}" )`);
      }

      const payload = {
        aq: aq.join(' '),
        firstResult: pageToFetch * 30,
        numberOfResults: 30,
        queryPipeline: "default",
        searchHub: "Properties"
      };

      const axiosConfig: any = {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.colliers.com.au/en-au/properties',
          'Origin': 'https://www.colliers.com.au'
        },
        timeout: 30000
      };

      const proxy = this.getProxyConfig();
      if (proxy) {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);
        console.error(`[${this.name}] Using search proxy: ${proxy.server}`);
      }

      await this.waitOrganic();
      const response = await axios.post(this.searchApiUrl, payload, axiosConfig);
      
      const results = response.data.results || [];
      const listings = this.parseCoveoResults(results);

      if (isGeneralSync) {
        state.lastPage = pageToFetch + 1;
        if (results.length === 0 || (response.data.totalCount && state.lastPage * 30 >= response.data.totalCount)) {
          state.lastPage = 0;
        }
        state.totalProperties = response.data.totalCount || state.totalProperties;
        this.saveState(state);
        this.logProgress(state.lastPage * 30, state.totalProperties);
      }

      return listings;

    } catch (error: any) {
      if (error.response?.status === 403) {
        const state = this.loadState();
        state.isBlocked = true;
        this.saveState(state);
      }
      console.error(`[${this.name}] Search failed:`, error.message);
      return [];
    }
  }

  private parseCoveoResults(results: any[]): IndustrialListing[] {
    return results.map(res => {
      const raw = res.raw || {};
      
      let propertyType: PropertyType | undefined;
      const types = (raw.propertyusetypescomputed || '').toLowerCase();
      if (types.includes('industrial') || types.includes('warehouse')) propertyType = 'industrial';
      else if (types.includes('commercial') || types.includes('office')) propertyType = 'commercial';
      else propertyType = 'residential';

      return {
        address: raw.address || raw.title || 'Unknown',
        zoning: raw.zoning || '',
        description: raw.description || raw.excerpt || 'No description',
        sourceUrl: raw.sysclickableuri || res.clickUri || '',
        price: raw.price ? parseFloat(raw.price) : undefined,
        priceDisplay: raw.pricecomputed || '',
        area: raw.totalarea || raw.landarea || '',
        source: this.name,
        sources: [{ name: this.name, url: raw.sysclickableuri || res.clickUri || '' }], // Add sources array
        propertyType,
        listingType: raw.propertyforsaleorleasecomputed?.toLowerCase().includes('rent') ? 'rental' : 'sale',
        metadata: {
          suburb: raw.suburb,
          state: raw.state,
          postcode: raw.postcode,
          coordinates: raw.location ? raw.location.split(',') : undefined
        }
      };
    });
  }

  private loadState(): ColliersState {
    if (fs.existsSync(this.stateFile)) {
      try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')); } catch (e) {}
    }
    return { lastPage: 0, totalProperties: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: ColliersState): void {
    state.lastRun = new Date().toISOString();
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2)); } catch (e) {}
  }

  async cleanup(): Promise<void> {
    if (this.browser && !this.isSharedBrowser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}