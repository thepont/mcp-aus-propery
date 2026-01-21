import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing, PropertyType, ListingType } from '../types.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium, type Browser } from 'playwright';
import fs from 'fs';
import path from 'path';

interface BartropState {
  queue: string[];
  totalDiscovered: number;
  lastRun: string;
}

/**
 * Bartrop Real Estate Scout
 * 
 * Uses sitemap strategy to discover properties:
 * 1. Download sitemap.xml
 * 2. Extract property URLs (pattern: /property?property_id=...)
 * 3. For each URL, fetch and extract property data from structured metadata
 */
export class BartropScout extends BaseScout {
  readonly name = 'Bartrop Real Estate';
  private readonly siteUrl = 'https://www.bartrop.com.au';
  private readonly sitemapUrl = 'https://www.bartrop.com.au/sitemap.xml';
  private STATE_FILE = 'data/bartrop_state.json';
  private browser: Browser | null = null;
  private isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  /**
   * Search for properties using sitemap strategy with watermarking
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    const isGeneralSync = !criteria.location || criteria.location === 'Any';
    
    if (isGeneralSync) {
      return this.backgroundSync(criteria);
    } else {
      return this.targetedSearch(criteria);
    }
  }

  private async backgroundSync(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[${this.name}] Starting sitemap-based background sync...`);
    try {
      if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
      let state = this.loadState();
      
      if (state.queue.length === 0) {
        console.error(`[${this.name}] Queue empty. Fetching fresh sitemap...`);
        const propertyUrls = await this.getPropertyUrlsFromSitemap();
        console.error(`[${this.name}] Found ${propertyUrls.length} property URLs in sitemap`);
        state.queue = propertyUrls;
        state.totalDiscovered = propertyUrls.length;
        this.saveState(state);
      }

      const limit = 20;
      const urlsToFetch = state.queue.splice(0, limit);
      console.error(`[${this.name}] Processing ${urlsToFetch.length} properties from queue. Remaining: ${state.queue.length}`);

      if (urlsToFetch.length === 0) return [];

      const listings: IndustrialListing[] = [];
      const proxy = this.getProxyConfig();
      
      if (!this.browser) {
          this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            proxy: proxy ? { server: proxy.server } : undefined
          });
          this.isSharedBrowser = false;
      }

      const context = await this.createStealthContext(this.browser);

      for (let i = 0; i < urlsToFetch.length; i++) {
        const url = urlsToFetch[i];
        const processedTotal = state.totalDiscovered - state.queue.length - (urlsToFetch.length - i);
        this.logProgress(processedTotal, state.totalDiscovered);

        await this.waitOrganic();

        try {
          const listing = await this.fetchPropertyDetails(context, url);
          if (listing) listings.push(listing);
        } catch (error) {
          console.error(`[Bartrop Real Estate] Failed to fetch property ${url}:`, error);
        }
      }

      this.saveState(state);
      if (!this.isSharedBrowser && this.browser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await context.close();
      }

      return listings;
    } catch (error) {
      console.error(`[${this.name}] Error in background sync:`, error);
      if (this.browser && !this.isSharedBrowser) { await this.browser.close(); this.browser = null; }
      return [];
    }
  }

  private async targetedSearch(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[${this.name}] Performing targeted search for: ${criteria.location}`);
    
    // Bartrop search URL
    const searchUrl = `https://www.bartrop.com.au/search?q=${encodeURIComponent(criteria.location)}`;
    
    try {
      const proxy = this.getProxyConfig();
      
      if (!this.browser) {
          this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            proxy: proxy ? { server: proxy.server } : undefined
          });
          this.isSharedBrowser = false;
      }

      const page = await this.browser.newPage();
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.waitOrganic();

      // Extract URLs from search results
      const urls = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/property?property_id="]'));
        return Array.from(new Set(links.map((a: any) => a.href)));
      });

      console.error(`[${this.name}] Targeted search found ${urls.length} properties.`);

      const listings: IndustrialListing[] = [];
      const context = page.context();
      
      for (const url of urls.slice(0, 5)) {
        await this.waitOrganic();
        const listing = await this.fetchPropertyDetails(context, url);
        if (listing) listings.push(listing);
      }

      if (!this.isSharedBrowser && this.browser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await page.close();
      }

      return listings;
    } catch (error) {
      console.error(`[${this.name}] Targeted search failed:`, error);
      if (this.browser && !this.isSharedBrowser) { await this.browser.close(); this.browser = null; }
      return [];
    }
  }

  private loadState(): BartropState {
    if (fs.existsSync(this.STATE_FILE)) {
      try { return JSON.parse(fs.readFileSync(this.STATE_FILE, 'utf-8')); } catch (e) {}
    }
    return { queue: [], totalDiscovered: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: BartropState): void {
    state.lastRun = new Date().toISOString();
    try { fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {}
  }

  private async getPropertyUrlsFromSitemap(): Promise<string[]> {
    try {
      const response = await axios.get(this.sitemapUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PropertyScout/1.0)' }
      });
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const result = parser.parse(response.data);
      const urls: string[] = [];
      const urlset = result.urlset || result;
      const urlNodes = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
      for (const urlNode of urlNodes) {
        if (urlNode && urlNode.loc && urlNode.loc.includes('/property?property_id=')) {
          urls.push(urlNode.loc);
        }
      }
      return urls;
    } catch (error) {
      console.error(`[${this.name}] Error fetching sitemap:`, error);
      return [];
    }
  }

  private async fetchPropertyDetails(context: any, url: string): Promise<IndustrialListing | null> {
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const propertyData = await page.evaluate(() => {
        let address = '';
        const title = document.querySelector('title')?.textContent || '';
        if (title) {
          const parts = title.split('|');
          if (parts.length > 0) address = parts[0].trim();
        }
        let description = '';
        const h1 = document.querySelector('h1.pageTitle, h1');
        if (h1 && h1.textContent) description = h1.textContent.trim();
        let priceDisplay = '';
        const priceMeta = document.querySelector('meta[property="og:price"], meta[name="price"]');
        if (priceMeta) priceDisplay = priceMeta.getAttribute('content') || '';
        if (!priceDisplay) {
          const priceSelectors = ['.property-price', '[class*="price"]', '.price-display'];
          for (const selector of priceSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              priceDisplay = el.textContent.trim();
              if (priceDisplay.includes('$') || priceDisplay.toLowerCase().includes('contact')) break;
            }
          }
        }
        if (!description || description.length < 20) {
          const descSelectors = ['.property-description', '[class*="description"]', '.property-content', 'article'];
          for (const selector of descSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              const text = el.textContent.trim();
              if (text.length > 50) { description = text; break; }
            }
          }
        }
        let category = '';
        const categorySelectors = ['.property-type', '.property-category', '[class*="category"]'];
        for (const selector of categorySelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) { category = el.textContent.trim(); break; }
        }
        return { address, priceDisplay, description, category };
      });
      await page.close();
      if (!propertyData.address || propertyData.address.length < 5) return null;
      let price: number | undefined;
      if (propertyData.priceDisplay) {
        const matches = propertyData.priceDisplay.match(/\$?([\d,]+)/);
        if (matches) {
          const num = parseInt(matches[1].replace(/,/g, ''), 10);
          if (!isNaN(num)) price = num;
        }
      }
      const text = `${propertyData.description} ${propertyData.category || ''} ${propertyData.address}`.toLowerCase();
      let propertyType: PropertyType | undefined;
      if (text.includes('industrial') || text.includes('warehouse') || text.includes('factory')) propertyType = 'industrial';
      else if (text.includes('commercial') || text.includes('office') || text.includes('retail')) propertyType = 'commercial';
      else if (text.includes('rural') || text.includes('farm') || text.includes('acreage')) propertyType = 'rural';
      else if (text.includes('land') && !text.includes('landlord')) propertyType = 'land';
      else if (text.includes('house') || text.includes('unit') || text.includes('apartment')) propertyType = 'residential';
      const priceText = `${propertyData.priceDisplay || ''} ${propertyData.description}`.toLowerCase();
      let listingType: ListingType | undefined;
      if (priceText.includes('for rent') || priceText.includes('for lease') || priceText.includes('pw')) listingType = 'rental';
      else if (priceText.includes('for sale') || priceText.includes('auction')) listingType = 'sale';
      return {
        address: propertyData.address,
        zoning: propertyData.category || undefined,
        description: propertyData.description || `Property at ${propertyData.address}`,
        sourceUrl: url,
        price,
        priceDisplay: propertyData.priceDisplay || undefined,
        source: this.name,
        propertyType,
        listingType,
        metadata: { extractedVia: 'sitemap+metadata', sitemapUrl: this.sitemapUrl, category: propertyData.category }
      };
    } catch (error) {
      console.error(`[${this.name}] Error fetching property ${url}:`, error);
      return null;
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser && !this.isSharedBrowser) { await this.browser.close(); this.browser = null; }
  }
}
