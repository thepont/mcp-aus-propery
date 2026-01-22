import { BaseScout, IndustrialListing, SearchParams, PropertyType, ListingType } from '../types.js';
import { chromium } from 'playwright-extra';
import { GnafService } from '../services/GnafService.js';

/**
 * ASK Property Scout
 * 
 * Strategy: Playwright-based extraction from pre-loaded JSON and HTML cards.
 * Technology: WordPress with custom property management system.
 */
export class AskPropertyScout extends BaseScout {
  readonly name = 'ASK Property';
  private readonly siteUrl = 'https://www.askproperty.melbourne';
  readonly relevanceArea = { lat: -37.8136, lon: 144.9631, radiusKm: 30 };
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[${this.name}] Performing search for: ${criteria.location || 'All'}`);
    
    const results: IndustrialListing[] = [];
    const listingType = criteria.listingType || 'sale';
    const typePath = listingType === 'rental' ? 'rental' : 'sale';
    const searchUrl = `${this.siteUrl}/properties/${typePath}`;

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

      console.error(`[${this.name}] Navigating to: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Wait for content to render (custom engine)
      await page.waitForTimeout(5000);

      const extractedData = await page.evaluate(() => {
          // 1. Extract the pre-loaded JSON for links and IDs
          let jsonProperties: any = null;
          const scripts = Array.from(document.querySelectorAll('script'));
          const propScript = scripts.find(s => s.textContent?.includes('const properties ='));
          if (propScript) {
              const content = propScript.textContent || '';
              const start = content.indexOf('{');
              const end = content.lastIndexOf('}');
              if (start !== -1 && end !== -1) {
                  try {
                      jsonProperties = JSON.parse(content.substring(start, end + 1));
                  } catch (e) {}
              }
          }

          // 2. Extract HTML card details
          const htmlCards: any[] = [];
          const containers = document.querySelectorAll('.listing-wrapper');
          
          containers.forEach(container => {
              const priceEl = container.querySelector('.property-price');
              const addressEl = container.querySelector('.property-address, h3, a');
              // The ID is often in the gallery ID or a data attribute
              const gallery = container.querySelector('.property-image-gallery');
              const id = gallery ? gallery.id.replace('image-gallery-', '') : '';
              
              htmlCards.push({
                  id,
                  priceDisplay: priceEl?.textContent?.trim() || '',
                  address: addressEl?.textContent?.trim() || '',
                  fullText: container.textContent?.replace(/\s+/g, ' ').trim() || ''
              });
          });

          return { jsonProperties, htmlCards };
      });

      if (!this.isSharedBrowser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await page.close();
          await context.close();
      }

      const jsonList = (extractedData.jsonProperties?.residential?.[listingType === 'rental' ? 'rent' : 'buy']) || [];
      const htmlMap = new Map<string, any>(extractedData.htmlCards.map((c: any) => [c.id, c]));

      console.error(`[${this.name}] Found ${jsonList.length} listings in JSON, ${extractedData.htmlCards.length} in HTML.`);

      const gnaf = new GnafService();
      const loc = criteria.location?.toLowerCase();

      for (const jsonProp of jsonList as any[]) {
          const card = htmlMap.get(jsonProp.id);
          const address = jsonProp.value || card?.address || 'Address Unavailable';
          const description = card?.fullText || address;
          
          // Filter by location in memory
          if (loc && !description.toLowerCase().includes(loc) && !address.toLowerCase().includes(loc)) {
              continue;
          }

          const res = await gnaf.resolveAddress(address);
          
          results.push({
              address: address,
              source: this.name,
              sourceUrl: jsonProp.href || '',
              description: description,
              priceDisplay: card?.priceDisplay || '',
              propertyType: criteria.propertyType || 'residential',
              listingType: listingType,
              metadata: {
                  id: jsonProp.id,
                  gnafPid: res?.id || undefined,
                  lat: res?.lat || undefined,
                  lon: res?.lon || undefined,
                  agencyName: 'ASK Property'
              },
              sources: [{ name: this.name, url: jsonProp.href || searchUrl }]
          });
      }

      return results;

    } catch (error: any) {
      console.error(`[${this.name}] Search failed:`, error.message);
      return [];
    }
  }
}
