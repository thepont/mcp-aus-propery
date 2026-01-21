import { AgentpointScout } from './AgentpointScout.js';
import type { SearchParams, IndustrialListing } from '../types.js';

/**
 * LJ Hooker Scout
 * 
 * Uses Playwright to extract API tokens from LJ Hooker's website,
 * then uses those tokens to query the Agentpoint PropertyHub API.
 * 
 * Technology:
 * - CMS: HubSpot
 * - Property Search: Agentpoint PropertyHub
 * - API: https://api01.ljx.com.au
 */
export class LJHookerScout extends AgentpointScout {
  readonly name = 'LJ Hooker';
  protected readonly siteUrl = 'https://www.ljhooker.com.au';
  protected readonly apiBaseUrl = 'https://api01.ljx.com.au';

  /**
   * Build API endpoint for property search
   */
  protected async buildApiEndpoint(criteria: SearchParams): Promise<string> {
    return `${this.apiBaseUrl}/website/search-v1`;
  }

  /**
   * Build API query parameters
   */
  protected buildApiParams(criteria: SearchParams): any {
    const params: any = {
      searchOrigin: 'residential-au',
      searchProfile: 'buy',
      limit: 100,
      page: 1,
      orderBy: 'date-desc'
    };

    // Add location if provided
    if (criteria.location) {
      params.searchText = criteria.location;
    }

    // Add price range
    if (criteria.minPrice) {
      params.priceMin = criteria.minPrice;
    }
    if (criteria.maxPrice) {
      params.priceMax = criteria.maxPrice;
    }

    return params;
  }

  /**
   * Parse Agentpoint API response
   */
  protected parseApiResponse(data: any): IndustrialListing[] {
    const listings: IndustrialListing[] = [];

    try {
      // search-v1 returns data in 'data.properties' or just 'data' depending on API version
      const properties = data.data?.properties || data.properties || data.data || [];

      for (const property of properties) {
        const listing: IndustrialListing = {
          address: this.extractAddress(property),
          zoning: this.extractZoning(property),
          description: property.description || property.headline || '',
          sourceUrl: property.linkUrl || property.url || '',
          price: this.extractPrice(property),
          area: this.extractArea(property),
          source: this.name,
          metadata: {
            propertyId: property.id || property.propertyId,
            status: property.status || property.statusDisplay,
            type: property.type || property.propertyType,
            category: property.category,
            features: property.features || [],
            latitude: property.latitude || property.lat || undefined,
            longitude: property.longitude || property.lon || property.long || undefined
          }
        };

        listings.push(listing);
      }

      console.log(`[${this.name}] Parsed ${listings.length} properties from API`);
      
    } catch (error) {
      console.error(`[${this.name}] Error parsing API response:`, error);
    }

    return listings;
  }

  /**
   * Extract address from property data
   */
  private extractAddress(property: any): string {
    if (property.addressDisplay) {
      return property.addressDisplay;
    }

    const parts: string[] = [];
    
    if (property.address) {
      if (typeof property.address === 'string') {
        return property.address;
      }
      
      if (property.address.street) parts.push(property.address.street);
      if (property.address.suburb) parts.push(property.address.suburb);
      if (property.address.state) parts.push(property.address.state);
      if (property.address.postcode) parts.push(property.address.postcode);
    }

    return parts.length > 0 ? parts.join(', ') : 'Address not available';
  }

  /**
   * Extract zoning/type information
   */
  private extractZoning(property: any): string {
    const parts: string[] = [];

    if (property.type) {
      parts.push(property.type);
    } else if (property.propertyType) {
      parts.push(property.propertyType);
    }

    if (property.category) {
      parts.push(property.category);
    }

    // Indicate if it's for sale or lease
    if (property.status === 'Current' || property.statusDisplay) {
      const status = property.statusDisplay || property.status;
      if (status.toLowerCase().includes('lease') || status.toLowerCase().includes('rent')) {
        parts.push('(Lease)');
      } else if (status.toLowerCase().includes('sale')) {
        parts.push('(Sale)');
      }
    }

    return parts.length > 0 ? parts.join(' ') : 'Commercial';
  }

  /**
   * Extract price information
   */
  private extractPrice(property: any): number | undefined {
    if (property.price && typeof property.price === 'number') {
      return property.price;
    }

    if (property.priceFrom) {
      return property.priceFrom;
    }

    // Try to parse from display price
    if (property.priceDisplay || property.displayPrice) {
      const priceStr = property.priceDisplay || property.displayPrice;
      const match = priceStr.match(/\$?([\d,]+)/);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''));
      }
    }

    return undefined;
  }

  /**
   * Extract area/size information
   */
  private extractArea(property: any): number | undefined {
    // Check various area fields
    if (property.floorArea) return property.floorArea;
    if (property.landArea) return property.landArea;
    if (property.buildingArea) return property.buildingArea;

    // Try to parse from features or description
    if (property.features) {
      for (const feature of property.features) {
        const match = String(feature).match(/([\d,]+)\s*(?:m2|sqm|m²)/i);
        if (match) {
          return parseInt(match[1].replace(/,/g, ''));
        }
      }
    }

    return undefined;
  }
}
