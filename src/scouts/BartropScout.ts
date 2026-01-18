import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium, type Browser } from 'playwright';

/**
 * Bartrop Real Estate Scout
 * 
 * Uses sitemap strategy to discover properties:
 * 1. Download sitemap.xml
 * 2. Extract property URLs (pattern: /property?property_id=...)
 * 3. For each URL, fetch and extract property data from structured metadata
 * 4. Compare against displayed search results to find "quiet listings"
 * 
 * Technology:
 * - Website: Custom (not WordPress, not standard CRM)
 * - Sitemap: https://www.bartrop.com.au/sitemap.xml (~12,000 URLs)
 * - Property URLs: /property?property_id=...
 * - Detection: URLs in sitemap but not in search = potential off-market
 * 
 * Structured data extraction (priority order):
 * 1. <title> tag - Property address (e.g., "2 / 507 Bell Street, Redan | Bartrop Real Estate")
 * 2. <h1 class="pageTitle"> - Property title/description
 * 3. Open Graph meta tags - Images (og:image)
 * 4. HTML selectors - Price, category, extended description (fallback)
 * 
 * Investigation findings:
 * - Has comprehensive sitemap.xml with all properties
 * - robots.txt doesn't exclude properties
 * - No public API or JSON-LD detected
 * - No JSON/XML alternative endpoints available
 * - Sitemap comparison strategy viable
 */
export class BartropScout extends BaseScout {
  readonly name = 'Bartrop Real Estate';
  private readonly siteUrl = 'https://www.bartrop.com.au';
  private readonly sitemapUrl = 'https://www.bartrop.com.au/sitemap.xml';
  private browser: Browser | null = null;

