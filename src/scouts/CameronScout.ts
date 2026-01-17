import { BaseScout, SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { chromium, Browser, Page } from 'playwright';

/**
 * Cameron Real Estate Scout
 * Searches cameron.com.au for industrial properties
 */
export class CameronScout extends BaseScout {
  readonly name = 'Cameron Real Estate';
  private browser: Browser | null = null;

  /**
   * Search Cameron for industrial properties
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      // Try API fetch first
      const apiResults = await this.searchViaApi(criteria);
      if (apiResults.length > 0) {
        console.error(`[Cameron] Found ${apiResults.length} listings via API`);
        return apiResults;
      }
    } catch (error) {
      console.error('[Cameron] API fetch failed, falling back to Playwright:', error);
    }

    // Fallback to Playwright with JSON-LD extraction
    return await this.searchViaPlaywright(criteria);
  }

  /**
   * Attempt to fetch properties via Cameron's API
   */
  private async searchViaApi(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    
    try {
      // Cameron.com.au may have an API endpoint for property searches
      const searchUrl = 'https://www.cameron.com.au/api/properties';
      
      const response = await axios.get(searchUrl, {
        params: {
          type: 'industrial',
          location: criteria.location,
          minPrice: criteria.minPrice,
          maxPrice: criteria.maxPrice,
        },
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
            sourceUrl: prop.url || `https://www.cameron.com.au${prop.path || ''}`,
            price: prop.price,
            priceDisplay: prop.priceDisplay,
            area: prop.area,
            source: this.name,
            metadata: prop
          });
        }
      }
    } catch (error) {
      // API might not exist - fail silently and fall back to Playwright
      if (axios.isAxiosError(error) && error.response?.status !== 404) {
        console.error(`[Cameron] API error: ${error.message}`);
      }
    }

    return listings;
  }

  /**
   * Search using Playwright browser automation
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

      // Build search URL for Cameron
      const searchUrl = this.buildSearchUrl(criteria);
      console.error(`[Cameron] Navigating to: ${searchUrl}`);
      
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

      // If no JSON-LD found, scrape HTML
      if (listings.length === 0) {
        const htmlListings = await this.scrapeHtmlListings(page, criteria);
        listings.push(...htmlListings);
      }

      await context.close();
      console.error(`[Cameron] Found ${listings.length} listings via Playwright`);
      
    } catch (error) {
      console.error('[Cameron] Playwright search failed:', error);
    }

    return listings;
  }

  /**
   * Build Cameron search URL from criteria
   */
  private buildSearchUrl(criteria: SearchParams): string {
    // Cameron uses suburb-based URLs like /suburb/{suburb}/
    // For now, try to search for industrial properties
    const baseUrl = 'https://www.cameron.com.au';
    
    // Try to construct a search URL
    // If location is provided, try suburb format
    if (criteria.location) {
      const suburb = criteria.location.toLowerCase().replace(/\s+/g, '-');
      return `${baseUrl}/suburb/${suburb}/`;
    }
    
    // Fallback to general property search
    return `${baseUrl}/properties/industrial/`;
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
        sourceUrl: url.startsWith('http') ? url : `https://www.cameron.com.au${url}`,
        price: data.offers?.price,
        priceDisplay: data.offers?.priceCurrency ? 
                     `${data.offers.priceCurrency} ${data.offers.price}` : 
                     data.offers?.priceSpecification?.price,
        area: data.floorSize?.value,
        source: this.name,
        metadata: data
      };
    } catch (error) {
      console.error('[Cameron] Failed to parse JSON-LD:', error);
      return null;
    }
  }

  /**
   * Scrape HTML listings from Cameron website
   */
  private async scrapeHtmlListings(page: Page, criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    
    try {
      // Cameron.com.au property card selectors
      const propertyCards = await page.$$('.property-card, .listing-item, article.property, .property-listing');
      
      console.error(`[Cameron] Found ${propertyCards.length} property cards to scrape`);
      
      for (const card of propertyCards) {
        try {
          // Extract address
          const address = await card.$eval('.property-address, .address, h2, h3, .property-title', 
            el => el.textContent?.trim() || '').catch(() => '');
          
          // Extract description
          const description = await card.$eval('.property-description, .description, p, .property-summary', 
            el => el.textContent?.trim() || '').catch(() => '');
          
          // Extract link
          const linkElement = await card.$('a[href]');
          const href = linkElement ? await linkElement.getAttribute('href') : '';
          const url = href?.startsWith('http') ? href : `https://www.cameron.com.au${href}`;

          // Extract price
          const priceText = await card.$eval('.price, .property-price, .price-display', 
            el => el.textContent?.trim() || '').catch(() => '');

          // Extract property type/category to filter for industrial
          const propertyType = await card.$eval('.property-type, .category, .type', 
            el => el.textContent?.trim().toLowerCase() || '').catch(() => '');

          // Only include if it's industrial or warehouse related
          const isIndustrial = propertyType.includes('industrial') || 
                               propertyType.includes('warehouse') ||
                               propertyType.includes('factory') ||
                               address.toLowerCase().includes('industrial') ||
                               description.toLowerCase().includes('industrial');

          if (address && isIndustrial) {
            listings.push({
              address,
              description,
              sourceUrl: url,
              priceDisplay: priceText,
              source: this.name,
              zoning: undefined
            });
          }
        } catch (error) {
          // Skip invalid cards
          continue;
        }
      }

      // If we found properties but none were industrial, try pagination
      if (listings.length === 0) {
        console.error('[Cameron] No industrial properties found, checking if we can paginate...');
        
        // Try to click "next page" or load more if available
        const nextButton = await page.$('a.next, .pagination-next, button:has-text("Next")').catch(() => null);
        if (nextButton) {
          await nextButton.click();
          await page.waitForTimeout(2000);
          // Recursive call for next page (limit to avoid infinite loop)
          const nextPageListings = await this.scrapeHtmlListings(page, criteria);
          listings.push(...nextPageListings.slice(0, 10)); // Limit to 10 more
        }
      }
      
    } catch (error) {
      console.error('[Cameron] HTML scraping failed:', error);
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
