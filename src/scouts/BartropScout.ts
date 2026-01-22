import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing, PropertyType, ListingType } from '../types.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';

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
  readonly relevanceArea = { lat: -37.5622, lon: 143.8503, radiusKm: 50 };
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
    
    // Bartrop search URL - Use general page as 'search=' param is strict/buggy
    const type = criteria.listingType === 'rental' ? 'rent' : 'buy';
    const searchUrl = `${this.siteUrl}/${type}`;
    
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

      const listings: IndustrialListing[] = [];

      // Extract JSON data directly from the script tag
      const jsonData = await page.evaluate(() => {
        const scriptContent = Array.from(document.querySelectorAll('script')).find(script => script.textContent?.includes('var data = {"type":"FeatureCollection"'));
        if (scriptContent) {
          const match = scriptContent.textContent?.match(/var data = ({.*?});/s);
          if (match && match[1]) {
            return JSON.parse(match[1]);
          }
        }
        return null;
      });

      if (jsonData && jsonData.features && Array.isArray(jsonData.features)) {
        for (const feature of jsonData.features) {
          if (feature.properties && feature.properties.ideas && Array.isArray(feature.properties.ideas)) {
            for (const idea of feature.properties.ideas) {
              // Extract details from the idea object
              const address = idea.address || 'Address Unavailable';
              const priceDisplay = idea.price || '';
              const url = idea.path.startsWith('http') ? idea.path : `${this.siteUrl}${idea.path}`;

              let price: number | undefined;
              if (priceDisplay) {
                  const match = priceDisplay.match(/\$?([\d,]+)/);
                  if (match) price = parseInt(match[1].replace(/,/g, ''), 10);
              }

              const listing: IndustrialListing = {
                  address: address,
                  description: idea.title || 'Bartrop Listing',
                  sourceUrl: url,
                  source: this.name,
                  price,
                  priceDisplay,
                  propertyType: 'residential', // Default for Bartrop, can be refined from idea.type
                  listingType: criteria.listingType || 'sale',
                  metadata: {
                      id: idea.id,
                      bedrooms: idea.bedrooms,
                      bathrooms: idea.bathrooms,
                      area: idea.area,
                      car: idea.car,
                      lat: idea.latitude || -37.5622, // Default to Ballarat if not in data
                      lon: idea.longitude || 143.8503, // Default to Ballarat if not in data
                      suburb: 'Ballarat' // Bartrop is Ballarat focused
                  },
                  sources: [{ name: this.name, url: url }]
              };
              listings.push(listing);
            }
          }
        }
      }

      console.error(`[${this.name}] Targeted search found ${listings.length} properties from JSON data.`);

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

  // fetchPropertyDetails is used by backgroundSync. It uses axios, not Playwright.
  // This method extracts data from individual property pages (not search results).
  private async fetchPropertyDetails(context: any, url: string): Promise<IndustrialListing | null> {
    console.error(`[${this.name}] Extracting single property page: ${url}`);
    let page: Page | null = null;

    try {
        const proxy = this.getProxyConfig();
        const axiosConfig: any = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        };
        if (proxy) axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);

        const response = await axios.get(url, axiosConfig);

        const $ = cheerio.load(response.data);
        
        // Extract JSON-LD (if available) - this method is generic, so it tries multiple approaches
        let jsonLd: any = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const json = JSON.parse($(el).html() || '{}');
                // We want RealEstateListing or Residence
                if (json['@type'] === 'RealEstateListing' || json['@type'] === 'Residence' || json['@type'] === 'SingleFamilyResidence') {
                    jsonLd = json;
                }
            } catch (e) {}
        });

        if (jsonLd) {
            // Logic to parse JSON-LD into IndustrialListing
            const address = jsonLd.name || jsonLd.contentLocation?.name || 'Address Unavailable';
            const description = jsonLd.description || '';
            const price = typeof jsonLd.offers?.price === 'number' ? jsonLd.offers.price : undefined;
            const priceDisplay = jsonLd.offers?.priceCurrency ? `${jsonLd.offers.priceCurrency} ${jsonLd.offers.price}` : jsonLd.offers?.priceSpecification?.price;

            let lat: number | undefined;
            let lon: number | undefined;
            if (jsonLd.geo) {
                lat = parseFloat(jsonLd.geo.latitude);
                lon = parseFloat(jsonLd.geo.longitude);
            }

            return {
                address: address,
                description: description,
                sourceUrl: url,
                source: this.name,
                price,
                priceDisplay,
                propertyType: 'residential', // Default or infer from JSON-LD
                listingType: url.includes('/rent') ? 'rental' : 'sale', // Infer from URL
                metadata: {
                    lat: lat || -37.5622,
                    lon: lon || 143.8503,
                    suburb: this.extractSuburb(address) // Extract suburb from address
                },
                sources: [{ name: this.name, url: url }]
            };
        }

        // Fallback to HTML extraction (existing logic) if no JSON-LD
        let address = '';
        const title = $('title').text();
        if (title) {
          const parts = title.split('|');
          if (parts.length > 0) address = parts[0].trim();
        }
        let description = $('h1.pageTitle, h1').text().trim();
        let priceDisplay = $('meta[property="og:price"], meta[name="price"]').attr('content') || '';
        if (!priceDisplay) {
          const priceSelectors = ['.property-price', '[class*="price"]', '.price-display', '.figCaption div']; // Added figCaption
          for (const selector of priceSelectors) {
            const el = $(selector);
            if (el && el.text()) {
              priceDisplay = el.text().trim();
              if (priceDisplay.includes('$') || priceDisplay.toLowerCase().includes('contact')) break;
            }
          }
        }
        if (!description || description.length < 20) {
          const descSelectors = ['.property-description', '[class*="description"]', '.property-content', 'article'];
          for (const selector of descSelectors) {
            const el = $(selector);
            if (el && el.text()) {
              const text = el.text().trim();
              if (text.length > 50) { description = text; break; }
            }
          }
        }
        let category = '';
        const categorySelectors = ['.property-type', '.property-category', '[class*="category"]'];
        for (const selector of categorySelectors) {
          const el = $(selector);
          if (el && el.text()) { category = el.text().trim(); break; }
        }

        if (!address || address.length < 5) {
            console.warn(`[${this.name}] Insufficient data for ${url} via HTML extraction`);
            return null;
        }

        let priceHtml: number | undefined;
        if (priceDisplay) {
            const matches = priceDisplay.match(/\$?([\d,]+)/);
            if (matches) {
                const num = parseInt(matches[1].replace(/,/g, ''), 10);
                if (!isNaN(num)) priceHtml = num;
            }
        }
        
        const text = `${description} ${category || ''} ${address}`.toLowerCase();
        let propertyType: PropertyType | undefined;
        if (text.includes('industrial') || text.includes('warehouse') || text.includes('factory')) propertyType = 'industrial';
        else if (text.includes('commercial') || text.includes('office') || text.includes('retail')) propertyType = 'commercial';
        else if (text.includes('rural') || text.includes('farm') || text.includes('acreage')) propertyType = 'rural';
        else if (text.includes('land') && !text.includes('landlord')) propertyType = 'land';
        else if (text.includes('house') || text.includes('unit') || text.includes('apartment')) propertyType = 'residential';
        
        const priceText = `${priceDisplay || ''} ${description}`.toLowerCase();
        let listingType: ListingType | undefined;
        if (priceText.includes('for rent') || priceText.includes('for lease') || priceText.includes('pw')) listingType = 'rental';
        else if (priceText.includes('for sale') || priceText.includes('auction')) listingType = 'sale';

        return {
          address: address,
          zoning: category || undefined,
          description: description || `Property at ${address}`,
          sourceUrl: url,
          price: priceHtml,
          priceDisplay: priceDisplay || undefined,
          source: this.name,
          propertyType,
          listingType,
          metadata: { extractedVia: 'html_fallback', sitemapUrl: this.sitemapUrl, category: category, lat: -37.5622, lon: 143.8503 },
          sources: [{ name: this.name, url: url }]
        };

    } catch (error) {
      console.error(`[${this.name}] Error fetching property ${url}:`, error);
      return null;
    } finally {
        if (page && !(page as Page).isClosed()) {
            await (page as Page).close();
        }
    }
  }

  /**
   * Extract suburb from address string
   */
  private extractSuburb(address: string): string {
    const match = address.match(/,\s*([A-Za-z\s]+)\s+(?:VIC|vic)/);
    if (match) {
      return match[1].trim();
    }
    const parts = address.split(/\s+(?:VIC|vic)\s+/);
    if (parts.length > 1) {
      const beforeVic = parts[0].trim();
      const words = beforeVic.split(/\s+/);
      return words.slice(-2).join(' ');
    }
    return 'Ballarat';
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
}