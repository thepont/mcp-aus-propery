/**
 * PRD Ballarat Scout - Sitemap-based property extraction
 * 
 * Technology: Django/Python server-side rendering with comprehensive sitemap
 * Sitemap: https://www.prd.com.au/ballarat/sitemap-listings.xml
 * Properties: 8,317 listings in sitemap (all property types)
 * 
 * Strategy: XML sitemap parsing → Structured metadata extraction → HTML scraping fallback
 * Priority: <title> tags → <h1> tags → meta tags → HTML selectors
 * 
 * Structured Data Available:
 * - <title> tag: Address extraction
 * - <h1 class="page__title">: Property title/description
 * - <meta> tags: OpenGraph and standard meta
 * - No JSON-LD, JSONP, or API endpoints (confirmed via investigation)
 * 
 * Performance: ~2 seconds per property page extraction, batch processing (5 concurrent)
 * Coverage: Ballarat region (Victoria) - sales and rentals, all property types
 */

import { BaseScout, IndustrialListing, SearchParams, PropertyType, ListingType } from '../types.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium, Browser, Page } from 'playwright';
import fs from 'fs';
import path from 'path';

interface PRDState {
  queue: string[];
  totalDiscovered: number;
  lastRun: string;
}

export class PRDBallaratScout extends BaseScout {
  name = 'PRD Ballarat';
  private sitemapUrl = 'https://www.prd.com.au/ballarat/sitemap-listings.xml';
  private readonly STATE_FILE = 'data/prd_ballarat_state.json';
  private browser: Browser | null = null;

  async search(params: SearchParams): Promise<IndustrialListing[]> {
    try {
      // Ensure data directory
      if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });

      let state = this.loadState();
      
      // Step 1: Initialize/Refill Queue if empty
      if (state.queue.length === 0) {
        console.log(`[PRDBallaratScout] Queue empty. Fetching fresh sitemap from ${this.sitemapUrl}...`);
        const propertyUrls = await this.getPropertyUrlsFromSitemap();
        console.log(`[PRDBallaratScout] Found ${propertyUrls.length} property URLs in sitemap`);
        state.queue = propertyUrls;
        state.totalDiscovered = propertyUrls.length;
        this.saveState(state);
      }

      // Process a batch (default: 20)
      const limit = 20;
      const urlsToProcess = state.queue.splice(0, limit);
      console.log(`[PRDBallaratScout] Processing ${urlsToProcess.length} properties from queue. Remaining: ${state.queue.length}`);

      if (urlsToProcess.length === 0) {
        console.log('[PRDBallaratScout] No more properties in queue.');
        return [];
      }

      // Step 2: Launch browser for scraping
      const proxy = this.getProxyConfig();
      if (proxy) console.log(`[${this.name}] Using Playwright proxy: ${proxy.server}`);
      
