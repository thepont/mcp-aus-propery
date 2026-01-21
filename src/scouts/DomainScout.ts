import { BaseScout, IndustrialListing, SearchParams } from '../types.js';
import { GnafService } from '../services/GnafService.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import crypto from 'crypto';

interface DomainState {
  scanId: string;
  queue: string[];
  totalCount: number;
  lastRun: string;
}

export class DomainScout extends BaseScout {
  readonly name = 'domain';
  private gnafService: GnafService;
  private readonly SITEMAP_URL = 'https://www.domain.com.au/sitemap-listings-sale.xml';
  private readonly STATE_FILE = 'data/domain_state.json';

  constructor() {
    super();
    this.gnafService = new GnafService(); // Connects to ./data/mcp.db via Singleton
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error('[Domain] Starting synchronization...');
    let state = this.loadState();

    // 1. Initialize Scan ID if needed
    if (!state.scanId) {
        state.scanId = crypto.randomUUID();
        console.error(`[Domain] Starting new scan session: ${state.scanId}`);
    }

    // 2. Refill Queue if empty
    if (state.queue.length === 0) {
        console.error('[Domain] Queue empty. Fetching fresh sitemap...');
        const urls = await this.fetchSitemapUrls();
        
        if (urls.length > 0) {
            state.queue = urls;
            state.totalCount = urls.length;
            console.error(`[Domain] Queue refilled with ${urls.length} listings.`);
        } else {
            console.error('[Domain] No listings found in sitemap. Retrying later.');
            return [];
        }
    }
    
    const listings: IndustrialListing[] = [];
    let matchCount = 0;

    // Report Progress
    const total = state.totalCount || state.queue.length;
    const currentProcessed = total - state.queue.length;
    this.logProgress(currentProcessed, total);

    // Process a batch (to respect constraints)
    const BATCH_SIZE = 50; 
    const batch = state.queue.splice(0, BATCH_SIZE);

    for (const url of batch) {
      const addressData = this.parseUrl(url);
      if (!addressData) continue;

      // Resolve against G-NAF
      const gnafPid = await this.gnafService.resolveAddress(addressData.addressString);
      
      if (gnafPid) {
        // console.error(`[Domain] Matched ${addressData.addressString} -> ${gnafPid}`);
        await this.gnafService.updateListing(gnafPid, url, undefined, state.scanId);
        matchCount++;
        
        listings.push({
            address: addressData.addressString,
            source: 'domain',
            sourceUrl: url,
            description: 'Matched G-NAF Property',
            listingType: 'sale',
            metadata: { gnafPid, scanId: state.scanId }
        });
      }
    }

    console.error(`[Domain] Synced ${matchCount} properties to G-NAF DB. Remaining in queue: ${state.queue.length}`);
    
    // 3. Check for Completion & Prune
    if (state.queue.length === 0) {
        console.error(`[Domain] Scan complete for ${state.scanId}. Pruning old listings...`);
        const pruned = await this.gnafService.pruneListings('domain', state.scanId);
        console.error(`[Domain] Pruned ${pruned} old listings.`);
        
        // Reset for next scan
        state.scanId = ''; // Will generate new one next time
    }

    this.saveState(state);
    return listings;
  }

  private loadState(): DomainState {
    if (fs.existsSync(this.STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(this.STATE_FILE, 'utf-8'));
      if (s.totalCount === undefined) s.totalCount = s.queue.length;
      return s;
    }
    return { scanId: '', queue: [], totalCount: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: DomainState): void {
    state.lastRun = new Date().toISOString();
    if (!fs.existsSync('data')) fs.mkdirSync('data');
    fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2));
  }

  private async fetchSitemapUrls(): Promise<string[]> {
    try {
      // Logic to fetch recursive sitemaps if this is an index, 
      // but 'sitemap-listings-sale.xml' is often a flat list or split by date.
      // We'll assume it's a list for now or handled via recursion if needed.
      const response = await axios.get(this.SITEMAP_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
      });
      
      const parser = new XMLParser();
      const result = parser.parse(response.data);
      const urls: string[] = [];
      
      const urlSet = result.urlset?.url || [];
      if (Array.isArray(urlSet)) {
        urlSet.forEach((u: any) => urls.push(u.loc));
      } else if (urlSet.loc) {
        urls.push(urlSet.loc);
      }
      
      return urls;
    } catch (error) {
      console.error('[Domain] Sitemap fetch failed:', error);
      return [];
    }
  }

  private parseUrl(url: string): { addressString: string, id: string } | null {
    try {
      // Example: https://www.domain.com.au/23-some-street-suburb-nsw-2000-2018829332
      const match = url.match(/domain\.com\.au\/(.+)-(\d+)$/);
      if (match) {
        const slug = match[1];
        const id = match[2];
        // Convert slug to address string: "23-some-street-suburb-nsw-2000" -> "23 some street suburb nsw 2000"
        const addressString = slug.replace(/-/g, ' '); 
        return { addressString, id };
      }
    } catch (e) { }
    return null;
  }
}