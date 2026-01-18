import { VaultREScout } from './VaultREScout.js';

import { VaultREScout } from './VaultREScout.js';
import type { SearchParams, IndustrialListing } from '../types.js';

/**
 * Ray White Network Scout (via Ballarat portal)
 * 
 * ⚠️ IMPORTANT: This API returns ALL Ray White properties across Australia & New Zealand!
 * The API endpoint at raywhiteballarat.com.au is a gateway to the entire Ray White network.
 * 
 * Coverage:
 * - ALL Ray White offices in Australia & New Zealand (94,753 properties)
 * - Residential (sale/rent) - 50/50 split
 * - Commercial properties
 * - Industrial properties  
 * - Land
 * 
 * Geographic Coverage:
 * - 🇦🇺 Australia: New South Wales, Victoria, Queensland, South Australia, Western Australia
 * - 🇳🇿 New Zealand: All regions
 * 
 * Property Types:
 * - SAL (Sale) - 50%
 * - REN (Rental) - 50%
 * - COM (Commercial)
 * 
 * API: https://raywhiteballarat.com.au/api/proxy/v1/listings
 * Total properties: 94,753 (network-wide)
 * Provider: VAULT (VaultRE system)
 * 
 * Note: Use search criteria location parameter to filter by suburb/state/country
 */
export class RayWhiteBallaratScout extends VaultREScout {
  readonly name = 'Ray White Network (AU/NZ)';
  protected readonly apiBaseUrl = 'https://raywhiteballarat.com.au';

  /**
   * Override to add location-based filtering and Australia-only option
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    const allListings = await super.search(criteria);

    // Default: Filter to Australia only (exclude NZ unless explicitly requested)
    let filtered = allListings.filter(listing => {
      const metadata = listing.metadata as any;
      const country = metadata?.country;
      
      // If location includes "new zealand" or "nz", include NZ properties
      if (criteria.location?.toLowerCase().includes('new zealand') || 
          criteria.location?.toLowerCase().includes(' nz')) {
        return country === 'New Zealand';
      }
      
      // Otherwise, default to Australia only
      return country === 'Australia' || !country; // Include if country not set
    });

    // If location specified, further filter by suburb/state
    if (criteria.location) {
      const location = criteria.location.toLowerCase()
        .replace('new zealand', '')
        .replace(' nz', '')
        .trim();
      
      if (location) {
        filtered = filtered.filter(listing => {
          const address = listing.address.toLowerCase();
          const metadata = listing.metadata as any;
          const state = (metadata?.state || '').toLowerCase();
          const suburb = (metadata?.suburb || '').toLowerCase();
          
          return address.includes(location) || 
                 state.includes(location) || 
                 suburb.includes(location);
        });
      }
    }

    return filtered;
  }
}
