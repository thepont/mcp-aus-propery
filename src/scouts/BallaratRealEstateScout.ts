import { BaseScout, SearchParams, IndustrialListing } from '../types.js';
import { chromium } from 'playwright-extra';
import { GnafService } from '../services/GnafService.js';

/**
 * Ballarat Real Estate Scout
 * 
 * Uses Playwright to extract property listings directly from the website.
 */
export class BallaratRealEstateScout extends BaseScout {
  readonly name = 'Ballarat Real Estate';
  private readonly siteUrl = 'https://www.ballaratrealestate.com.au';
  readonly relevanceArea = { lat: -37.5622, lon: 143.8503, radiusKm: 50 };
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  /**
   * Search for properties using Playwright extraction
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[${this.name}] Performing search for: ${criteria.location}`);
    
    // Construct search URL
    // https://www.ballaratrealestate.com.au/property-search/?search=Ballarat
    const searchUrl = `${this.siteUrl}/property-search/?search=${encodeURIComponent(criteria.location)}`;
    
    try {
      const proxy = this.getProxyConfig();
      
      // Initialize browser if not shared
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
      
      // Wait for listings
      try {
          await page.waitForSelector('.listing-item, .property-card, article', { timeout: 15000 });
      } catch (e) {
          console.error(`[${this.name}] Timeout waiting for listing elements.`);
      }

      const listings = await page.evaluate(() => {
          const results: any[] = [];
          const items = document.querySelectorAll('.listing-item, .property-card, article');
          
          items.forEach(item => {
              const address = item.querySelector('h2, h3, .address')?.textContent?.trim();
              const link = item.querySelector('a')?.getAttribute('href');
              const price = item.querySelector('.price')?.textContent?.trim();
              // Capture all text in the card for better inference
              const fullText = item.textContent?.trim() || '';
              
              if (address && link) {
                  results.push({
                      address,
                      url: link,
                      priceDisplay: price,
                      description: fullText // Use full card text as description for inference
                  });
              }
          });
          return results;
      });

      if (!this.isSharedBrowser) {
          await this.browser.close();
          this.browser = null;
      } else {
          await page.close();
          await context.close();
      }

      console.error(`[${this.name}] Extracted ${listings.length} listings.`);

      const gnaf = new GnafService();
      const results: IndustrialListing[] = [];

      for (const l of listings) {
          let address = l.address;
          if (!address.toLowerCase().includes('ballarat')) {
              address = `${address}, Ballarat`;
          }
          
          const res = await gnaf.resolveAddress(address);
          
          results.push({
              address: address,
              source: this.name,
              sourceUrl: l.url.startsWith('http') ? l.url : `${this.siteUrl}${l.url}`,
              description: l.description || 'Extracted listing',
              priceDisplay: l.priceDisplay,
              metadata: {
                  suburb: 'Ballarat',
                  gnafPid: res?.id || undefined,
                  lat: res?.lat || undefined,
                  lon: res?.lon || undefined,
                  agencyName: 'Ballarat Real Estate'
              },
              sources: [{ name: this.name, url: l.url.startsWith('http') ? l.url : `${this.siteUrl}${l.url}` }]
          });
      }

      return results;

    } catch (error: any) {
      console.error(`[${this.name}] Search failed:`, error.message);
      return [];
    }
  }

  // Override unused abstract methods
  protected async buildApiEndpoint(criteria: SearchParams): Promise<string> { return ''; }
  protected buildApiParams(criteria: SearchParams): any { return {}; }
  protected parseApiResponse(data: any): IndustrialListing[] { return []; }
}