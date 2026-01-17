import { BaseScout, SearchParams, IndustrialListing } from './types.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ScoutManager orchestrates all registered agency scouts
 * Auto-discovers and registers scouts from the /scouts directory
 */
export class ScoutManager {
  private scouts: BaseScout[] = [];
  private initialized: boolean = false;

  constructor() {
    // Initialize synchronously - scouts will be registered on first use
  }

  /**
   * Ensure scouts are registered (called automatically on first use)
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.registerScouts();
      this.initialized = true;
    }
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
                this.scouts.push(scout);
                console.error(`[ScoutManager] Registered scout: ${scout.name}`);
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
   * Execute all scouts in parallel and aggregate results
   * Deduplicates by address and returns combined listings
   */
  async findIndustrialDeals(criteria: SearchParams): Promise<IndustrialListing[]> {
    await this.ensureInitialized();
    
    console.error(`[ScoutManager] Searching with ${this.scouts.length} scouts for: ${JSON.stringify(criteria)}`);
    
    // Execute all scouts in parallel using Promise.allSettled
    const results = await Promise.allSettled(
      this.scouts.map(scout => scout.search(criteria))
    );

    // Collect all successful results
    const allListings: IndustrialListing[] = [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const scout = this.scouts[i];
      
      if (result.status === 'fulfilled') {
        console.error(`[ScoutManager] ${scout.name} returned ${result.value.length} listings`);
        allListings.push(...result.value);
      } else {
        console.error(`[ScoutManager] ${scout.name} failed:`, result.reason);
      }
    }

    // Deduplicate by address (case-insensitive, normalized)
    const deduped = this.deduplicateListings(allListings);
    
    console.error(`[ScoutManager] Total listings after deduplication: ${deduped.length}`);
    
    return deduped;
  }

  /**
   * Deduplicate listings by normalized address
   */
  private deduplicateListings(listings: IndustrialListing[]): IndustrialListing[] {
    const seen = new Map<string, IndustrialListing>();
    
    for (const listing of listings) {
      const normalizedAddress = this.normalizeAddress(listing.address);
      
      if (!seen.has(normalizedAddress)) {
        seen.set(normalizedAddress, listing);
      } else {
        // If duplicate, prefer the one with more complete data
        const existing = seen.get(normalizedAddress)!;
        if (listing.description.length > existing.description.length) {
          seen.set(normalizedAddress, listing);
        }
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Normalize address for comparison
   */
  private normalizeAddress(address: string): string {
    return address
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,]/g, '')
      .trim();
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
  }
}
