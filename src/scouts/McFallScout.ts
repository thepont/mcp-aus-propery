import { WordPressEPLScout } from './WordPressEPLScout.js';
import type { SearchParams } from '../types.js';

/**
 * McFall Real Estate Scout
 * 
 * Coverage: Ballan and surrounding areas (Gordon, Mount Egerton, etc.)
 * Technology: WordPress with Easy Property Listings (EPL)
 */
export class McFallScout extends WordPressEPLScout {
  readonly name = 'McFall Real Estate';
  private readonly siteUrl = 'https://mcfallrealestate.com.au';
  readonly relevanceArea = { lat: -37.6000, lon: 144.2280, radiusKm: 40 };

  protected buildSearchUrl(criteria: SearchParams): string {
    // Basic EPL search URL. The base class handle REST API calls to /wp-json/wp/v2/
    // using the search parameter if location is provided.
    return this.siteUrl;
  }

  /**
   * Overriding search to ensure we only target the Ballan area if no location is specified,
   * as this is a local specialist scout.
   */
  async search(criteria: SearchParams) {
    // If no location is provided, we can default to "Ballan" to ensure 
    // the search remains relevant to this scout's specialty.
    const mcFallCriteria = {
        ...criteria,
        location: criteria.location || 'Ballan'
    };
    
    return super.search(mcFallCriteria);
  }
}
