import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing, PropertyType, ListingType } from '../types.js';
import axios from 'axios';
import { chromium } from 'playwright';
import fs from 'fs';

interface EPLState {
  lastPage: number;
  lastRun: string;
}

/**
 * Base class for WordPress Easy Property Listings (EPL) sites
 * Provides common functionality for EPL REST API integration
 */
export abstract class WordPressEPLScout extends BaseScout {
  protected browser: any = null;
  protected isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  /**
   * Subclasses must implement this to build the search URL
   */
  protected abstract buildSearchUrl(criteria: SearchParams): string;

  /**
   * Get the WordPress REST API base URL
   */
  protected getWPApiBase(siteUrl: string): string {
    return `${siteUrl}/wp-json/wp/v2`;
  }

  protected get stateFile(): string {
    const safeName = this.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `data/epl_${safeName}_state.json`;
  }

  /**
   * Search for properties using EPL REST API with watermarking
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    const searchUrl = this.buildSearchUrl(criteria);
    
    // Ensure data directory
    if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
    
    // Try API first
    try {
      const state = this.loadState();
      const isGeneralSync = !criteria.location || criteria.location === 'Any';
      const pageToFetch = isGeneralSync ? (state.lastPage + 1) : 1;
      
      const listings = await this.searchViaAPI(searchUrl, criteria, pageToFetch);
      
      if (isGeneralSync) {
        state.lastPage = pageToFetch;
        if (listings.length === 0) {
          console.log(`[${this.name}] Reached end of properties. Resetting to page 1.`);
          state.lastPage = 0;
        }
        this.saveState(state);
      }
      
      return listings;
    } catch (error) {
      console.log(`[${this.name}] API failed, falling back to HTML scraping`);
      return await this.searchViaPlaywright(searchUrl, criteria);
    }
  }

  /**
   * Search via WordPress EPL REST API
   */
  private async searchViaAPI(searchUrl: string, criteria: SearchParams, page: number = 1): Promise<IndustrialListing[]> {
    const url = new URL(searchUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    
    // Try different EPL endpoints
    const endpoints = [
      '/wp-json/wp/v2/commercial',
      '/wp-json/wp/v2/property',
      '/wp-json/wp/v2/business'
    ];

    let allProperties: any[] = [];

    for (const endpoint of endpoints) {
      try {
        const apiUrl = `${baseUrl}${endpoint}?per_page=50&page=${page}&status=current`;
        console.log(`[${this.name}] Trying API (Page ${page}): ${apiUrl}`);
        
        await this.waitOrganic();
        
        const response = await axios.get(apiUrl, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (response.data && Array.isArray(response.data)) {
          console.log(`[${this.name}] Found ${response.data.length} properties via ${endpoint}`);
          allProperties = allProperties.concat(response.data);
        }
      } catch (error) {
        // Try next endpoint
        continue;
      }
    }

    if (allProperties.length === 0) {
      return [];
    }

    return this.parseEPLProperties(allProperties);
  }

  /**
   * Parse EPL API response into IndustrialListing format
   */
  private parseEPLProperties(properties: any[]): IndustrialListing[] {
    return properties.map(prop => {
      const meta = prop.meta || {};

      // Extract coordinates
      let latitude: number | undefined;
      let longitude: number | undefined;

      if (meta.property_address_coordinates) {
        const coords = String(meta.property_address_coordinates).split(',');
        if (coords.length === 2) {
          latitude = parseFloat(coords[0].trim());
          longitude = parseFloat(coords[1].trim());
        }
      }

      // Build address
      const address = [
        meta.property_address_street_number,
        meta.property_address_street,
        meta.property_address_suburb,
        meta.property_address_state,
        meta.property_address_postcode
      ].filter(Boolean).join(' ');

      const description = prop.content?.rendered?.replace(/<[^>]*>/g, '') || prop.title?.rendered || 'No description';
      const priceDisplay = meta.property_price_display || meta.property_price_text || '';

      // Determine property type from EPL metadata
      const propertyType = this.determinePropertyType(
        meta.property_category || meta.property_commercial_category || '',
        meta.property_com_zone || '',
        description,
        prop.type // WordPress post type: 'commercial', 'property', 'rental', etc.
      );

      // Determine listing type from EPL metadata
      const listingType = this.determineListingType(
        meta.property_status || '',
        meta.property_com_listing_type || meta.property_authority || '',
        priceDisplay
      );

      return {
        address: address || 'Address not available',
        zoning: meta.property_com_zone || meta.property_category || '',
        description,
        sourceUrl: prop.link || '',
        price: meta.property_price ? parseFloat(meta.property_price) : undefined,
        priceDisplay,
        area: meta.property_building_area || meta.property_land_area || '',
        source: this.name,
        propertyType,
        listingType,
        metadata: {
          latitude,
          longitude,
          eplCategory: meta.property_category,
          eplCommercialCategory: meta.property_commercial_category,
          eplStatus: meta.property_status,
          eplListingType: meta.property_com_listing_type,
          postType: prop.type
        }
      };
    }).filter(listing => listing.address !== 'Address not available');
  }

  /**
   * Determine property type from EPL metadata
   */
  private determinePropertyType(category: string, zone: string, description: string, postType?: string): PropertyType | undefined {
    const combined = `${category} ${zone} ${description} ${postType || ''}`.toLowerCase();

    if (combined.includes('industrial') || combined.includes('warehouse') || combined.includes('factory') ||
        combined.includes('workshop') || combined.includes('storage')) {
      return 'industrial';
    }
    if (combined.includes('commercial') || combined.includes('office') || combined.includes('retail') ||
        combined.includes('shop') || combined.includes('suite') || combined.includes('showroom') ||
        postType === 'commercial') {
      return 'commercial';
    }
    if (combined.includes('rural') || combined.includes('farm') || combined.includes('acreage') ||
        combined.includes('hectare') || postType === 'rural') {
      return 'rural';
    }
    if (combined.includes('land') || combined.includes('development site') || combined.includes('block') ||
        postType === 'land') {
      return 'land';
    }
    if (combined.includes('house') || combined.includes('home') || combined.includes('bedroom') ||
        combined.includes('unit') || combined.includes('apartment') || combined.includes('townhouse') ||
        combined.includes('residential') || postType === 'property' || postType === 'rental') {
      return 'residential';
    }

    return undefined;
  }

  /**
   * Determine listing type from EPL metadata
   */
  private determineListingType(status: string, eplListingType: string, priceDisplay: string): ListingType | undefined {
    const combined = `${status} ${eplListingType} ${priceDisplay}`.toLowerCase();

    // EPL typically uses 'current', 'sold', 'leased' for status
    // and 'sale', 'lease' for listing type
    if (combined.includes('lease') || combined.includes('rent') || combined.includes('leased') ||
        combined.includes('pw') || combined.includes('per week') || combined.includes('pcm')) {
      return 'rental';
    }
    if (combined.includes('sale') || combined.includes('sold') || combined.includes('auction') ||
        combined.includes('current') || combined.includes('offers')) {
      return 'sale';
    }

    return undefined;
  }

  /**
   * Fallback: Search via Playwright HTML scraping
   */
  private async searchViaPlaywright(searchUrl: string, criteria: SearchParams): Promise<IndustrialListing[]> {
    if (!this.browser) {
        this.browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.isSharedBrowser = false;
    }

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();

    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

      const listings = await page.evaluate(() => {
        const results: any[] = [];
        const cards = document.querySelectorAll('a.card.listing, .property-card, .listing-item');

        cards.forEach(card => {
          const addressEl = card.querySelector('.listing-address, .property-address');
          const priceEl = card.querySelector('.listing-price, .property-price');
          const descEl = card.querySelector('.listing-description, .property-description');

          if (addressEl) {
            results.push({
              address: addressEl.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              description: descEl?.textContent?.trim() || '',
              url: (card as HTMLAnchorElement).href || ''
            });
          }
        });

        return results;
      });

      if (!this.isSharedBrowser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await page.close();
          await context.close();
      }

      const results = listings.map(item => ({
        address: item.address,
        zoning: '',
        description: item.description || 'No description',
        sourceUrl: item.url,
        priceDisplay: item.price,
        source: this.name
      }));

      // Filter by location to ensure relevance
      if (criteria.location && criteria.location !== 'Any') {
          const loc = criteria.location.toLowerCase();
          return results.filter(l => 
            l.address.toLowerCase().includes(loc) || 
            l.description.toLowerCase().includes(loc)
          );
      }

      return results;
    } catch (error) {
      if (!this.isSharedBrowser && this.browser) {
          await this.browser.close();
          this.browser = null;
      }
      console.error(`[${this.name}] Playwright scraping failed:`, error);
      return [];
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser && !this.isSharedBrowser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private loadState(): EPLState {
    if (fs.existsSync(this.stateFile)) {
      try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')); } catch (e) {}
    }
    return { lastPage: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: EPLState): void {
    state.lastRun = new Date().toISOString();
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2)); } catch (e) {}
  }
}