import axios from 'axios';
import { BaseScout } from './BaseScout.js';
import { IndustrialListing, SearchParams } from '../types.js';

/**
 * Base scout for ListOnce API v2
 * 
 * ListOnce is a middleware-as-a-service platform used by Australian real estate agencies
 * including PRD, Barry Plant, and various boutique agencies.
 * 
 * API Documentation: https://api.listonce.com.au/api/v2/
 * 
 * Key Features:
 * - REST API with JSON responses
 * - Commercial, residential, land, and rural properties
 * - Geospatial data for all listings
 * - Image CDN with dynamic resizing
 * - Modified-from sync capability
 * 
 * Subclasses must provide:
 * - clientId: The agency-specific client ID
 * - name: Agency display name
 */
export abstract class ListOnceScout extends BaseScout {
  protected readonly apiBaseUrl = 'https://api.listonce.com.au/api/v2';
  protected abstract readonly clientId: string | number;

  /**
   * Search for properties using ListOnce API
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      console.log(`[${this.name}] Searching ListOnce API with criteria:`, criteria);

      // Build API request
      const endpoint = this.buildApiEndpoint(criteria);
      const params = this.buildApiParams(criteria);

      console.log(`[${this.name}] API URL: ${endpoint}`);
      console.log(`[${this.name}] Params:`, params);

      // Make API request
      const response = await axios.get(endpoint, {
        params,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MCP-Property-Scout/1.0'
        },
        timeout: 30000
      });

      console.log(`[${this.name}] API Response Status: ${response.status}`);

      // Parse response
      const listings = this.parseApiResponse(response.data, criteria);

      console.log(`[${this.name}] Found ${listings.length} properties`);
      return listings;

    } catch (error: any) {
      console.error(`[${this.name}] API Error:`, error.message);
      if (error.response) {
        console.error(`[${this.name}] Response Status: ${error.response.status}`);
        console.error(`[${this.name}] Response Data:`, error.response.data);
      }
      return [];
    }
  }

  /**
   * Build API endpoint URL
   */
  protected buildApiEndpoint(criteria: SearchParams): string {
    return `${this.apiBaseUrl}/properties/search`;
  }

  /**
   * Build API query parameters
   */
  protected buildApiParams(criteria: SearchParams): Record<string, any> {
    const params: Record<string, any> = {
      client_id: this.clientId,
      category: 'commercial', // Focus on commercial properties
      status: 'current', // Only active listings
      limit: 50,
      page: 1,
      sort: 'date_desc'
    };

    // Add location filter if provided
    if (criteria.location) {
      params.suburb = criteria.location;
    }

    // Add price range if provided
    if (criteria.minPrice) {
      params.price_min = criteria.minPrice;
    }
    if (criteria.maxPrice) {
      params.price_max = criteria.maxPrice;
    }

    return params;
  }

  /**
   * Parse ListOnce API response into standardized listings
   */
  protected parseApiResponse(data: any, criteria: SearchParams): IndustrialListing[] {
    if (!data || !data.data || !Array.isArray(data.data)) {
      console.warn(`[${this.name}] Invalid API response structure`);
      return [];
    }

    return data.data
      .map((property: any) => this.parseProperty(property))
      .filter((listing): listing is IndustrialListing => listing !== null);
  }

  /**
   * Parse individual property from ListOnce format
   */
  protected parseProperty(property: any): IndustrialListing | null {
    try {
      // Extract address
      const address = this.buildAddress(property);
      if (!address) {
        return null;
      }

      // Extract coordinates
      const latitude = property.latitude || property.lat || null;
      const longitude = property.longitude || property.lng || property.lon || null;

      // Extract price
      const price = this.extractPrice(property);
      const priceDisplay = property.price_display || property.display_price || price?.toString() || 'Contact Agent';

      // Extract description
      const description = property.description || property.headline || property.title || '';

      // Extract property area
      const area = this.extractArea(property);

      // Build source URL
      const sourceUrl = property.url || property.listing_url || 
                       `https://www.listonce.com.au/property/${property.id}`;

      // Determine zoning/category
      const category = property.category || 'Commercial';
      const propertyType = property.type || property.property_type || '';
      const zoning = `${category}${propertyType ? ` - ${propertyType}` : ''}`;

      return {
        address,
        zoning,
        description: description.substring(0, 500), // Limit description length
        sourceUrl,
        price: price || undefined,
        priceDisplay,
        area: area || undefined,
        source: this.name,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        metadata: {
          listonce_id: property.id,
          client_id: property.client_id,
          status: property.status,
          category: property.category,
          property_type: propertyType,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          parking: property.parking || property.garage_spaces,
          land_area: property.land_area,
          building_area: property.building_area,
          updated_at: property.updated_at || property.modified_at
        }
      };

    } catch (error: any) {
      console.error(`[${this.name}] Error parsing property:`, error.message);
      return null;
    }
  }

  /**
   * Build formatted address from property data
   */
  protected buildAddress(property: any): string | null {
    const parts: string[] = [];

    // Street address
    if (property.address_street || property.street_address) {
      parts.push(property.address_street || property.street_address);
    } else if (property.street_number && property.street_name) {
      parts.push(`${property.street_number} ${property.street_name}`);
    }

    // Suburb
    if (property.suburb || property.address_suburb) {
      parts.push(property.suburb || property.address_suburb);
    }

    // State
    if (property.state || property.address_state) {
      parts.push(property.state || property.address_state);
    }

    // Postcode
    if (property.postcode || property.address_postcode) {
      parts.push(property.postcode || property.address_postcode);
    }

    // Full address field
    if (parts.length === 0 && property.address) {
      return property.address;
    }

    return parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * Extract price from property data
   */
  protected extractPrice(property: any): number | null {
    if (property.price && typeof property.price === 'number') {
      return property.price;
    }

    // Try to parse price_from or price_to
    if (property.price_from) {
      return typeof property.price_from === 'number' ? property.price_from : parseInt(property.price_from);
    }

    // Try to parse string prices
    if (property.price && typeof property.price === 'string') {
      const cleaned = property.price.replace(/[^0-9]/g, '');
      if (cleaned) {
        return parseInt(cleaned);
      }
    }

    return null;
  }

  /**
   * Extract area from property data
   */
  protected extractArea(property: any): number | null {
    // Try building area first (more relevant for commercial)
    if (property.building_area) {
      return typeof property.building_area === 'number' ? property.building_area : parseFloat(property.building_area);
    }

    // Try land area
    if (property.land_area) {
      return typeof property.land_area === 'number' ? property.land_area : parseFloat(property.land_area);
    }

    // Try generic area field
    if (property.area) {
      return typeof property.area === 'number' ? property.area : parseFloat(property.area);
    }

    return null;
  }
}
