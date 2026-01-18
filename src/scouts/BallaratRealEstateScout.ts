import { AgentpointScout } from './AgentpointScout.js';
import type { SearchParams, IndustrialListing } from '../types.js';

/**
 * Ballarat Real Estate Scout
 * 
 * Discovered via comprehensive Playwright investigation of Ballarat agencies.
 * Uses Agentpoint PropertyHub API with public access.
 * 
 * Technology:
 * - CMS: WordPress with Agentpoint
 * - Property Search: Agentpoint PropertyHub (Reapit)
 * - API: Public endpoints via cdn.reapit.website
 * - CRM Signals: AgentpointSettings in window object
 * 
 * Investigation findings:
 * - Agentpoint confirmed via script sources (cdn.reapit.website)
 * - Has sitemap.xml available
 * - robots.txt references wp-admin (WordPress)
 * - No authentication required for property data
 */
export class BallaratRealEstateScout extends AgentpointScout {
  readonly name = 'Ballarat Real Estate';
  protected readonly siteUrl = 'https://www.ballaratrealestate.com.au';
  protected readonly apiBaseUrl = 'https://www.ballaratrealestate.com.au';

  /**
   * Build API endpoint for property search
   * Ballarat RE uses WordPress with Agentpoint plugin
   */
  protected async buildApiEndpoint(criteria: SearchParams): Promise<string> {
    // Agentpoint PropertyHub typically uses /wp-json/ap/v1/ endpoints
    // Or direct property search endpoints
    return `${this.apiBaseUrl}/wp-json/wp/v2/properties`;
  }

  /**
   * Build API query parameters
   */
  protected buildApiParams(criteria: SearchParams): any {
    const params: any = {
      per_page: 50,
      page: 1,
      orderby: 'date',
      order: 'desc',
      // Filter for commercial/industrial properties
      property_type: 'commercial'
    };

    // Add location if provided
    if (criteria.location) {
      params.search = criteria.location;
    }

    // Add price range
    if (criteria.minPrice) {
      params.price_min = criteria.minPrice;
    }
    if (criteria.maxPrice) {
      params.price_max = criteria.maxPrice;
    }

    return params;
  }

  /**
   * Parse API response into standard listing format
   */
  protected parseApiResponse(data: any): IndustrialListing[] {
    const listings: IndustrialListing[] = [];

    // Handle array of properties (WordPress REST API response)
    const properties = Array.isArray(data) ? data : (data.properties || []);

    for (const property of properties) {
      try {
        // Extract address
        const address = this.extractAddress(property);
        if (!address) continue;

        // Extract price
        const { price, priceDisplay } = this.extractPrice(property);

        // Extract description
        const description = property.content?.rendered || 
                          property.description || 
                          property.excerpt?.rendered ||
                          '';

        // Extract area
        const area = property.property_land_area || 
                    property.property_building_area ||
                    property.area ||
                    undefined;

        // Build source URL
        const sourceUrl = property.link || 
                         property.url ||
                         `${this.siteUrl}/property/${property.id}`;

        // Extract coordinates if available
        const latitude = property.property_address_coordinates?.lat || 
                        property.latitude ||
                        undefined;
        const longitude = property.property_address_coordinates?.lng || 
                         property.longitude ||
                         undefined;

        listings.push({
          address,
          zoning: property.property_category || property.category || undefined,
          description: description.replace(/<[^>]*>/g, ''), // Strip HTML
          sourceUrl,
          price,
          priceDisplay,
          area,
          source: this.name,
          metadata: {
            propertyId: property.id,
            propertyType: property.property_type || property.type,
            status: property.property_status || property.status,
            bedrooms: property.property_bedrooms,
            bathrooms: property.property_bathrooms,
            parking: property.property_parking,
            latitude,
            longitude,
            listingType: property.property_listing_type || 'sale',
            ...this.extractOffMarketSignals(property)
          }
        });
      } catch (error) {
        console.error(`[${this.name}] Error parsing property:`, error);
        continue;
      }
    }

    return listings;
  }

  /**
   * Extract address from property object
   */
  private extractAddress(property: any): string | null {
    // Try various address fields
    const addressFields = [
      property.property_address,
      property.address,
      property.property_address_display,
      property.title?.rendered
    ];

    for (const field of addressFields) {
      if (field && typeof field === 'string' && field.trim()) {
        return field.trim().replace(/<[^>]*>/g, ''); // Strip HTML
      }
    }

    // Try to construct from components
    if (property.property_address_street_number || property.property_address_street) {
      const parts = [
        property.property_address_street_number,
        property.property_address_street,
        property.property_address_suburb,
        property.property_address_state,
        property.property_address_postcode
      ].filter(Boolean);
      
      if (parts.length > 0) {
        return parts.join(' ');
      }
    }

    return null;
  }

  /**
   * Extract price from property object
   */
  private extractPrice(property: any): { price?: number; priceDisplay?: string } {
    const priceDisplay = property.property_price_display || 
                        property.price_display ||
                        property.price ||
                        undefined;

    // Try to extract numeric price
    let price: number | undefined;
    
    if (property.property_price && typeof property.property_price === 'number') {
      price = property.property_price;
    } else if (priceDisplay && typeof priceDisplay === 'string') {
      // Try to extract number from price display
      const matches = priceDisplay.match(/\$?([\d,]+)/);
      if (matches) {
        const numStr = matches[1].replace(/,/g, '');
        const num = parseInt(numStr, 10);
        if (!isNaN(num)) {
          price = num;
        }
      }
    }

    return { price, priceDisplay };
  }

  /**
   * Extract off-market signals from property
   */
  private extractOffMarketSignals(property: any): any {
    const signals: any = {};

    // Check for off-market indicators
    if (property.is_off_market || property.off_market) {
      signals.is_off_market = true;
    }
    if (property.is_quiet || property.quiet_listing) {
      signals.is_quiet = true;
    }
    if (property.is_private || property.private_listing) {
      signals.is_private = true;
    }
    if (property.web_status === 'off-market' || property.web_status === 'unlisted') {
      signals.web_status = property.web_status;
    }
    if (property.portal_push === false) {
      signals.portal_push = false;
    }
    if (property.published_to_portals && Array.isArray(property.published_to_portals)) {
      signals.published_to_portals = property.published_to_portals;
    }

    return signals;
  }
}
