import { BaseScout, SearchParams, IndustrialListing, PropertyType, ListingType } from './types.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PropertyService } from './services/PropertyService.js';
import { GnafService } from './services/GnafService.js';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Observable, from, merge, of, timer, EMPTY } from 'rxjs';
import { mergeMap, catchError, takeUntil, tap, toArray, map, concatMap, filter } from 'rxjs/operators';

// @ts-ignore
chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ScoutManager orchestrates all registered agency scouts
 * Auto-discovers and registers scouts from the /scouts directory
 */
export class ScoutManager {
  private scouts: BaseScout[] = [];
  private initialized: boolean = false;
  public db: PropertyService;
  private gnaf: GnafService;
  private sharedBrowser: any = null;

  constructor() {
    this.db = new PropertyService();
    this.gnaf = new GnafService();
  }

  /**
   * Ensure scouts are registered (called automatically on first use)
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.registerScouts();
      // Initialize DB schema for properties table
      await this.db.init();
      this.initialized = true;
    }
  }

  /**
   * Initialize ScoutManager (public API)
   * Pre-registers scouts and launches shared browser
   */
  async init(): Promise<void> {
      await this.ensureInitialized();
      await this.ensureBrowser();
  }

  /**
   * Initialize shared browser instance
   */
  private async ensureBrowser(): Promise<any> {
      if (!this.sharedBrowser) {
          console.error('[ScoutManager] Launching shared browser instance...');
          const launchArgs = [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
          ];
          
          this.sharedBrowser = await chromium.launch({ 
            headless: true,
            args: launchArgs
          });
      }
      return this.sharedBrowser;
  }

