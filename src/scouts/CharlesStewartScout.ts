import { BaseScout, IndustrialListing, SearchParams, PropertyType, ListingType } from '../types.js';
import { chromium } from 'playwright-extra';
import { GnafService } from '../services/GnafService.js';

/**
 * Charles Stewart Scout
 * 
 * Strategy: Playwright-based extraction from list pages.
 * Handles both Residential and Commercial properties.
 */
export class CharlesStewartScout extends BaseScout {
  readonly name = 'Charles Stewart';
  private readonly siteUrl = 'https://charlesstewart.com.au';
  readonly relevanceArea = { lat: -38.3400, lon: 143.5847, radiusKm: 100 };
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[${this.name}] Performing search for: ${criteria.location || 'All'}`);
    
    const results: IndustrialListing[] = [];
    const propertyType = criteria.propertyType || 'residential';
    
    // Determine the URL based on property type
    const baseUrl = propertyType === 'industrial' || propertyType === 'commercial'
        ? `${this.siteUrl}/commercial/commercial-properties`
        : `${this.siteUrl}/residential/residential-properties`;

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

      console.error(`[${this.name}] Navigating to: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.waitOrganic();

      const listingsData = await page.evaluate(() => {
          const items: any[] = [];
          const containers = document.querySelectorAll('.propertyListItemWrapper');
          
          containers.forEach(container => {
              const detailsEl = container.querySelector('.propertyDetails');
              if (!detailsEl) return;

              const text = detailsEl.textContent || '';
              // Address is typically before the first $
              const rawAddress = text.split('$')[0].trim();
              const address = rawAddress.replace(/\n+/g, ', ').replace(/\s+/g, ' ').trim();
              const priceDisplay = text.includes('$') ? '$' + text.split('$')[1].trim().replace(/\n+/g, ' ') : '';
              
              const linkEl = container.querySelector('a[href*="/21"]') as HTMLAnchorElement;
              const url = linkEl ? linkEl.href : '';
              
              const fullText = container.textContent?.replace(/\s+/g, ' ').trim() || '';
              
              if (address && url) {
                  items.push({ address, priceDisplay, url, fullText });
              }
          });
          return items;
      });

      if (!this.isSharedBrowser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await page.close();
          await context.close();
      }

      console.error(`[${this.name}] Extracted ${listingsData.length} listings.`);

      const gnaf = new GnafService();
      const loc = criteria.location?.toLowerCase();

      for (const item of listingsData) {
          // Filter by location in memory
          if (loc && !item.fullText.toLowerCase().includes(loc) && !item.address.toLowerCase().includes(loc)) {
              continue;
          }

          const res = await gnaf.resolveAddress(item.address);
          
          results.push({
              address: item.address,
              source: this.name,
              sourceUrl: item.url,
              description: item.fullText,
              priceDisplay: item.priceDisplay,
              propertyType: this.inferPropertyType(item.fullText, propertyType),
              listingType: this.inferListingType(item.fullText, criteria.listingType),
              metadata: {
                  gnafPid: res?.id || undefined,
                  lat: res?.lat || undefined,
                  lon: res?.lon || undefined,
                  agencyName: 'Charles Stewart'
              },
              sources: [{ name: this.name, url: item.url }]
          });
      }

      return results;

    } catch (error: any) {
      console.error(`[${this.name}] Search failed:`, error.message);
      return [];
    }
  }

  private inferPropertyType(text: string, requestedType: PropertyType): PropertyType {
      const t = text.toLowerCase();
      if (t.includes('industrial') || t.includes('warehouse') || t.includes('factory')) return 'industrial';
      if (t.includes('commercial') || t.includes('office') || t.includes('retail') || t.includes('shop')) return 'commercial';
      if (t.includes('farm') || t.includes('acreage') || t.includes('rural')) return 'rural';
      if (t.includes('land') || t.includes('development site')) return 'land';
      return requestedType;
  }

  private inferListingType(text: string, requestedType?: ListingType): ListingType {
      const t = text.toLowerCase();
      if (t.includes('rent') || t.includes('lease') || t.includes('pw') || t.includes('pcm')) return 'rental';
      if (t.includes('sale') || t.includes('auction') || t.includes('sold')) return 'sale';
      return requestedType || 'sale';
  }
}
