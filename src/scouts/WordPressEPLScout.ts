import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { chromium } from 'playwright';

/**
 * Base class for WordPress Easy Property Listings (EPL) sites
 * Provides common functionality for EPL REST API integration
 */
export abstract class WordPressEPLScout extends BaseScout {
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

  /**
   * Search for properties using EPL REST API
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    const searchUrl = this.buildSearchUrl(criteria);
    
    // Try API first
    try {
      return await this.searchViaAPI(searchUrl, criteria);
    } catch (error) {
      console.log(`[${this.name}] API failed, falling back to HTML scraping`);
      return await this.searchViaPlaywright(searchUrl, criteria);
    }
  }

  /**
   * Search via WordPress EPL REST API
   */
  private async searchViaAPI(searchUrl: string, criteria: SearchParams): Promise<IndustrialListing[]> {
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
        const apiUrl = `${baseUrl}${endpoint}?per_page=100&page=1&status=current`;
        console.log(`[${this.name}] Trying API: ${apiUrl}`);
        
        const response = await axios.get(apiUrl, {
          timeout: 10000,
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
      throw new Error('No API endpoints responded');
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

      return {
        address: address || 'Address not available',
        zoning: meta.property_com_zone || '',
        description: prop.content?.rendered?.replace(/<[^>]*>/g, '') || prop.title?.rendered || 'No description',
        sourceUrl: prop.link || '',
        price: meta.property_price ? parseFloat(meta.property_price) : undefined,
        priceDisplay: meta.property_price_display || meta.property_price_text || '',
        area: meta.property_building_area || meta.property_land_area || '',
        source: this.name,
        latitude,
        longitude
      };
    }).filter(listing => listing.address !== 'Address not available');
  }

  /**
   * Fallback: Search via Playwright HTML scraping
   */
  private async searchViaPlaywright(searchUrl: string, criteria: SearchParams): Promise<IndustrialListing[]> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

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

      await browser.close();

      return listings.map(item => ({
        address: item.address,
        zoning: '',
        description: item.description || 'No description',
        sourceUrl: item.url,
        priceDisplay: item.price,
        source: this.name
      }));
    } catch (error) {
      await browser.close();
      console.error(`[${this.name}] Playwright scraping failed:`, error);
      return [];
    }
  }
}
