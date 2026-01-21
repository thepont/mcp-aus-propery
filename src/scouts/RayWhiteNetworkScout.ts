import { VaultREScout } from './VaultREScout.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import { GnafService } from '../services/GnafService.js';

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

      const isGeneralSync = !criteria.location || criteria.location === 'Any';
      let response: any;

      if (!isGeneralSync) {
          // Targeted Search Step 1: Resolve Suburb to Coords via API
          console.log(`[${this.name}] Resolving location via Ray White API: ${criteria.location}`);
          
          const suburbUrl = `${this.apiBaseUrl}/v1/suburbs?apiKey=${this.apiKey}`;
          const suburbBody = {
              "from": 0,
              "countryCode": ["AU"],
              "partialName": criteria.location.toLowerCase()
          };

          const axiosConfig: any = {
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Origin': 'https://www.raywhite.com',
              'Referer': 'https://www.raywhite.com/'
            }
          };

          const proxy = this.getProxyConfig();
          if (proxy) axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);

          let lat: number | undefined;
          let lon: number | undefined;

          try {
              const suburbResponse = await axios.post(suburbUrl, suburbBody, axiosConfig);
              if (suburbResponse.data?.data?.length > 0) {
                  const location = suburbResponse.data.data[0].value.location;
                  lat = location.lat;
                  lon = location.lon;
                  console.log(`[${this.name}] Resolved '${criteria.location}' to ${lat},${lon}`);
              }
          } catch (e: any) {
              console.error(`[${this.name}] Suburb resolution failed:`, e.message);
          }

          // Fallback to G-NAF if API failed
          if (!lat || !lon) {
              console.log(`[${this.name}] Falling back to G-NAF for coordinates...`);
              const gnaf = new GnafService();
              const area = await gnaf.getAreaContext(criteria.location);
              if (area) {
                  lat = area.lat;
                  lon = area.lon;
              }
          }

          if (!lat || !lon) {
              console.warn(`[${this.name}] Could not resolve location '${criteria.location}'. Skipping.`);
              return [];
          }

          // Targeted Search Step 2: POST to listings with coordinates
          const listingsUrl = `${this.apiBaseUrl}/v1/listings?apiKey=${this.apiKey}`;
          const listingsBody: any = {
              "size": 50,
              "from": 0,
              "sort": [{"field":"location","lat":lat,"lon":lon,"order":"asc"}],
              "location": {"lat":lat,"lon":lon},
              "countryCode": ["AU","NZ"],
              "statusCode": {"in": ["CUR"]}
          };

          // Apply property type filter if possible
          if (criteria.propertyType === 'residential') {
              listingsBody.typeCode = { "in": ["RUR", "SAL"] }; // From user's curl
          } else if (criteria.propertyType === 'industrial') {
              // We'll leave it broad and filter in parse logic to be safe
          }

          console.log(`[${this.name}] POST search at ${lat},${lon}...`);
          response = await axios.post(listingsUrl, listingsBody, axiosConfig);

      } else {
          // General Sync (GET)
          const sortDir = 'asc';
          const queryParams = [
            `from:0`,
            `size:50`,
            `sort:!('creationTime ${sortDir}','id ${sortDir}')`,
            `statusCode:CUR`
          ];
          if (state.lastCreationTime) queryParams.push(`creationTime:['${state.lastCreationTime}' TO *]`);
          
          const url = `${this.apiBaseUrl}/v1/listings?apiKey=${this.apiKey}&q=${encodeURIComponent(queryParams.join(','))}`;
          
          const axiosConfig: any = {
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          };
          const proxy = this.getProxyConfig();
          if (proxy) axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);

          response = await axios.get(url, axiosConfig);
      }
      
      state.isBlocked = false;
      
      if (!response.data || !response.data.data || response.data.data.length === 0) {
        return [];
      }

      const rawListings = response.data.data;
      const listings = this.parseRayWhiteListings(rawListings, criteria);

      if (isGeneralSync && rawListings.length > 0) {
        // Update watermark
        const lastItem = rawListings[rawListings.length - 1].value;
        if (lastItem.creationTime) {
          state.lastCreationTime = lastItem.creationTime;
        }
        state.totalProcessed += rawListings.length;
        this.saveRayWhiteState(state);
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