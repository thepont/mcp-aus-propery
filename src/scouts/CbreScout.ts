import { BaseScout, SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// @ts-ignore
chromium.use(StealthPlugin());

/**
 * CBRE Australia Industrial Property Scout
 * Attempts API fetch first, falls back to Playwright + JSON-LD extraction
 */
export class CbreScout extends BaseScout {
  readonly name = 'CBRE Australia';
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  /**
   * Search CBRE for industrial properties
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      // Try API fetch first
      const apiResults = await this.searchViaApi(criteria);
      if (apiResults.length > 0) {
        console.error(`[CBRE] Found ${apiResults.length} listings via API`);
        return apiResults;
      }
    } catch (error) {
      console.error('[CBRE] API fetch failed, falling back to Playwright:', error);
    }

    // Fallback to Playwright with JSON-LD extraction
    return await this.searchViaPlaywright(criteria);
  }

  /**
   * Attempt to fetch properties via CBRE's internal API
   */
  private async searchViaApi(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    try {
      const searchUrl = 'https://www.cbre.com.au/property-api/propertylistings/query';
      const params = new URLSearchParams({
        'Site': 'au-comm',
        'Common.Aspects': 'isLetting,isSale',
        'Common.PropertyTypes': 'Industrial',
        'Common.IsParent': 'true',
        'PageSize': '50',
        'Page': '1'
      });
      if (criteria.location) params.append('Common.Locallity', criteria.location);
      
      const response = await axios.get(`${searchUrl}?${params.toString()}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      if (response.data && response.data.DocumentCount > 0 && Array.isArray(response.data.Documents)) {
        for (const docArray of response.data.Documents) {
          if (!Array.isArray(docArray)) continue;
          for (const doc of docArray) {
            try {
              const addr = doc['Common.ActualAddress'];
              const address = addr ? `${addr['Common.Line1'] || ''}, ${addr['Common.Locallity'] || ''} ${addr['Common.Region'] || ''} ${addr['Common.PostCode'] || ''}`.trim().replace(/\s+/g, ' ') : 'Address not available';
              const highlights = doc['Common.Highlights'] || [];
              const description = highlights.map((h: any) => h['Common.Highlight']?.[0]?.['Common.Text']).filter(Boolean).join('. ');
              const key = doc['Common.PrimaryKey'];
              const sourceUrl = key ? `https://www.cbre.com.au/properties/${key}` : '';
              listings.push({
                address, zoning: doc['Common.Zoning'] || undefined,
                description: description || 'No description available',
                sourceUrl, price: doc['Common.Charges']?.[0]?.['Common.Value'],
                priceDisplay: doc['Common.Charges']?.[0]?.['Common.FormattedValue'],
                area: doc['Common.TotalSize']?.['Common.Value'],
                source: this.name,
                sources: [{ name: this.name, url: sourceUrl }], // Added sources array
                metadata: doc
              });
            } catch (err) { continue; }
          }
        }
      }
    } catch (error) {}
    return listings;
  }

  /**
   * Search using Playwright browser automation with JSON-LD extraction
   */
  private async searchViaPlaywright(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    try {
      const proxy = this.getProxyConfig();
      if (!this.browser) {
        this.browser = await chromium.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          proxy: proxy ? { server: proxy.server } : undefined
        });
                  this.isSharedBrowser = false;
              }
        
              const context = await this.createStealthContext(this.browser);
              const page = await context.newPage();
              const searchUrl = this.buildSearchUrl(criteria);      
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.waitOrganic();

      const jsonLdData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        return scripts.map((script: Element) => {
          try { return JSON.parse(script.textContent || ''); } catch { return null; }
        }).filter(data => data !== null);
      });

      for (const data of jsonLdData) {
        if (data['@type'] === 'RealEstateListing' || data['@type'] === 'Product') {
          const listing = this.parseJsonLd(data);
          if (listing) listings.push(listing);
        } else if (Array.isArray(data['@graph'])) {
          for (const item of data['@graph']) {
            if (item['@type'] === 'RealEstateListing' || item['@type'] === 'Product') {
              const listing = this.parseJsonLd(item);
              if (listing) listings.push(listing);
            }
          }
        }
      }

      if (listings.length === 0) {
        const htmlListings = await this.extractHtmlListings(page);
        listings.push(...htmlListings);
      }

      if (!this.isSharedBrowser && this.browser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await context.close();
      }
    } catch (error) {
      console.error('[CBRE] Playwright search failed:', error);
    }
    return listings;
  }

  private buildSearchUrl(criteria: SearchParams): string {
    const baseUrl = 'https://www.cbre.com.au/properties/industrial-warehouse';
    const params = new URLSearchParams();
    params.append('aspects', 'isSale,isLease');
    if (criteria.location) params.append('q', criteria.location);
    if (criteria.minPrice) params.append('priceMin', criteria.minPrice.toString());
    if (criteria.maxPrice) params.append('priceMax', criteria.maxPrice.toString());
    return `${baseUrl}${params.toString() ? '?' + params.toString() : ''}`;
  }

  private parseJsonLd(data: any): IndustrialListing | null {
    try {
      const address = data.address?.streetAddress || data.name || data.headline || 'Address not available';
      const description = data.description || data.about || data.text || '';
      const url = data.url || data['@id'] || '';
      return {
        address, zoning: data.zoning || undefined, description,
        sourceUrl: url.startsWith('http') ? url : `https://www.cbre.com.au${url}`,
        price: data.offers?.price,
        priceDisplay: data.offers?.priceCurrency ? `${data.offers.priceCurrency} ${data.offers.price}` : data.offers?.priceSpecification?.price,
        area: data.floorSize?.value, source: this.name, metadata: data,
        sources: [{ name: this.name, url: url.startsWith('http') ? url : `https://www.cbre.com.au${url}` }] // Added sources array
      };
    } catch (error) { return null; }
  }

  private async extractHtmlListings(page: any): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    try {
      const propertyCards = await page.$$('[data-testid="property-card"], .property-card, .listing-card');
      for (const card of propertyCards) {
        try {
          const address = await card.$eval('[data-testid="property-address"], .address, h3, h2', (el: any) => el.textContent?.trim() || '').catch(() => '');
          const description = await card.$eval('.description, [data-testid="property-description"], p', (el: any) => el.textContent?.trim() || '').catch(() => '');
          const linkElement = await card.$('a[href]');
          const href = linkElement ? await linkElement.getAttribute('href') : '';
          const url = href?.startsWith('http') ? href : `https://www.cbre.com.au${href}`;
          if (address) {
            listings.push({ address, description, sourceUrl: url, source: this.name, zoning: undefined,
                sources: [{ name: this.name, url: url }] // Added sources array
            });
          }
        } catch (error) { continue; }
      }
    } catch (error) {}
    return listings;
  }

  async cleanup(): Promise<void> {
    if (this.browser && !this.isSharedBrowser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}