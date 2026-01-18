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

import { BaseScout, IndustrialListing, SearchParams } from '../types.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium, Browser, Page } from 'playwright';

export class PRDBallaratScout extends BaseScout {
  name = 'PRD Ballarat';
  private sitemapUrl = 'https://www.prd.com.au/ballarat/sitemap-listings.xml';
  private browser: Browser | null = null;

  async search(params: SearchParams): Promise<IndustrialListing[]> {
    try {
      console.log(`[PRDBallaratScout] Fetching sitemap from ${this.sitemapUrl}...`);
      
      // Step 1: Fetch and parse sitemap
      const propertyUrls = await this.getPropertyUrlsFromSitemap();
      console.log(`[PRDBallaratScout] Found ${propertyUrls.length} property URLs in sitemap`);

      // Limit results for performance (default: 50)
      const limit = 50;
      const urlsToProcess = propertyUrls.slice(0, limit);
      console.log(`[PRDBallaratScout] Processing ${urlsToProcess.length} properties...`);

      // Step 2: Launch browser for scraping
      this.browser = await chromium.launch({ headless: true });

      // Step 3: Process properties in batches
      const batchSize = 5;
      const listings: IndustrialListing[] = [];

      for (let i = 0; i < urlsToProcess.length; i += batchSize) {
        const batch = urlsToProcess.slice(i, i + batchSize);
        console.log(`[PRDBallaratScout] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urlsToProcess.length / batchSize)}...`);

        const batchResults = await Promise.allSettled(
          batch.map(url => this.extractPropertyFromPage(url))
        );

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            listings.push(result.value);
          } else if (result.status === 'rejected') {
            console.error(`[PRDBallaratScout] Failed to extract property from ${batch[index]}:`, result.reason);
          }
        });

        // Rate limiting: 1 second delay between batches
        if (i + batchSize < urlsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Step 4: Cleanup
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

      // Create listing object
      const listing: IndustrialListing = {
        address: propertyData.address,
        zoning: propertyData.category || undefined,
        description: propertyData.description || `Property at ${propertyData.address}`,
        sourceUrl: url,
        price,
        priceDisplay: propertyData.priceDisplay || undefined,
        source: this.name,
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
          propertyType: this.determinePropertyType(propertyData.category, propertyData.description)
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
   * Determine property type from category and description
   */
  private determinePropertyType(category: string, description: string): string {
    const combined = `${category} ${description}`.toLowerCase();

    if (combined.includes('industrial') || combined.includes('warehouse') || combined.includes('factory')) {
      return 'Industrial';
    }
    if (combined.includes('commercial') || combined.includes('office') || combined.includes('retail') || combined.includes('shop')) {
      return 'Commercial';
    }
    if (combined.includes('land') || combined.includes('development site')) {
      return 'Land';
    }

    // Default to Commercial for business/professional properties
    return 'Commercial';
  }
}
