import { BaseScout, IndustrialListing, SearchParams } from '../types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

interface ScoutState {
  searchPage: number;
  listingType: 'Sale' | 'Lease';
  lastRun: string;
}

interface ListingQueue {
  urls: string[];
  totalDiscovered: number;
}

export class PRDScout extends BaseScout {
// ...
  readonly name = 'prd';
  private readonly STATE_FILE = 'data/prd_scout_state.json';
  private readonly QUEUE_FILE = 'data/prd_queue.json';
  private readonly RATE_LIMIT_MS = 6000; // 6 seconds per request

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    // Ensure data directory
    if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });

    let queue = this.loadQueue();
    let state = this.loadState();
    
    // Determine listing type for discovery
    const targetListingType = criteria.listingType === 'rental' ? 'Lease' : 'Sale';
    if (state.listingType !== targetListingType) {
      // If switching type, reset search page but keep queue? 
      // Safer to just switch focus.
      state.listingType = targetListingType;
      state.searchPage = 1;
    }

    const listings: IndustrialListing[] = [];
    const MAX_ITEMS_PER_RUN = 5; // Process 5 items per run
    let processedCount = 0;

    // Report Progress
    const total = queue.totalDiscovered;
    const currentProcessed = total - queue.urls.length;
    this.logProgress(currentProcessed, total);

    // 1. Discovery Phase: Refill Queue if low
    // If queue is running low (< 10), fetch more from corporate search
    if (queue.urls.length < 10) {
      console.error(`[PRD] Queue low. Discovering from Corporate Search (Page ${state.searchPage})...`);
      
      const newUrls = await this.discoverListings(state.listingType, state.searchPage);
      
      if (newUrls.length > 0) {
        // Add unique URLs to queue
        const existingSet = new Set(queue.urls);
        let added = 0;
        for (const url of newUrls) {
          if (!existingSet.has(url)) {
            queue.urls.push(url);
            queue.totalDiscovered++;
            added++;
          }
        }
        console.error(`[PRD] Added ${added} new listings to queue.`);
        
        // Advance page
        state.searchPage++;
        this.saveState(state);
        this.saveQueue(queue);
      } else {
        console.error('[PRD] No more listings found on search page. Resetting to Page 1.');
        state.searchPage = 1;
        this.saveState(state);
      }
    }

    // 2. Processing Phase: Crawl Detail Pages
    while (processedCount < MAX_ITEMS_PER_RUN && queue.urls.length > 0) {
      const url = queue.urls.shift(); // Get next URL
      if (!url) break;

      try {
        // Skip if it's not a property URL
        if (url.includes('/property-search/') || url.includes('/corporate-search/')) {
           // It's a property page if it has an ID, e.g., /1849754/
           if (!/\/\d+\//.test(url)) {
             continue; 
           }
        }

        const listing = await this.scrapeListingPage(url);
        if (listing) {
          listings.push(listing);
          processedCount++;
        }
      } catch (error) {
        console.error(`[PRD] Failed to scrape ${url}:`, error);
      }

      // Save state
      this.saveQueue(queue);
      
      if (queue.urls.length > 0) {
        await this.waitOrganic();
      }
    }

    return listings;
  }

  private async discoverListings(listingType: string, page: number): Promise<string[]> {
    const url = `https://www.prd.com.au/corporate-search/?listing_type=${listingType}&page=${page}`;
    console.error(`[PRD] Fetching Search: ${url}`);

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        validateStatus: (status) => status === 200 || status === 404
      });

      if (response.status === 404) return [];

      const $ = cheerio.load(response.data);
      const urls: string[] = [];

      $('article.property-card').each((_, el) => {
        const relativeUrl = $(el).attr('data-url');
        if (relativeUrl) {
          if (relativeUrl.startsWith('http')) {
            urls.push(relativeUrl);
          } else {
            urls.push(`https://www.prd.com.au${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`);
          }
        }
      });

      return urls;
    } catch (error) {
      console.error(`[PRD] Discovery error:`, error);
      return [];
    }
  }

  private async scrapeListingPage(url: string): Promise<IndustrialListing | null> {
    console.error(`[PRD] Scraping: ${url}`);
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        
        // 1. Adfenix Comments Extraction
        const adfenixData: Record<string, string> = {};
        const comments = html.match(/<!--adfenix-tag-([^:]+):"([^"]+)"-->/g) || [];
        
        for (const comment of comments) {
            const match = comment.match(/<!--adfenix-tag-([^:]+):"([^"]+)"-->/);
            if (match) {
                adfenixData[match[1]] = match[2];
            }
        }

        // 2. Standard HTML Extraction (Fallback)
        const address = $('.property-banner__address').text().trim() || adfenixData['title'] || '';
        const suburb = adfenixData['city'] || '';
        const fullAddress = suburb ? `${address}, ${suburb}` : address;
        
        const price = $('.property-banner__price').text().trim() || adfenixData['price-display'] || '';
        const description = $('.property-description__text').text().trim() || adfenixData['description'] || '';
        
        // Lat/Long
        let lat = parseFloat(adfenixData['latitude'] || '0');
        let lon = parseFloat(adfenixData['longitude'] || '0');

        // Images
        let images: string[] = [];
        if (adfenixData['images']) {
            images = adfenixData['images'].split(';');
        } else {
            $('.property-gallery__slide img').each((_, el) => {
                const src = $(el).attr('src');
                if (src) images.push(src);
            });
        }

        if (!address) {
            console.error('[PRD] No address found, skipping.');
            return null;
        }

        const listing: IndustrialListing = {
            address: fullAddress,
            source: 'prd',
            sourceUrl: url,
            description: description,
            priceDisplay: price,
            listingType: (adfenixData['listing-type'] === 'Lease' || url.includes('lease')) ? 'rental' : 'sale',
            propertyType: adfenixData['home-type'] as any, // e.g. "House"
            metadata: {
                ...adfenixData,
                images,
                'Common.Coordinate': { lat, lon }
            }
        };

        // Normalize property type
        if (listing.propertyType) {
            const typeLower = listing.propertyType.toLowerCase();
            if (typeLower.includes('house') || typeLower.includes('unit')) listing.propertyType = 'residential';
            if (typeLower.includes('commercial') || typeLower.includes('office')) listing.propertyType = 'commercial';
            if (typeLower.includes('warehouse') || typeLower.includes('industrial')) listing.propertyType = 'industrial';
        }

        return listing;

    } catch (error) {
        console.error(`[PRD] Error fetching page ${url}:`, error);
        return null;
    }
  }

  private loadState(): ScoutState {
    if (fs.existsSync(this.STATE_FILE)) {
      return JSON.parse(fs.readFileSync(this.STATE_FILE, 'utf-8'));
    }
    return { searchPage: 1, listingType: 'Sale', lastRun: new Date().toISOString() };
  }

  private saveState(state: ScoutState): void {
    state.lastRun = new Date().toISOString();
    fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2));
  }

  private loadQueue(): ListingQueue {
    if (fs.existsSync(this.QUEUE_FILE)) {
      const q = JSON.parse(fs.readFileSync(this.QUEUE_FILE, 'utf-8'));
      if (q.totalDiscovered === undefined) q.totalDiscovered = q.urls.length;
      return q;
    }
    return { urls: [], totalDiscovered: 0 };
  }

  private saveQueue(queue: ListingQueue): void {
    fs.writeFileSync(this.QUEUE_FILE, JSON.stringify(queue, null, 2));
  }
}
