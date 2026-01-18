import { WordPressEPLScout } from './WordPressEPLScout.js';
import { SearchParams } from '../types.js';

/**
 * Cameron Real Estate (Melbourne) Scout
 * 
 * Cameron uses WordPress with Easy Property Listings plugin.
 * 
 * Website: https://www.cameron.com.au
 * EPL REST API: https://www.cameron.com.au/wp-json/wp/v2/commercial
 * Total Properties: 2,019+ commercial listings
 * 
 * This scout extends WordPressEPLScout and uses:
 * 1. EPL REST API with pagination (primary - fetches up to 500 properties)
 * 2. HTML scraping fallback (if API fails)
 */
export class CameronScout extends WordPressEPLScout {
  readonly name = 'Cameron Real Estate';

  /**
   * Build search URL for Cameron commercial properties
   */
  protected buildSearchUrl(criteria: SearchParams): string {
    const baseUrl = 'https://www.cameron.com.au/commercial/';
    const params = new URLSearchParams();
    
    // Cameron uses 'type' parameter for property categories
    params.append('type', 'industrial');
    params.append('type', 'warehouse');
    
    // Add location search if provided
    if (criteria.location) {
      params.append('q', criteria.location);
    }
    
    if (criteria.minPrice) {
      params.append('price_min', criteria.minPrice.toString());
    }
    
    if (criteria.maxPrice) {
      params.append('price_max', criteria.maxPrice.toString());
    }

    return `${baseUrl}?${params.toString()}`;
  }
}