  /**
   * Search for properties using sitemap strategy
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.log(`[${this.name}] Starting sitemap-based search for ${criteria.location || 'all areas'}...`);

    try {
      // Step 1: Download and parse sitemap
      const propertyUrls = await this.getPropertyUrlsFromSitemap();
      console.log(`[${this.name}] Found ${propertyUrls.length} property URLs in sitemap`);

      // Step 2: Filter URLs based on criteria (if possible)
      const relevantUrls = this.filterUrlsByCriteria(propertyUrls, criteria);
      console.log(`[${this.name}] Filtered to ${relevantUrls.length} relevant URLs`);

      // Step 3: Fetch property details (limit to avoid overwhelming)
      const maxProperties = 50;
      const urlsToFetch = relevantUrls.slice(0, maxProperties);
      console.log(`[${this.name}] Fetching details for ${urlsToFetch.length} properties...`);

      const listings: IndustrialListing[] = [];
      
      // Launch browser for scraping
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });

      // Fetch properties in batches
      const batchSize = 5;
      for (let i = 0; i < urlsToFetch.length; i += batchSize) {
        const batch = urlsToFetch.slice(i, i + batchSize);
        const batchPromises = batch.map(url => this.fetchPropertyDetails(context, url));
        const batchResults = await Promise.allSettled(batchPromises);

        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            listings.push(result.value);
          }
        }

        // Small delay between batches
        if (i + batchSize < urlsToFetch.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      await this.browser.close();
      this.browser = null;

      console.log(`[${this.name}] Successfully extracted ${listings.length} properties`);
      return listings;

    } catch (error) {
      console.error(`[${this.name}] Error in sitemap search:`, error);
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      return [];
    }
  }

  /**
   * Download and parse sitemap to extract property URLs
   */
  private async getPropertyUrlsFromSitemap(): Promise<string[]> {
    try {
      const response = await axios.get(this.sitemapUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PropertyScout/1.0)'
        }
      });

      // Parse XML
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_'
      });

      const result = parser.parse(response.data);

      // Extract URLs
      const urls: string[] = [];
      const urlset = result.urlset || result;
      const urlNodes = Array.isArray(urlset.url) ? urlset.url : [urlset.url];

      for (const urlNode of urlNodes) {
        if (urlNode && urlNode.loc) {
          const loc = urlNode.loc;
          // Filter for property URLs
          if (loc.includes('/property?property_id=')) {
            urls.push(loc);
          }
        }
      }

      return urls;
    } catch (error) {
      console.error(`[${this.name}] Error fetching sitemap:`, error);
      return [];
    }
  }

  /**
   * Filter property URLs based on search criteria
   */
  private filterUrlsByCriteria(urls: string[], criteria: SearchParams): string[] {
    // For now, return all URLs
    // In a more sophisticated implementation, we could:
    // 1. Fetch the search results page
    // 2. Compare sitemap URLs against displayed URLs
    // 3. Identify URLs only in sitemap (potential quiet listings)
    
    return urls;
  }

  /**
   * Fetch and extract property details from a URL
   * Uses structured data (title, meta tags, H1) before falling back to HTML selectors
   */
  private async fetchPropertyDetails(context: any, url: string): Promise<IndustrialListing | null> {
    try {
      const page = await context.newPage();
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Wait for content to load
      await page.waitForTimeout(2000);

      // Extract property data from page using structured data first
      const propertyData = await page.evaluate(() => {
        // 1. Try to extract address from <title> tag (most reliable)
        // Format: "2 / 507 Bell Street, Redan | Bartrop Real Estate"
        let address = '';
        const title = document.querySelector('title')?.textContent || '';
        if (title) {
          // Extract address before " | Bartrop Real Estate"
          const parts = title.split('|');
          if (parts.length > 0) {
            address = parts[0].trim();
          }
        }

        // 2. Try to find description from <h1> tag (page title)
        let description = '';
        const h1 = document.querySelector('h1.pageTitle, h1');
        if (h1 && h1.textContent) {
          description = h1.textContent.trim();
        }

        // 3. Try to find price from meta tags or page content
        let priceDisplay = '';
        
        // Try meta tags first
        const priceMeta = document.querySelector('meta[property="og:price"], meta[name="price"]');
        if (priceMeta) {
          priceDisplay = priceMeta.getAttribute('content') || '';
        }
        
        // Fall back to HTML selectors if no meta tags
        if (!priceDisplay) {
          const priceSelectors = [
            '.property-price',
            '[class*="price"]',
            '.price-display'
          ];

          for (const selector of priceSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              priceDisplay = el.textContent.trim();
              if (priceDisplay.includes('$') || priceDisplay.toLowerCase().includes('contact')) break;
            }
          }
        }

        // 4. Try to find extended description from article or description div
        if (!description || description.length < 20) {
          const descSelectors = [
            '.property-description',
            '[class*="description"]',
            '.property-content',
            'article'
          ];

          for (const selector of descSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              const text = el.textContent.trim();
              if (text.length > 50) {
                description = text;
                break;
              }
            }
          }
        }

        // 5. Try to find property type/category
        const categorySelectors = [
          '.property-type',
          '.property-category',
          '[class*="category"]'
        ];

        let category = '';
        for (const selector of categorySelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            category = el.textContent.trim();
            break;
          }
        }

        return {
          address,
          priceDisplay,
          description,
          category
        };
      });

      await page.close();

      // Validate we got minimum data
      if (!propertyData.address || propertyData.address.length < 5) {
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

      return {
        address: propertyData.address,
        zoning: propertyData.category || undefined,
        description: propertyData.description || `Property at ${propertyData.address}`,
        sourceUrl: url,
        price,
        priceDisplay: propertyData.priceDisplay || undefined,
        source: this.name,
        metadata: {
          extractedVia: 'sitemap+metadata', // Using sitemap + structured metadata (title, h1, meta tags)
          sitemapUrl: this.sitemapUrl,
          category: propertyData.category,
          extractionMethod: 'Structured data extraction: <title> tag for address, <h1> for description, HTML selectors for price'
        }
      };

    } catch (error) {
      console.error(`[${this.name}] Error fetching property ${url}:`, error);
      return null;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
