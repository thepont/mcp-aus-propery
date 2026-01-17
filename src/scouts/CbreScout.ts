import { BaseScout, SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { chromium, Browser, Page } from 'playwright';

/**
 * CBRE Australia Industrial Property Scout
 * Attempts API fetch first, falls back to Playwright + JSON-LD extraction
 */
export class CbreScout extends BaseScout {
  readonly name = 'CBRE Australia';
  private browser: Browser | null = null;

  /**
   * Search CBRE for industrial properties
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      // Try API fetch first
      const apiResults = await this.searchViaApi(criteria);
      if (apiResults.length > 0) {
        console.error(`[CBRE] Found ${apiResults.length} listings via API`);
        return apiResults;
      }
    } catch (error) {
      console.error('[CBRE] API fetch failed, falling back to Playwright:', error);
    }

    // Fallback to Playwright with JSON-LD extraction
    return await this.searchViaPlaywright(criteria);
  }

  /**
   * Attempt to fetch properties via CBRE's internal API
   */
  private async searchViaApi(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    
    try {
      // CBRE uses various API endpoints, try the search API
      const searchUrl = 'https://www.cbre.com.au/api/search/properties';
      
      const response = await axios.post(searchUrl, {
        propertyTypes: ['Industrial'],
        location: criteria.location,
        minPrice: criteria.minPrice,
        maxPrice: criteria.maxPrice,
        pageSize: 50
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });

      if (response.data && Array.isArray(response.data.properties)) {
        for (const prop of response.data.properties) {
          listings.push({
            address: prop.address || prop.title || 'Address not available',
            zoning: prop.zoning || undefined,
            description: prop.description || prop.summary || '',
            sourceUrl: prop.url || `https://www.cbre.com.au${prop.path || ''}`,
            price: prop.price,
            priceDisplay: prop.priceDisplay,
            area: prop.area,
            source: this.name,
            metadata: prop
          });
        }
      }
    } catch (error) {
      // API might not exist or have different structure - fail silently
      if (axios.isAxiosError(error) && error.response?.status !== 404) {
        console.error(`[CBRE] API error: ${error.message}`);
      }
    }

    return listings;
  }

  /**
   * Search using Playwright browser automation with JSON-LD extraction
   */
  private async searchViaPlaywright(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    
    try {
      // Initialize browser if needed
      if (!this.browser) {
        this.browser = await chromium.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      const page = await context.newPage();

      // Navigate to CBRE industrial listings page
      const searchUrl = this.buildSearchUrl(criteria);
      console.error(`[CBRE] Navigating to: ${searchUrl}`);
      
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Extract JSON-LD structured data
      const jsonLdData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        return scripts.map((script: Element) => {
          try {
            return JSON.parse(script.textContent || '');
          } catch {
            return null;
          }
        }).filter(data => data !== null);
      });

      // Parse JSON-LD for property listings
      for (const data of jsonLdData) {
        if (data['@type'] === 'RealEstateListing' || data['@type'] === 'Product') {
          const listing = this.parseJsonLd(data);
          if (listing) {
            listings.push(listing);
          }
        } else if (Array.isArray(data['@graph'])) {
          // Handle @graph structure
          for (const item of data['@graph']) {
            if (item['@type'] === 'RealEstateListing' || item['@type'] === 'Product') {
              const listing = this.parseJsonLd(item);
              if (listing) {
                listings.push(listing);
              }
            }
          }
        }
      }

      // If no JSON-LD found, scrape HTML as last resort
      if (listings.length === 0) {
        const htmlListings = await this.scrapeHtmlListings(page);
        listings.push(...htmlListings);
      }

      await context.close();
      console.error(`[CBRE] Found ${listings.length} listings via Playwright`);
      
    } catch (error) {
      console.error('[CBRE] Playwright search failed:', error);
    }

    return listings;
  }

  /**
   * Build CBRE search URL from criteria
   * Uses the actual CBRE properties page structure
   */
  private buildSearchUrl(criteria: SearchParams): string {
    // CBRE's actual industrial property listings URL
    const baseUrl = 'https://www.cbre.com.au/properties/industrial-warehouse';
    const params = new URLSearchParams();
    
    // CBRE uses 'aspects' parameter for sale/lease
    params.append('aspects', 'isSale,isLease');
    
    // Location can be added as a search term
    if (criteria.location) {
      params.append('q', criteria.location);
    }
    
    if (criteria.minPrice) {
      params.append('priceMin', criteria.minPrice.toString());
    }
    
    if (criteria.maxPrice) {
      params.append('priceMax', criteria.maxPrice.toString());
    }

    const url = `${baseUrl}${params.toString() ? '?' + params.toString() : ''}`;
    return url;
  }

  /**
   * Parse JSON-LD structured data into IndustrialListing
   */
  private parseJsonLd(data: any): IndustrialListing | null {
    try {
      const address = data.address?.streetAddress || 
                     data.name || 
                     data.headline || 
                     'Address not available';
      
      const description = data.description || 
                         data.about || 
                         data.text || 
                         '';
      
      const url = data.url || data['@id'] || '';
      
      return {
        address,
        zoning: data.zoning || undefined,
        description,
        sourceUrl: url.startsWith('http') ? url : `https://www.cbre.com.au${url}`,
        price: data.offers?.price,
        priceDisplay: data.offers?.priceCurrency ? 
                     `${data.offers.priceCurrency} ${data.offers.price}` : 
                     data.offers?.priceSpecification?.price,
        area: data.floorSize?.value,
        source: this.name,
        metadata: data
      };
    } catch (error) {
      console.error('[CBRE] Failed to parse JSON-LD:', error);
      return null;
    }
  }

  /**
   * Scrape HTML listings as last resort
   */
  private async scrapeHtmlListings(page: Page): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    
    try {
      const propertyCards = await page.$$('[data-testid="property-card"], .property-card, .listing-card');
      
      for (const card of propertyCards) {
        try {
          const address = await card.$eval('[data-testid="property-address"], .address, h3, h2', 
            el => el.textContent?.trim() || '').catch(() => '');
          
          const description = await card.$eval('.description, [data-testid="property-description"], p', 
            el => el.textContent?.trim() || '').catch(() => '');
          
          const linkElement = await card.$('a[href]');
          const href = linkElement ? await linkElement.getAttribute('href') : '';
          const url = href?.startsWith('http') ? href : `https://www.cbre.com.au${href}`;

          if (address) {
            listings.push({
              address,
              description,
              sourceUrl: url,
              source: this.name,
              zoning: undefined
            });
          }
        } catch (error) {
          // Skip invalid cards
          continue;
        }
      }
    } catch (error) {
      console.error('[CBRE] HTML scraping failed:', error);
    }

    return listings;
  }

  /**
   * Cleanup browser resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
