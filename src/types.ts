/**
 * Property type classification
 */
import fs from 'fs';

export type PropertyType = 'residential' | 'commercial' | 'industrial' | 'land' | 'rural';

/**
 * Listing type (sale vs rental)
 */
export type ListingType = 'sale' | 'rental';

/**
 * Search parameters for property queries
 */
export interface SearchParams {
  /** Location: suburb or region (e.g., "Parramatta", "Western Sydney") */
  location: string;

  /** Latitude for radius search */
  lat?: number;

  /** Longitude for radius search */
  lon?: number;

  /** Radius in kilometers */
  radius?: number;

  /** Minimum price in AUD */
  minPrice?: number;

  /** Maximum price in AUD */
  maxPrice?: number;

  /** Zoning codes (e.g., IN1Z, IN2Z, IN3Z) */
  zoning?: string[];

  /** Property type filter (residential, commercial, industrial, land, rural) */
  propertyType?: PropertyType;

  /** Listing type filter (sale or rental) */
  listingType?: ListingType;
}

/**
 * Standard property listing format
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

  /** Property type (residential, commercial, industrial, land, rural) */
  propertyType?: PropertyType;

  /** Listing type (sale or rental) */
  listingType?: ListingType;

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

  /**
   * Helper to log standardized progress percentage
   */
  protected logProgress(current: number, total: number): void {
    const percent = total > 0 ? ((current / total) * 100).toFixed(1) : '0.0';
    console.error(`[${this.name}] Progress: ${percent}% (${current}/${total})`);
  }

  /**
   * Standard sleep/delay utility with jitter
   */
  protected async sleep(ms: number, jitter: boolean = true): Promise<void> {
    const delay = jitter ? ms + (Math.random() * ms * 0.5) : ms;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Standard organic-looking delay (2-5 seconds)
   */
  protected async waitOrganic(): Promise<void> {
    await this.sleep(2000 + Math.random() * 3000, false);
  }

  /**
   * Get proxy configuration if enabled
   */
  protected getProxyConfig() {
    let proxyUrl = process.env.HTTP_PROXY;
    if (!proxyUrl) return null;

    // Handle Docker -> Host mapping for localhost
    const isDocker = fs.existsSync('/.dockerenv');
    if (isDocker && proxyUrl.includes('localhost')) {
      proxyUrl = proxyUrl.replace('localhost', 'host.docker.internal');
    }
    if (isDocker && proxyUrl.includes('127.0.0.1')) {
      proxyUrl = proxyUrl.replace('127.0.0.1', 'host.docker.internal');
    }
    
    try {
      const url = new URL(proxyUrl);
      return {
        server: proxyUrl,
        host: url.hostname,
        port: parseInt(url.port)
      };
    } catch (e) {
      return null;
    }
  }
}
