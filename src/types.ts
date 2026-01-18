/**
 * Search parameters for industrial property queries
 */
export interface SearchParams {
  /** Location: suburb or region (e.g., "Parramatta", "Western Sydney") */
  location: string;
  
  /** Minimum price in AUD */
  minPrice?: number;
  
  /** Maximum price in AUD */
  maxPrice?: number;
  
  /** Zoning codes (e.g., IN1Z, IN2Z, IN3Z) */
  zoning?: string[];
}

/**
 * Standard industrial property listing format
 */
export interface IndustrialListing {
  /** Property address */
  address: string;
  
  /** Zoning classification */
  zoning?: string;
  
  /** Full property description for LLM analysis */
  description: string;
  
  /** Source URL for the listing */
  sourceUrl: string;
  
  /** Price in AUD (if available) */
  price?: number;
  
  /** Price as display string (e.g., "Contact Agent", "$500,000 - $600,000") */
  priceDisplay?: string;
  
  /** Property area in sqm */
  area?: number;
  
  /** Source agency name */
  source: string;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Abstract base class for all agency scouts
 */
export abstract class BaseScout {
  /** Scout identifier (agency name) */
  abstract readonly name: string;
  
  /**
   * Search for industrial properties matching the criteria
   * @param criteria Search parameters
   * @returns Array of industrial listings
   */
  abstract search(criteria: SearchParams): Promise<IndustrialListing[]>;
}
