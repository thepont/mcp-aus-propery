import { VaultREScout } from './VaultREScout.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';

interface RayWhiteState {
  lastCreationTime: string;
  totalProcessed: number;
  isBlocked?: boolean;
  lastRun: string;
}

/**
 * Ray White Network Scout (Direct API Implementation)
 * 
 * Uses the direct dynamics.net API which provides network-wide listings.
 * Optimized with watermarking to handle 94k+ properties without re-spamming.
 */
export class RayWhiteBallaratScout extends VaultREScout {
  readonly name = 'Ray White Network (AU/NZ)';
  protected readonly apiBaseUrl = 'https://raywhiteapi.ep.dynamics.net';
  private readonly apiKey = '6625c417-067a-4a8e-8c1d-85c812d0fb25';

  protected get stateFile(): string {
    return `data/raywhite_network_state.json`;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
      const state = this.loadRayWhiteState();

      if (state.isBlocked && state.lastRun) {
        const hoursSinceBlock = (new Date().getTime() - new Date(state.lastRun).getTime()) / (1000 * 60 * 60);
        if (hoursSinceBlock < 1) {
          console.log(`[${this.name}] Region blocked. Skipping for now.`);
          return [];
        }
        state.isBlocked = false;
      }

      // Determine sorting and filtering
      // For general sync, we use ASC to crawl forward from lastCreationTime
      // For specific location search, we use DESC to get newest results
      const isGeneralSync = !criteria.location || criteria.location === 'Any';
      const sortDir = isGeneralSync ? 'asc' : 'desc';
      
      const queryParams = [
        `from:0`,
        `size:50`,
        `sort:!('creationTime ${sortDir}','id ${sortDir}')`,
        `statusCode:CUR`
      ];

      // If syncing, start from where we left off
      if (isGeneralSync && state.lastCreationTime) {
        queryParams.push(`creationTime:['${state.lastCreationTime}' TO *]`);
      }

      const url = `${this.apiBaseUrl}/v1/listings?apiKey=${this.apiKey}&q=${encodeURIComponent(queryParams.join(','))}`;
      
      console.log(`[${this.name}] Fetching direct API (${sortDir})...`);
      
      // Jittered backoff
      await this.sleep(3000);

      const axiosConfig: any = {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      };

      // Add Proxy
      const proxy = this.getProxyConfig();
      if (proxy) {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);
        console.log(`[${this.name}] Using proxy: ${proxy.server}`);
      }

      const response = await axios.get(url, axiosConfig);
      
      state.isBlocked = false;
      
      if (!response.data || !response.data.data || response.data.data.length === 0) {
        return [];
      }

      const rawListings = response.data.data;
      const listings = this.parseRayWhiteListings(rawListings, criteria);

      if (isGeneralSync && rawListings.length > 0) {
        // Update watermark with the latest creationTime in this batch
        // Since we sorted ASC, it's the last item
        const lastItem = rawListings[rawListings.length - 1].value;
        if (lastItem.creationTime) {
          state.lastCreationTime = lastItem.creationTime;
        }
        state.totalProcessed += rawListings.length;
        this.saveRayWhiteState(state);
        
        const totalAvailable = response.data.hits || 94000;
        this.logProgress(state.totalProcessed, totalAvailable);
      }

      return listings;

    } catch (error: any) {
      if (error.response?.status === 403) {
        const state = this.loadRayWhiteState();
        state.isBlocked = true;
        this.saveRayWhiteState(state);
      }
      console.error(`[${this.name}] API Error:`, error.message);
      return [];
    }
  }

  private parseRayWhiteListings(data: any[], criteria: SearchParams): IndustrialListing[] {
    // We can reuse the VaultRE parsing logic since the data structure is identical
    // But we'll filter by location here as well
    let listings = (this as any).parseVaultREListings(data, criteria);

    if (criteria.location && criteria.location !== 'Any') {
      const loc = criteria.location.toLowerCase();
      listings = listings.filter((l: any) => 
        l.address.toLowerCase().includes(loc) || 
        (l.metadata?.suburb || '').toLowerCase().includes(loc) ||
        (l.metadata?.state || '').toLowerCase().includes(loc)
      );
    }

    return listings;
  }

  private loadRayWhiteState(): RayWhiteState {
    if (fs.existsSync(this.stateFile)) {
      try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')); } catch (e) {}
    }
    return { lastCreationTime: '', totalProcessed: 0, lastRun: new Date().toISOString() };
  }

  private saveRayWhiteState(state: RayWhiteState): void {
    state.lastRun = new Date().toISOString();
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2)); } catch (e) {}
  }
}