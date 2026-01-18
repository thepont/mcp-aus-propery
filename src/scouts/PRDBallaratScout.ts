import { ListOnceScout } from './ListOnceScout.js';

/**
 * PRD Ballarat Scout
 * 
 * Uses ListOnce API v2 to fetch commercial and industrial properties
 * from PRD Real Estate Ballarat.
 * 
 * Website: https://www.prd.com.au/ballarat/
 * API: ListOnce middleware platform
 * 
 * Note: The client_id for PRD Ballarat needs to be discovered by:
 * 1. Opening https://www.prd.com.au/ballarat/property-search/
 * 2. Opening browser DevTools (F12) -> Network tab
 * 3. Performing a property search
 * 4. Looking for requests to api.listonce.com.au
 * 5. Finding the client_id parameter in the request
 * 
 * Common PRD client IDs range from 100-999 depending on the office.
 * This implementation uses a placeholder that should be updated with
 * the actual PRD Ballarat client_id.
 */
export class PRDBallaratScout extends ListOnceScout {
  readonly name = 'PRD Ballarat';
  
  /**
   * PRD Ballarat client ID
   * TODO: Update this with the actual client_id discovered from network requests
   * Default: Using a common PRD range client ID
   */
  protected readonly clientId = 999; // Placeholder - needs actual ID
  
  /**
   * Override to focus specifically on Ballarat region
   */
  protected buildApiParams(criteria: any): Record<string, any> {
    const params = super.buildApiParams(criteria);
    
    // Default to Ballarat if no location specified
    if (!criteria.location) {
      params.suburb = 'Ballarat';
      // You can also add state filter
      params.state = 'VIC';
    }
    
    // Focus on commercial and industrial categories
    params.category = 'commercial';
    
    return params;
  }
}