  /**
   * Auto-register all scouts from the scouts directory
   */
  private async registerScouts(): Promise<void> {
    const scoutsDir = join(__dirname, 'scouts');
    
    try {
      const files = readdirSync(scoutsDir);
      
      for (const file of files) {
        if (file.endsWith('.js') && !file.endsWith('.d.js')) {
          try {
            const modulePath = join(scoutsDir, file);
            const module = await import(modulePath);
            
            // Find the scout class export
            for (const key of Object.keys(module)) {
              const ExportedClass = module[key];
              
              // Check if it's a class that extends BaseScout
              if (typeof ExportedClass === 'function' && 
                  ExportedClass.prototype instanceof BaseScout) {
                const scout = new ExportedClass() as BaseScout;
                
                // Only register if it has a valid name (skip abstract base classes)
                if (scout.name && scout.name !== 'undefined') {
                  this.scouts.push(scout);
                  console.error(`[ScoutManager] Registered scout: ${scout.name}`);
                }
              }
            }
          } catch (error) {
            console.error(`[ScoutManager] Failed to load scout from ${file}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('[ScoutManager] Failed to read scouts directory:', error);
    }
  }

  /**
   * Manually register a scout instance
   */
  registerScout(scout: BaseScout): void {
    this.scouts.push(scout);
    console.error(`[ScoutManager] Manually registered scout: ${scout.name}`);
  }

  /**
   * Directly search existing indexed properties in DB
   */
  async getExistingProperties(criteria: SearchParams): Promise<IndustrialListing[]> {
    await this.ensureInitialized();
    return this.db.search(criteria);
  }

  /**
   * Calculate distance between two coordinates in KM
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Search and stream results as they arrive
   */
  search$(criteria: SearchParams): Observable<IndustrialListing> {
    return from(this.ensureInitialized().then(() => this.ensureBrowser())).pipe(
      mergeMap(async (browser) => {
        // Share browser
        this.scouts.forEach(s => s.setBrowser(browser));
        
        const isGeneralSync = !criteria.location || criteria.location === 'Any';
        
        // 1. Resolve coordinates for the search location
        let searchCoords: { lat: number, lon: number } | null = null;
        if (criteria.lat && criteria.lon) {
            searchCoords = { lat: criteria.lat, lon: criteria.lon };
        } else if (criteria.location && criteria.location !== 'Any') {
            const resolved = await this.gnaf.resolveAddress(criteria.location);
            if (resolved) {
                searchCoords = { lat: resolved.lat, lon: resolved.lon };
            }
        }

        // 2. Filter scouts based on relevance area
        const relevantScouts = this.scouts.filter(scout => {
            if (!scout.relevanceArea || !searchCoords) return true; // National scout or unknown location
            
            const distance = this.calculateDistance(
                searchCoords.lat, searchCoords.lon,
                scout.relevanceArea.lat, scout.relevanceArea.lon
            );
            
            const isRelevant = distance <= scout.relevanceArea.radiusKm;
            if (!isRelevant) {
                // console.error(`[ScoutManager] Skipping ${scout.name} (too far: ${distance.toFixed(1)}km > ${scout.relevanceArea.radiusKm}km)`);
            }
            return isRelevant;
        });

        console.error(`[ScoutManager] ${isGeneralSync ? 'Syncing' : 'Searching'} with ${relevantScouts.length}/${this.scouts.length} scouts`);
        return { browser, relevantScouts };
      }),
      mergeMap(({ relevantScouts }) => {
        const scoutStreams = relevantScouts.map(scout => {
          return from(scout.search(criteria)).pipe(
            // Flatten array of listings into individual emissions
            mergeMap(listings => from(listings)),
            tap(listing => {
               // Log discovery (optional, verbose)
               // console.error(`[Stream] ${scout.name} found: ${listing.address}`);
            }),
            catchError(err => {
              console.error(`[ScoutManager] ❌ ${scout.name} stream error: ${err.message}`);
              return EMPTY; // Continue other scouts even if one fails
            })
          );
        });

        // Merge all scout streams
        return merge(...scoutStreams).pipe(
          // Index each property as it arrives, SERIALLY to avoid DB locks/races
          concatMap(async (listing) => {
              if (!listing.propertyType) listing.propertyType = this.inferPropertyType(listing);
              if (!listing.listingType) listing.listingType = this.inferListingType(listing);
              await this.db.indexProperty(listing);
              return listing;
          }),
          // Global timeout: Stop the stream after 35 seconds to ensure we respond
          takeUntil(timer(35000))
        ) as Observable<IndustrialListing>;
      })
    );
  }

  /**
   * Execute all scouts and return aggregate (Promise wrapper around search$)
   */
  async findProperties(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    console.error('[ScoutManager] Starting stream-based search...');
    
    return new Promise((resolve) => {
      this.search$(criteria).subscribe({
        next: (listing) => {
          listings.push(listing);
        },
        error: (err) => {
          console.error('[ScoutManager] Fatal stream error:', err);
          resolve(listings);
        },
        complete: () => {
          console.error(`[ScoutManager] Stream complete. Found ${listings.length} listings.`);
          resolve(listings);
        }
      });
    });
  }

  // ... (Rest of the class) ...

  /**
   * Infer property type from listing data when not explicitly set
   */
  private inferPropertyType(listing: IndustrialListing): PropertyType | undefined {
    const text = `${listing.description} ${listing.zoning || ''} ${listing.address}`.toLowerCase();
    const priceText = (listing.priceDisplay || '').toLowerCase();

    // Industrial keywords
    if (text.includes('industrial') || text.includes('warehouse') || text.includes('factory') ||
        text.includes('manufacturing') || text.includes('logistics') || text.includes('distribution') ||
        text.includes('workshop') || text.includes('storage')) {
      return 'industrial';
    }

    // Commercial keywords
    if (text.includes('commercial') || text.includes('office') || text.includes('retail') ||
        text.includes('shop') || text.includes('showroom') || text.includes('medical') ||
        text.includes('restaurant') || text.includes('cafe') || text.includes('suite')) {
      return 'commercial';
    }

    // Rural keywords
    if (text.includes('rural') || text.includes('farm') || text.includes('acreage') ||
        text.includes('agricultural') || text.includes('lifestyle') || text.includes('hectare')) {
      return 'rural';
    }

    // Land keywords
    if (text.includes('vacant land') || text.includes('land for sale') || text.includes('development site') ||
        text.includes('block') || (text.includes('land') && !text.includes('landlord'))) {
      return 'land';
    }

    // Residential keywords - expanded to catch more
    if (text.includes('house') || text.includes('apartment') || text.includes('unit') ||
        text.includes('townhouse') || text.includes('villa') || text.includes('bedroom') ||
        text.includes('bathroom') || text.includes('residential') || text.includes('home') ||
        text.includes('living') || text.includes('family') || text.includes('kitchen') ||
        text.includes('garage') || text.includes('courtyard') || text.includes('garden') ||
        text.includes('renovated') || text.includes('modern') || text.includes('spacious') ||
        text.includes('cosy') || text.includes('cozy') || text.includes('neat') ||
        text.includes('quiet') || text.includes('furnished') || text.includes('unfurnished') ||
        // Common rental residential patterns
        priceText.includes('pw') || priceText.includes('per week') ||
        priceText.includes('pcm') || priceText.includes('per month')) {
      return 'residential';
    }

    return undefined;
  }

  /**
   * Infer listing type (sale vs rental) from listing data when not explicitly set
   */
  private inferListingType(listing: IndustrialListing): ListingType | undefined {
    const text = `${listing.description} ${listing.priceDisplay || ''} ${listing.zoning || ''} ${listing.address}`.toLowerCase();

    // Rental indicators
    if (text.includes('for rent') || text.includes('for lease') || text.includes('rental') ||
        text.includes('leasing') || text.includes('pw') || text.includes('per week') ||
        text.includes('pcm') || text.includes('per month') || text.includes('/week') ||
        text.includes('/month') || text.includes('p.w') || text.includes('p.m') ||
        // Check if price is like "$500" without large numbers
        (listing.price && listing.price < 5000 && !text.includes('sale'))) {
      return 'rental';
    }

    // Sale indicators
    if (text.includes('for sale') || text.includes('auction') || text.includes('eoi') ||
        text.includes('expression of interest') || text.includes('offers') ||
        text.includes('price guide') || text.includes('asking') || 
        text.includes('from') || text.includes('plus') || 
        text.includes('$') || (listing.price && listing.price > 5000)) {
      return 'sale';
    }

    // Default to sale for targeted searches if no rental indicators
    return 'sale';
  }

  /**
   * Get list of registered scout names
   */
  async getScoutNames(): Promise<string[]> {
    await this.ensureInitialized();
    return this.scouts.map(s => s.name);
  }

  /**
   * Cleanup all scouts
   */
  async cleanup(): Promise<void> {
    for (const scout of this.scouts) {
      if ('cleanup' in scout && typeof (scout as any).cleanup === 'function') {
        await (scout as any).cleanup();
      }
    }
    
    if (this.sharedBrowser) {
        console.error('[ScoutManager] Closing shared browser...');
        await this.sharedBrowser.close();
        this.sharedBrowser = null;
    }
  }
}
