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
 * Strategy:
 * 1. WordPress REST API (preferred)
 * 2. HTML extraction fallback (if API fails)
 */
export class CameronScout extends WordPressEPLScout {
  readonly name = 'Cameron Real Estate';
  readonly relevanceArea = { lat: -37.9810, lon: 145.2150, radiusKm: 60 };

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
