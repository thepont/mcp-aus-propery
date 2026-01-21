import { BaseScout, SearchParams, IndustrialListing, PropertyType, ListingType } from './types.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PropertyService } from './services/PropertyService.js';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

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
  private db: PropertyService;
  private sharedBrowser: any = null;

  constructor() {
    this.db = new PropertyService();
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
   * Execute all scouts in parallel and aggregate results
   * Deduplicates by address, filters by criteria, and returns combined listings
   */
  async findProperties(criteria: SearchParams): Promise<IndustrialListing[]> {
    await this.ensureInitialized();
    const browser = await this.ensureBrowser();

    // Share browser with scouts
    for (const scout of this.scouts) {
        scout.setBrowser(browser);
    }

    const isGeneralSync = !criteria.location || criteria.location === 'Any';
    console.error(`[ScoutManager] ${isGeneralSync ? 'Syncing' : 'Searching'} with ${this.scouts.length} scouts for: ${JSON.stringify(criteria)}`);

    const SCOUT_TIMEOUT_MS = 30000; // 30 second timeout per scout

    // Execute all scouts in parallel with timeout
    const results = await Promise.allSettled(
      this.scouts.map(async (scout) => {
          console.error(`[ScoutManager] Starting search for ${scout.name}...`);
          const startTime = Date.now();
          
          try {
              const timeoutPromise = new Promise<IndustrialListing[]>((_, reject) => 
                  setTimeout(() => reject(new Error('Scout timed out')), SCOUT_TIMEOUT_MS)
              );
              
              const listings = await Promise.race([scout.search(criteria), timeoutPromise]);
              const duration = Date.now() - startTime;
              console.error(`[ScoutManager] ✅ ${scout.name} finished in ${duration}ms. Found ${listings.length} listings.`);
              return listings;
          } catch (error: any) {
              const duration = Date.now() - startTime;
              if (error.message === 'Scout timed out') {
                  console.error(`[ScoutManager] ⏱️ ${scout.name} timed out after ${duration}ms.`);
              } else {
                  console.error(`[ScoutManager] ❌ ${scout.name} failed after ${duration}ms: ${error.message}`);
              }
              throw error;
          }
      })
    );

    // Collect and Index all successful results
    const listingsInThisRun: IndustrialListing[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const scout = this.scouts[i];

      if (result.status === 'fulfilled') {
        const listings = result.value;
        console.error(`[ScoutManager] ${scout.name} returned ${listings.length} listings`);
        
        for (const listing of listings) {
          if (!listing.propertyType) listing.propertyType = this.inferPropertyType(listing);
          if (!listing.listingType) listing.listingType = this.inferListingType(listing);
          
          await this.db.indexProperty(listing);
          listingsInThisRun.push(listing);
        }
      } else {
        console.error(`[ScoutManager] ${scout.name} failed:`, result.reason);
      }
    }

    console.error(`[ScoutManager] Indexed ${listingsInThisRun.length} listings from this run.`);

    return listingsInThisRun;
  }

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
    const text = `${listing.description} ${listing.priceDisplay || ''} ${listing.zoning || ''}`.toLowerCase();

    // Rental indicators
    if (text.includes('for rent') || text.includes('for lease') || text.includes('rental') ||
        text.includes('leasing') || text.includes('pw') || text.includes('per week') ||
        text.includes('pcm') || text.includes('per month') || text.includes('/week') ||
        text.includes('/month') || text.includes('p.w') || text.includes('p.m')) {
      return 'rental';
    }

    // Sale indicators
    if (text.includes('for sale') || text.includes('auction') || text.includes('eoi') ||
        text.includes('expression of interest') || text.includes('offers') ||
        text.includes('price guide') || text.includes('asking')) {
      return 'sale';
    }

    return undefined;
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
