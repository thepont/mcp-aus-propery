import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * Base scout for Agentpoint PropertyHub powered websites
 * 
 * Uses Playwright to extract API tokens from the website, then uses those tokens
 * to make authenticated API calls to the PropertyHub API.
 * 
 * Sites using Agentpoint:
 * - LJ Hooker (www.ljhooker.com.au)
 * - Various other Australian real estate agencies
 */
export abstract class AgentpointScout extends BaseScout {
  abstract readonly name: string;
  protected abstract readonly siteUrl: string;
  protected abstract readonly apiBaseUrl: string;
  
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private browser: Browser | null = null;

  /**
   * Extract API token and configuration from the website using Playwright
   */
  private async extractToken(): Promise<{ token: string | null; apiUrl: string; config: any }> {
    console.log(`[${this.name}] Extracting API token via Playwright...`);
    
    try {
      // Launch browser if not already running
      if (!this.browser) {
        this.browser = await chromium.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      const page = await context.newPage();
      
      let extractedToken: string | null = null;
      let extractedApiUrl = this.apiBaseUrl;
      let capturedConfig: any = null;

      // Intercept API requests to extract tokens
      page.on('request', request => {
        const url = request.url();
        const headers = request.headers();
        
        // Look for API requests to PropertyHub/Agentpoint
        if (url.includes('api') && (url.includes('ljx.com.au') || url.includes('propertyhub') || url.includes('agentpoint'))) {
          console.log(`[${this.name}] 📡 API Request: ${url}`);
          
          // Extract authentication from headers
          if (headers['authorization']) {
            extractedToken = headers['authorization'];
            console.log(`[${this.name}] 🔑 Found Authorization header`);
          }
          if (headers['x-api-key']) {
            extractedToken = headers['x-api-key'];
            console.log(`[${this.name}] 🔑 Found X-Api-Key header`);
          }
          if (headers['api-key']) {
            extractedToken = headers['api-key'];
            console.log(`[${this.name}] 🔑 Found Api-Key header`);
          }
          
          // Extract base URL
          try {
            const urlObj = new URL(url);
            extractedApiUrl = `${urlObj.protocol}//${urlObj.host}`;
          } catch (e) {
            // Invalid URL
          }
        }
      });

      // Navigate to the site
      console.log(`[${this.name}] Loading ${this.siteUrl}...`);
      await page.goto(this.siteUrl, { 
        waitUntil: 'networkidle', 
        timeout: 30000 
      });
      
      // Wait for JavaScript to load
      await page.waitForTimeout(2000);

      // Try to extract configuration from window objects
      console.log(`[${this.name}] Extracting configuration objects...`);
      capturedConfig = await page.evaluate(() => {
        const config: any = {};
        
        // Common configuration object names for Agentpoint
        const configNames = [
          'AgentpointSettings',
          'PropertyHubConfig',
          'LJH_CONFIG',
          'LJHA',
          'api_key',
          'apiKey',
          'apiConfig',
          'siteConfig'
        ];
        
        for (const name of configNames) {
          if ((window as any)[name]) {
            try {
              config[name] = JSON.parse(JSON.stringify((window as any)[name]));
            } catch (e) {
              config[name] = String((window as any)[name]);
            }
          }
        }
        
        return config;
      });

      // Extract token from config if found
      if (capturedConfig) {
        console.log(`[${this.name}] Found config objects:`, Object.keys(capturedConfig));
        
        // Look for API keys in the config
        for (const [key, value] of Object.entries(capturedConfig)) {
          if (typeof value === 'object' && value !== null) {
            const obj = value as any;
            if (obj.apiKey) extractedToken = obj.apiKey;
            if (obj.api_key) extractedToken = obj.api_key;
            if (obj.token) extractedToken = obj.token;
            if (obj.apiUrl) extractedApiUrl = obj.apiUrl;
            if (obj.api_url) extractedApiUrl = obj.api_url;
          }
        }
      }

      // Try to trigger a search to capture API calls
      console.log(`[${this.name}] Attempting to trigger search...`);
      try {
        // Navigate to search results page
        const searchUrl = `${this.siteUrl}/search-results?searchProfile=sale&searchOrigin=commercialSale`;
        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log(`[${this.name}] Could not trigger search:`, e);
      }

      await context.close();

      return {
        token: extractedToken,
        apiUrl: extractedApiUrl,
        config: capturedConfig
      };

    } catch (error) {
      console.error(`[${this.name}] Error extracting token:`, error);
      return { token: null, apiUrl: this.apiBaseUrl, config: null };
    }
  }

  /**
   * Get a valid token, extracting a new one if necessary
   */
  private async getToken(): Promise<string | null> {
    const now = Date.now();
    
    // Return cached token if still valid (30 minutes)
    if (this.cachedToken && now < this.tokenExpiry) {
      return this.cachedToken;
    }

    // Extract new token
    const { token, apiUrl, config } = await this.extractToken();
    
    if (token) {
      this.cachedToken = token;
      this.tokenExpiry = now + (30 * 60 * 1000); // 30 minutes
      console.log(`[${this.name}] ✅ Token extracted and cached`);
    } else {
      console.log(`[${this.name}] ⚠️ No token found - API may be public or require different auth`);
    }

    return token;
  }

  /**
   * Make an authenticated API request
   */
  protected async makeApiRequest(endpoint: string, params: any = {}): Promise<any> {
    const token = await this.getToken();
    
    const headers: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    };

    // Add token if available
    if (token) {
      // Determine header type based on token format
      if (token.startsWith('Bearer ')) {
        headers['Authorization'] = token;
      } else if (token.length > 20) {
        // Looks like an API key
        headers['X-Api-Key'] = token;
        headers['api-key'] = token;
      }
    }

    try {
      const response = await axios.get(endpoint, {
        params,
        headers,
        timeout: 15000
      });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        // Token might be expired, clear cache
        this.cachedToken = null;
        this.tokenExpiry = 0;
        console.log(`[${this.name}] Token expired or invalid, will re-extract on next request`);
      }
      throw error;
    }
  }

  /**
   * Clean up browser instance
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Search for properties using the Agentpoint API
   */
  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    console.log(`[${this.name}] Searching with Playwright token extraction...`);
    
    try {
      // Build API endpoint
      const endpoint = await this.buildApiEndpoint(criteria);
      
      // Make authenticated request
      const data = await this.makeApiRequest(endpoint, this.buildApiParams(criteria));
      
      // Parse response
      return this.parseApiResponse(data);
      
    } catch (error: any) {
      console.error(`[${this.name}] Search error:`, error.message);
      return [];
    } finally {
      // Optionally cleanup browser (or keep it for reuse)
      // await this.cleanup();
    }
  }

  /**
   * Build the API endpoint URL (to be implemented by subclasses)
   */
  protected abstract buildApiEndpoint(criteria: SearchParams): Promise<string>;

  /**
   * Build API query parameters (to be implemented by subclasses)
   */
  protected abstract buildApiParams(criteria: SearchParams): any;

  /**
   * Parse API response into IndustrialListing array (to be implemented by subclasses)
   */
  protected abstract parseApiResponse(data: any): IndustrialListing[];
}
