import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';

/**
 * Base class for VaultRE-powered agencies (Ray White, LJ Hooker)
 * VaultRE is the CRM/API system used by major Australian franchise networks
 * 
 * API Pattern: https://{office-domain}/api/proxy/v1/listings
 * Provider: VAULT
 * Auth: Public API (no authentication required for listings)
 */
export abstract class VaultREScout extends BaseScout {
  /**
   * The base URL of the Ray White/LJ Hooker office website
   * Example: 'https://raywhiteballarat.com.au'
   */
  protected abstract readonly apiBaseUrl: string;

  /**
   * Search for properties using VaultRE proxy API
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      return await this.searchViaAPI(criteria);
    } catch (error) {
      console.error(`[${this.name}] VaultRE API search failed:`, error);
      return [];
    }
  }

  /**
   * Search via VaultRE proxy API
   */
  private async searchViaAPI(criteria: SearchParams): Promise<IndustrialListing[]> {
    const url = `${this.apiBaseUrl}/api/proxy/v1/listings`;
    
    console.log(`[${this.name}] Fetching from VaultRE API: ${url}`);

    try {
      // Fetch first page to get total
      const response = await axios.get(url, {
        params: {
          pageSize: 100, // Request more per page
          page: 1
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.data || !response.data.data) {
        console.log(`[${this.name}] No data returned from API`);
        return [];
      }

      const listings = response.data.data;
      const totalHits = response.data.hits || listings.length;

      console.log(`[${this.name}] Found ${listings.length} properties (${totalHits} total available)`);

      // Parse listings
      return this.parseVaultREListings(listings, criteria);
    } catch (error: any) {
      if (error.response) {
        console.error(`[${this.name}] API error:`, error.response.status, error.response.statusText);
      } else {
        console.error(`[${this.name}] Request error:`, error.message);
      }
      return [];
    }
  }

  /**
   * Parse VaultRE API response into IndustrialListing format
   */
  private parseVaultREListings(listings: any[], criteria: SearchParams): IndustrialListing[] {
    return listings.map(item => {
      const prop = item.value;

      // Determine property category
      const isCommercial = prop.typeCode === 'COM' || prop.categoryCode === 'COM';
      const isIndustrial = prop.title?.toLowerCase().includes('industrial') ||
                          prop.description?.toLowerCase().includes('industrial') ||
                          prop.title?.toLowerCase().includes('warehouse') ||
                          prop.description?.toLowerCase().includes('warehouse');
      const isSale = prop.typeCode === 'SAL';
      const isRental = prop.typeCode === 'REN';

      // Build address
      const addressParts = [];
      if (prop.address) {
        if (prop.address.street) addressParts.push(prop.address.street);
        if (prop.address.suburb) addressParts.push(prop.address.suburb);
        if (prop.address.state) addressParts.push(prop.address.state);
        if (prop.address.postcode) addressParts.push(prop.address.postcode);
      } else {
        // Fallback to individual fields
        if (prop.suburb) addressParts.push(prop.suburb);
        if (prop.state) addressParts.push(prop.state);
      }
      const address = addressParts.length > 0 ? addressParts.join(', ') : prop.title || 'Address not available';

      // Extract coordinates
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (prop.geo) {
        latitude = prop.geo.latitude;
        longitude = prop.geo.longitude;
      }

      // Clean description (remove HTML tags)
      const description = prop.description 
        ? prop.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
        : 'No description available';

      // Build source URL
      const sourceUrl = prop.webUrl || 
                       (prop.slug ? `${this.apiBaseUrl}/property/${prop.slug}` : null) ||
                       `${this.apiBaseUrl}/property/${prop.id}` ||
                       this.apiBaseUrl;

      // Determine zoning
      let zoning = '';
      if (isCommercial) zoning = 'Commercial';
      else if (isIndustrial) zoning = 'Industrial';
      
      // Add sale/rental indicator
      const listingType = isSale ? ' (Sale)' : isRental ? ' (Rental)' : '';

      return {
        address,
        zoning: zoning + listingType,
        description,
        sourceUrl,
        price: prop.price ? parseFloat(prop.price) : undefined,
        priceDisplay: prop.displayPrice || (prop.rentPrice ? `$${prop.rentPrice} ${prop.rentFrequency || 'per week'}` : ''),
        area: prop.landArea || prop.floorArea,
        source: this.name,
        latitude,
        longitude,
        metadata: {
          id: prop.id,
          propertyId: prop.propertyId,
          providerCode: prop.providerCode,
          typeCode: prop.typeCode,
          type: prop.type,
          statusCode: prop.statusCode,
          status: prop.status,
          bedrooms: prop.bedrooms,
          bathrooms: prop.bathrooms,
          carSpaces: prop.carSpaces,
          rentPrice: prop.rentPrice,
          rentFrequency: prop.rentFrequency,
          bond: prop.bond,
          updatedAt: prop.updatedAt,
          suburb: prop.suburb || prop.address?.suburb,
          state: prop.state || prop.address?.state,
          country: prop.address?.country || prop.country // Include country for filtering
        }
      };
    }).filter(listing => {
      // Filter out if criteria specified and doesn't match
      if (criteria.minPrice && listing.price && listing.price < criteria.minPrice) {
        return false;
      }
      if (criteria.maxPrice && listing.price && listing.price > criteria.maxPrice) {
        return false;
      }
      return true;
    });
  }

  /**
   * Fetch multiple pages if needed
   * Note: Most offices limit to 100 results per request
   */
  protected async fetchMultiplePages(maxPages: number = 5): Promise<any[]> {
    const allListings: any[] = [];
    const url = `${this.apiBaseUrl}/api/proxy/v1/listings`;

    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await axios.get(url, {
          params: {
            pageSize: 100,
            page
          },
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
          }
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
          allListings.push(...response.data.data);
          
          // Stop if we got less than requested (last page)
          if (response.data.data.length < 100) {
            break;
          }
        } else {
          break;
        }
      } catch (error) {
        console.error(`[${this.name}] Error fetching page ${page}:`, error);
        break;
      }
    }

    return allListings;
  }
}