      this.browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        proxy: proxy ? { server: proxy.server } : undefined
      });

      // Step 3: Process properties sequentially for organic appearance
      const listings: IndustrialListing[] = [];

      for (let i = 0; i < urlsToProcess.length; i++) {
        const url = urlsToProcess[i];
        
        // Report overall progress
        const processedTotal = state.totalDiscovered - state.queue.length - (urlsToProcess.length - i);
        this.logProgress(processedTotal, state.totalDiscovered);

        await this.waitOrganic();
        
        try {
          const listing = await this.extractPropertyFromPage(url);
          if (listing) {
            listings.push(listing);
          }
        } catch (error) {
          console.error(`[PRDBallaratScout] Failed to extract property from ${url}:`, error);
        }
      }

      // Step 4: Save state and Cleanup
      this.saveState(state);

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      console.log(`[PRDBallaratScout] Successfully extracted ${listings.length} properties`);
      return listings;

    } catch (error) {
      // Ensure browser cleanup on error
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      console.error('[PRDBallaratScout] Error during search:', error);
      throw error;
    }
  }

  private loadState(): PRDState {
    if (fs.existsSync(this.STATE_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(this.STATE_FILE, 'utf-8'));
      } catch (e) {
        console.error(`[PRDBallaratScout] Failed to load state file:`, e);
      }
    }
    return { queue: [], totalDiscovered: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: PRDState): void {
    state.lastRun = new Date().toISOString();
    try {
      fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error(`[PRDBallaratScout] Failed to save state file:`, e);
    }
  }


  /**
   * Fetch and parse sitemap XML to extract property URLs
   */
  private async getPropertyUrlsFromSitemap(): Promise<string[]> {
    const response = await axios.get(this.sitemapUrl);
    const parser = new XMLParser();
    const parsed = parser.parse(response.data);

    const urls: string[] = [];
    
    if (parsed.urlset && parsed.urlset.url) {
      const urlEntries = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
      
      for (const entry of urlEntries) {
        const loc = entry.loc;
        // Filter for actual property listings (exclude category pages like /forsale/ and /rentals/)
        if (loc && loc.includes('/property-search/') && /\/property-search\/\d+\//.test(loc)) {
          urls.push(loc);
        }
      }
    }

    return urls;
  }

  /**
   * Extract property data from individual property page
   * Priority: Structured metadata → HTML selectors (fallback)
   */
  private async extractPropertyFromPage(url: string): Promise<IndustrialListing | null> {
    const page: Page = await this.browser!.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Extract property data using structured metadata first, then HTML selectors
      const propertyData = await page.evaluate(() => {
        // Priority 1: Extract from <title> tag (most reliable)
        const title = document.querySelector('title')?.textContent || '';
        const titleParts = title.split('|');
        const addressFromTitle = titleParts[0]?.trim() || '';

        // Priority 2: Extract from <h1> tag (property title/description)
        const h1Element = document.querySelector('h1.page__title, h1');
        const description = h1Element?.textContent?.trim() || '';

        // Priority 3: Check meta tags for additional data
        const ogPrice = document.querySelector('meta[property="og:price"]')?.getAttribute('content');
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');

        // Priority 4: HTML selectors (fallback)
        // Price extraction
        const priceElement = document.querySelector('.property-detail__price, .price, [class*="price"]');
        const priceFromHTML = priceElement?.textContent?.trim() || '';

        // Category/type extraction
        const typeElement = document.querySelector('.property-detail__type, .property-type, [class*="type"]');
        const category = typeElement?.textContent?.trim() || '';

        // Property details extraction
        const addressElement = document.querySelector('.property-detail__address, .address, [class*="address"]');
        const addressFromHTML = addressElement?.textContent?.trim() || '';

        // Use most reliable source for each field
        return {
          address: addressFromTitle || addressFromHTML || description,
          description: description,
          priceDisplay: ogPrice || priceFromHTML,
          category: category,
          imageUrl: ogImage
        };
      });

      await page.close();

      // Only return if we got meaningful data (at least an address)
      if (!propertyData.address || propertyData.address.length < 5) {
        console.warn(`[PRDBallaratScout] Insufficient data for ${url}`);
        return null;
      }

      // Parse price if possible
      let price: number | undefined;
      if (propertyData.priceDisplay) {
        const matches = propertyData.priceDisplay.match(/\$?([\d,]+)/);
        if (matches) {
          const numStr = matches[1].replace(/,/g, '');
          const num = parseInt(numStr, 10);
          if (!isNaN(num)) {
            price = num;
          }
        }
      }

      // Determine property type and listing type
      const propertyType = this.determinePropertyType(propertyData.category, propertyData.description, propertyData.priceDisplay);
      const listingType = this.determineListingType(url, propertyData.priceDisplay);

      // Create listing object
      const listing: IndustrialListing = {
        address: propertyData.address,
        zoning: propertyData.category || undefined,
        description: propertyData.description || `Property at ${propertyData.address}`,
        sourceUrl: url,
        price,
        priceDisplay: propertyData.priceDisplay || undefined,
        source: this.name,
        propertyType,
        listingType,
        metadata: {
          extractedVia: 'sitemap+metadata',
          extractionMethod: 'Structured data: <title> for address, <h1> for description, meta tags, HTML selectors (fallback)',
          sitemapUrl: this.sitemapUrl,
          propertyId: this.extractPropertyId(url),
          category: propertyData.category,
          imageUrl: propertyData.imageUrl,
          suburb: this.extractSuburb(propertyData.address),
          state: 'VIC',
          postcode: this.extractPostcode(propertyData.address),
        }
      };

      return listing;

    } catch (error) {
      await page.close();
      console.error(`[PRDBallaratScout] Error extracting from ${url}:`, error);
      return null;
    }
  }

  /**
   * Extract suburb from address string
   */
  private extractSuburb(address: string): string {
    // PRD format: "2 / 507 Bell Street, Redan VIC 3350" or "507 Bell Street Redan VIC 3350"
    const match = address.match(/,\s*([A-Za-z\s]+)\s+(?:VIC|vic)/);
    if (match) {
      return match[1].trim();
    }

    // Fallback: try to extract suburb before VIC/postcode
    const parts = address.split(/\s+(?:VIC|vic)\s+/);
    if (parts.length > 1) {
      const beforeVic = parts[0].trim();
      const words = beforeVic.split(/\s+/);
      // Last 1-2 words before VIC are likely the suburb
      return words.slice(-2).join(' ');
    }

    return 'Ballarat';
  }

  /**
   * Extract postcode from address string
   */
  private extractPostcode(address: string): string {
    const match = address.match(/\b(3\d{3})\b/);
    return match ? match[1] : '3350';
  }

  /**
   * Extract property ID from URL
   */
  private extractPropertyId(url: string): string {
    const match = url.match(/\/property-search\/(\d+)\//);
    return match ? match[1] : '';
  }

  /**
   * Determine property type from category, description, and price
   */
  private determinePropertyType(category: string, description: string, priceDisplay?: string): PropertyType | undefined {
    const combined = `${category} ${description} ${priceDisplay || ''}`.toLowerCase();

    if (combined.includes('industrial') || combined.includes('warehouse') || combined.includes('factory') ||
        combined.includes('workshop') || combined.includes('storage')) {
      return 'industrial';
    }
    if (combined.includes('commercial') || combined.includes('office') || combined.includes('retail') ||
        combined.includes('shop') || combined.includes('suite') || combined.includes('showroom')) {
      return 'commercial';
    }
    if (combined.includes('rural') || combined.includes('farm') || combined.includes('acreage') ||
        combined.includes('hectare') || combined.includes('lifestyle')) {
      return 'rural';
    }
    if (combined.includes('land') || combined.includes('development site') || combined.includes('block')) {
      return 'land';
    }
    // Residential indicators
    if (combined.includes('house') || combined.includes('home') || combined.includes('bedroom') ||
        combined.includes('unit') || combined.includes('apartment') || combined.includes('townhouse') ||
        combined.includes('villa') || combined.includes('living') || combined.includes('family') ||
        combined.includes('kitchen') || combined.includes('bathroom') || combined.includes('garage') ||
        combined.includes('pw') || combined.includes('per week')) {
      return 'residential';
    }

    return undefined;
  }

  /**
   * Determine listing type (sale vs rental) from URL and price
   */
  private determineListingType(url: string, priceDisplay?: string): ListingType | undefined {
    const urlLower = url.toLowerCase();
    const priceLower = (priceDisplay || '').toLowerCase();

    // Check URL patterns (most reliable)
    if (urlLower.includes('/rental') || urlLower.includes('/rent') || urlLower.includes('/lease') ||
        urlLower.includes('for-rent') || urlLower.includes('for-lease')) {
      return 'rental';
    }
    if (urlLower.includes('/sale') || urlLower.includes('/buy') || urlLower.includes('for-sale')) {
      return 'sale';
    }

    // Check price patterns
    if (priceLower.includes('pw') || priceLower.includes('per week') ||
        priceLower.includes('pcm') || priceLower.includes('per month') ||
        priceLower.includes('for rent') || priceLower.includes('for lease')) {
      return 'rental';
    }
    if (priceLower.includes('for sale') || priceLower.includes('auction') ||
        priceLower.includes('offers') || priceLower.includes('eoi')) {
      return 'sale';
    }

    return undefined;
  }
}
