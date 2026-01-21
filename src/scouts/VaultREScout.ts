import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing, PropertyType, ListingType } from '../types.js';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';

interface VaultState {
  lastPage: number;
  totalHits: number;
  lastRun: string;
  isBlocked?: boolean;
}

/**
 * Base class for VaultRE-powered agencies
 */
export abstract class VaultREScout extends BaseScout {
  protected abstract readonly apiBaseUrl: string;
  
  protected get stateFile(): string {
    const safeName = this.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `data/vault_${safeName}_state.json`;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
      const state = this.loadState();
      
      if (state.isBlocked && state.lastRun) {
          const hoursSinceBlock = (new Date().getTime() - new Date(state.lastRun).getTime()) / (1000 * 60 * 60);
          if (hoursSinceBlock < 1) {
              console.log(`[${this.name}] Region blocked. Skipping.`);
              return [];
          }
          state.isBlocked = false;
      }

      const listings = await this.searchViaAPI(criteria, state);
      this.saveState(state);
      return listings;
    } catch (error) {
      console.error(`[${this.name}] Search failed:`, error);
      return [];
    }
  }

  protected async searchViaAPI(criteria: SearchParams, state: VaultState): Promise<IndustrialListing[]> {
    const url = `${this.apiBaseUrl}/api/proxy/v1/listings`;
    const isGeneralSync = !criteria.location || criteria.location === 'Any';
    const pageToFetch = isGeneralSync ? (state.lastPage + 1) : 1;

    console.log(`[${this.name}] Fetching Page ${pageToFetch}...`);

    try {
      // Organic jittered backoff
      await this.waitOrganic();

      const params: any = { pageSize: 20, page: pageToFetch };
      if (!isGeneralSync) {
        params.q = criteria.location;
      }

      const axiosConfig: any = {
        params,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': this.apiBaseUrl
        }
      };

      const proxy = this.getProxyConfig();
      if (proxy) axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);

      const response = await axios.get(url, axiosConfig);
      state.isBlocked = false;

      if (!response.data || !response.data.data) {
        if (isGeneralSync && state.lastPage > 0) state.lastPage = 0;
        return [];
      }

      const listingsData = response.data.data;
      state.totalHits = response.data.hits || state.totalHits;
      
      if (isGeneralSync) {
          state.lastPage = pageToFetch;
          if (listingsData.length < 20) state.lastPage = 0;
      }

      this.logProgress(Math.min(isGeneralSync ? (state.lastPage * 20) : 20, state.totalHits), state.totalHits);
      return this.parseVaultREListings(listingsData, criteria);
    } catch (error: any) {
      if (error.response?.status === 403) state.isBlocked = true;
      console.error(`[${this.name}] API Error:`, error.message);
      return [];
    }
  }

  protected parseVaultREListings(listings: any[], criteria: SearchParams): IndustrialListing[] {
    return listings.map(item => {
      const prop = item.value;
      const text = `${prop.title || ''} ${prop.description || ''}`.toLowerCase();

      let propertyType: PropertyType | undefined;
      if (text.includes('industrial') || text.includes('warehouse')) propertyType = 'industrial';
      else if (prop.typeCode === 'COM' || text.includes('commercial')) propertyType = 'commercial';
      else propertyType = 'residential';

      let listingType: ListingType | undefined;
      if (prop.typeCode === 'SAL' || text.includes('for sale')) listingType = 'sale';
      else listingType = 'rental';

      const address = [prop.address?.street, prop.address?.suburb, prop.address?.state].filter(Boolean).join(', ') || prop.title || 'Unknown';

      return {
        address,
        zoning: propertyType || '',
        description: prop.description?.replace(/<[^>]*>/g, '') || 'No description',
        sourceUrl: prop.webUrl || `${this.apiBaseUrl}/property/${prop.slug || prop.id}`,
        price: prop.price ? parseFloat(prop.price) : undefined,
        priceDisplay: prop.displayPrice || '',
        source: this.name,
        propertyType,
        listingType,
        metadata: { id: prop.id, suburb: prop.suburb, state: prop.state, country: prop.address?.country }
      };
    }).filter(listing => {
      if (criteria.minPrice && listing.price && listing.price < criteria.minPrice) return false;
      if (criteria.maxPrice && listing.price && listing.price > criteria.maxPrice) return false;
      return true;
    });
  }

  private loadState(): VaultState {
    if (fs.existsSync(this.stateFile)) {
      try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')); } catch (e) {}
    }
    return { lastPage: 0, totalHits: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: VaultState): void {
    state.lastRun = new Date().toISOString();
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2)); } catch (e) {}
  }
}