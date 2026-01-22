import { BaseScout, SearchParams, IndustrialListing } from '../types.js';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { GnafService } from '../services/GnafService.js';

// @ts-ignore
chromium.use(StealthPlugin());

/**
 * Homely Scout - Aggregator
 * 
 * Strategy: Playwright-based extraction with Cloudflare bypass attempts.
 * Uses suburb slugs: melbourne-vic-3000
 */
export class HomelyScout extends BaseScout {
  readonly name = 'Homely';
  private readonly siteUrl = 'https://www.homely.com.au';
  private browser: any = null;
  private isSharedBrowser: boolean = false;

  setBrowser(browser: any): void {
      this.browser = browser;
      this.isSharedBrowser = true;
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.error(`[${this.name}] Performing search for: ${criteria.location}`);
    
    let slug = '';
    const gnaf = new GnafService();
    const metadata = await gnaf.getSuburbMetadata(criteria.location);
    
    if (metadata) {
        slug = `${metadata.suburb.toLowerCase().replace(/\s+/g, '-')}-${metadata.state.toLowerCase()}-${metadata.postcode}`;
    } else {
        // Fallback: simple slugify
        slug = criteria.location.toLowerCase().replace(/\s+/g, '-');
    }

    const typePath = criteria.listingType === 'rental' ? 'rent' : 'for-sale';
    const searchUrl = `${this.siteUrl}/${typePath}/${slug}/real-estate`;
    
    console.error(`[${this.name}] Navigating to: ${searchUrl}`);

    try {
      const proxy = this.getProxyConfig();
      
      if (!this.browser) {
          this.browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
            proxy: proxy ? { server: proxy.server } : undefined
          });
          this.isSharedBrowser = false;
      }

      const context = await this.createStealthContext(this.browser);
      const page = await context.newPage();

      // Set a realistic viewport
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for potential Cloudflare challenge to settle
      await page.waitForTimeout(10000);

      // Attempt to solve/wait for listings
      const hasListings = await page.evaluate(() => {
          return !!document.querySelector('article, .listing-card, [data-testid*="listing"]');
      });

      if (!hasListings) {
          console.error(`[${this.name}] No listings found. Might be blocked by Cloudflare.`);
          if (!this.isSharedBrowser) await this.browser.close(); else await page.close();
          return [];
      }

      const listingsData = await page.evaluate(() => {
          const items: any[] = [];
          // Target common listing card structures
          const containers = document.querySelectorAll('article, .listing-card, [data-testid*="listing"]');
          
          containers.forEach(container => {
              // Try to find address, price, and link using data-testids or common classes
              const addressEl = container.querySelector('[data-testid*="address"], .address, h3');
              const priceEl = container.querySelector('[data-testid*="price"], .price, .price-display');
              const linkEl = container.querySelector('a[href*="/homes/"]') as HTMLAnchorElement;
              
              if (addressEl && linkEl) {
                  items.push({
                      address: addressEl.textContent?.trim() || '',
                      priceDisplay: priceEl?.textContent?.trim() || '',
                      url: linkEl.href,
                      fullText: container.textContent?.replace(/\s+/g, ' ').trim() || ''
                  });
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

      const results: IndustrialListing[] = [];
      for (const item of listingsData) {
          results.push({
              address: item.address,
              source: this.name,
              sourceUrl: item.url,
              description: item.fullText,
              priceDisplay: item.priceDisplay,
              propertyType: criteria.propertyType || 'residential',
              listingType: criteria.listingType || 'sale',
              metadata: {
                  agencyName: 'Homely'
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
}
