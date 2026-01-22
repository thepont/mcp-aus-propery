import { WordPressEPLScout } from './WordPressEPLScout.js';
import { SearchParams } from '../types.js';

/**
 * Facey Property Scout
 * 
 * Strategy: WordPress REST API (EPL) with Playwright extraction fallback.
 * Coverage: South East Melbourne (Dandenong and surrounds).
 * Focus: Commercial and Industrial properties.
 */
export class FaceyPropertyScout extends WordPressEPLScout {
  readonly name = 'Facey Property';
  private readonly siteUrl = 'https://www.faceyproperty.com.au';
  
  // Focused on Dandenong and South East corridor
  readonly relevanceArea = { lat: -37.9810, lon: 145.2150, radiusKm: 60 };

  protected buildSearchUrl(criteria: SearchParams): string {
    const baseUrl = `${this.siteUrl}/`;
    const params = new URLSearchParams();
    
    params.append('action', 'epl_search');
    params.append('post_type', 'commercial');
    params.append('property_com_listing_type', criteria.listingType === 'rental' ? 'lease' : 'sale');
    params.append('property_status', 'current');
    
    if (criteria.location) {
      params.append('q', criteria.location);
    }
    
    if (criteria.minPrice) params.append('property_price_from', criteria.minPrice.toString());
    if (criteria.maxPrice) params.append('property_price_to', criteria.maxPrice.toString());

    return `${baseUrl}?${params.toString()}`;
  }
}
