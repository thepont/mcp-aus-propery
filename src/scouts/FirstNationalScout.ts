import { BaseScout, IndustrialListing, SearchParams } from '../types.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

interface ScoutState {
  sitemapIndex: number; // Which numbered sitemap we are on
  listingIndex: number; // Which listing URL within that sitemap we are on
  lastRun: string;
}

interface ListingQueue {
  sitemapUrl: string;
  urls: string[];
  totalInSitemap: number;
}

export class FirstNationalScout extends BaseScout {
// ... (omitting parts for brevity, will match exact context in next step)
  readonly name = 'first_national';
  private readonly STATE_FILE = 'data/fn_scout_state.json';
  private readonly QUEUE_FILE = 'data/fn_queue.json';
  private readonly SITEMAP_INDEX_URL = 'https://www.firstnational.com.au/sitemap.xml';
  private readonly RATE_LIMIT_MS = 6000; // 6 seconds per request

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    // Ensure data directory
    if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });

    let queue = this.loadQueue();
    let state = this.loadState();
    
    // 1. Refill Queue if empty
    if (queue.urls.length === 0) {
        console.error('[FN] Queue empty. Discovering next sitemap...');
        const sitemaps = await this.getSitemapList();
        
        if (sitemaps.length === 0) {
            console.error('[FN] No sitemaps found. Cannot proceed.');
            return [];
        }
        
        if (state.sitemapIndex >= sitemaps.length) {
            console.error('[FN] All sitemaps processed. Restarting cycle.');
            state.sitemapIndex = 0;
        }

        const nextSitemapUrl = sitemaps[state.sitemapIndex];
        console.error(`[FN] Fetching listings from: ${nextSitemapUrl}`);
        
        const newUrls = await this.fetchListingUrls(nextSitemapUrl);
        
        // Update state/queue
        queue = { sitemapUrl: nextSitemapUrl, urls: newUrls, totalInSitemap: newUrls.length };
        state.sitemapIndex++;
        
        this.saveState(state);
        this.saveQueue(queue);
        
        console.error(`[FN] Found ${newUrls.length} listings in sitemap.`);
    }

    const listings: IndustrialListing[] = [];
    const MAX_ITEMS_PER_RUN = 5;
    let processedCount = 0;

    // Report Progress
    const total = queue.totalInSitemap || queue.urls.length;
    const currentProcessed = total - queue.urls.length;
    this.logProgress(currentProcessed, total);

    // 2. Process Queue
    while (processedCount < MAX_ITEMS_PER_RUN && queue.urls.length > 0) {
        const url = queue.urls.shift(); // Get next URL
        if (!url) break;

        // Skip if url is generic (safety check)
        if (!url.includes('/property/')) {
            continue;
        }

        try {
            const listing = await this.scrapeListingPage(url);
            if (listing) {
                // Apply simple client-side filter if criteria provided
                // We'll just push everything to DB
                listings.push(listing);
                processedCount++;
            }
        } catch (error) {
            console.error(`[FN] Failed to scrape ${url}:`, error);
        }

        this.saveQueue(queue);
        
        if (queue.urls.length > 0) {
            await this.waitOrganic();
        }
    }

    return listings;
  }

  private async getSitemapList(): Promise<string[]> {
    const cacheFile = 'data/fn_sitemaps.json';
    if (fs.existsSync(cacheFile)) {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }

    try {
        const response = await axios.get(this.SITEMAP_INDEX_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const parser = new XMLParser();
        const result = parser.parse(response.data);
        const urls: string[] = [];

        // <sitemapindex><sitemap><loc>...</loc></sitemap></sitemapindex>
        const sitemaps = result.sitemapindex?.sitemap || [];
        if (Array.isArray(sitemaps)) {
            sitemaps.forEach((sm: any) => urls.push(sm.loc));
        } else if (sitemaps.loc) {
            urls.push(sitemaps.loc);
        }

        fs.writeFileSync(cacheFile, JSON.stringify(urls));
        return urls;
    } catch (error) {
        console.error('[FN] Error fetching sitemap index:', error);
        return [];
    }
  }

  private async fetchListingUrls(sitemapUrl: string): Promise<string[]> {
    try {
        const response = await axios.get(sitemapUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const parser = new XMLParser();
        const result = parser.parse(response.data);
        const rawUrls: string[] = [];

        const urlSet = result.urlset?.url || [];
        if (Array.isArray(urlSet)) {
            urlSet.forEach((u: any) => rawUrls.push(u.loc));
        } else if (urlSet.loc) {
            rawUrls.push(urlSet.loc);
        }

        // Filter for property URLs
        // Format: /pages/real-estate/buy/property/ID/ADDRESS
        return rawUrls.filter(u => 
            u.includes('/pages/real-estate/') && 
            u.includes('/property/') && 
            (u.includes('/buy/') || u.includes('/rent/'))
        );

    } catch (error) {
        console.error(`[FN] Error fetching sitemap ${sitemapUrl}:`, error);
        return [];
    }
  }

  private async scrapeListingPage(url: string): Promise<IndustrialListing | null> {
    console.error(`[FN] Scraping: ${url}`);
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        
        // Extract JSON-LD
        let jsonLd: any = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const json = JSON.parse($(el).html() || '{}');
                // We want RealEstateListing or Residence
                if (json['@type'] === 'RealEstateListing' || json['@type'] === 'Residence' || json['@type'] === 'SingleFamilyResidence') {
                    jsonLd = json;
                }
            } catch (e) {}
        });

        if (!jsonLd) {
            console.error('[FN] No JSON-LD found, skipping.');
            return null;
        }

        // Map Data
        // contentLocation -> additionalProperty
        const props = jsonLd.contentLocation?.additionalProperty || [];
        const getProp = (name: string) => {
            const p = props.find((x: any) => x.name === name);
            return p ? p.value : null;
        };

        const address = jsonLd.name || jsonLd.contentLocation?.name;
        const price = jsonLd.offers?.price || jsonLd.offers?.[0]?.price;
        const priceCurrency = jsonLd.offers?.priceCurrency || 'AUD';
        
        // Determine listing type
        let listingType: any = url.includes('/rent/') ? 'rental' : 'sale';
        if (jsonLd.offers?.businessFunction?.includes('Lease')) listingType = 'rental';

        // Determine property type
        const rawType = getProp('propertyType') || jsonLd.additionalType;
        let propertyType: any = undefined;
        if (rawType) {
            const t = rawType.toString().toLowerCase();
            if (t.includes('commercial') || t.includes('office') || t.includes('retail')) propertyType = 'commercial';
            else if (t.includes('industrial') || t.includes('warehouse')) propertyType = 'industrial';
            else if (t.includes('land')) propertyType = 'land';
            else if (t.includes('rural') || t.includes('farm')) propertyType = 'rural';
            else propertyType = 'residential';
        }

        // Extract Lat/Long
        let lat: number | undefined;
        let lon: number | undefined;

        // 1. Try JSON-LD Geo
        if (jsonLd.contentLocation?.geo) {
            lat = parseFloat(jsonLd.contentLocation.geo.latitude);
            lon = parseFloat(jsonLd.contentLocation.geo.longitude);
        } else if (jsonLd.geo) {
            lat = parseFloat(jsonLd.geo.latitude);
            lon = parseFloat(jsonLd.geo.longitude);
        }

        // 2. Try Adfenix Tags (HTML comments)
        if (!lat || !lon) {
            const html = response.data;
            const latMatch = html.match(/<!--adfenix-tag-latitude:"([^"]+)"-->/);
            const lonMatch = html.match(/<!--adfenix-tag-longitude:"([^"]+)"-->/);
            if (latMatch && lonMatch) {
                lat = parseFloat(latMatch[1]);
                lon = parseFloat(lonMatch[1]);
            }
        }

        const listing: IndustrialListing = {
            address: address,
            source: 'first_national',
            sourceUrl: url,
            description: jsonLd.description || '',
            price: typeof price === 'number' ? price : undefined,
            priceDisplay: price ? `$${price}` : undefined,
            area: getProp('landSize'),
            listingType,
            propertyType,
            metadata: {
                bedrooms: getProp('numberOfBedrooms'),
                bathrooms: getProp('numberOfBathrooms'),
                parking: getProp('numberOfParkingSpaces'),
                propertyTypeRaw: rawType,
                'Common.Coordinate': (lat && lon) ? { lat, lon } : undefined
            }
        };

        return listing;

    } catch (error) {
        console.error(`[FN] Error scraping page ${url}:`, error);
        return null;
    }
  }

  private loadState(): ScoutState {
    if (fs.existsSync(this.STATE_FILE)) {
      return JSON.parse(fs.readFileSync(this.STATE_FILE, 'utf-8'));
    }
    return { sitemapIndex: 0, listingIndex: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: ScoutState): void {
    state.lastRun = new Date().toISOString();
    fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2));
  }

  private loadQueue(): ListingQueue {
    if (fs.existsSync(this.QUEUE_FILE)) {
      const q = JSON.parse(fs.readFileSync(this.QUEUE_FILE, 'utf-8'));
      if (q.totalInSitemap === undefined) q.totalInSitemap = q.urls.length;
      return q;
    }
    return { sitemapUrl: '', urls: [], totalInSitemap: 0 };
  }

  private saveQueue(queue: ListingQueue): void {
    fs.writeFileSync(this.QUEUE_FILE, JSON.stringify(queue, null, 2));
  }
}
