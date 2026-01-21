import { BaseScout } from '../types.js';
import type { SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';

// @ts-ignore
chromium.use(StealthPlugin());

interface AgentpointState {
  lastPage: number;
  totalProperties: number;
  lastRun: string;
  isBlocked?: boolean;
}

/**
 * Base scout for Agentpoint PropertyHub powered websites
 */
export abstract class AgentpointScout extends BaseScout {
  abstract readonly name: string;
  protected abstract readonly siteUrl: string;
  protected abstract readonly apiBaseUrl: string;
  
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private browser: any = null;

  protected get stateFile(): string {
    const safeName = this.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `data/ap_${safeName}_state.json`;
  }

  private async extractToken(): Promise<{ token: string | null; apiUrl: string; config: any }> {
    console.log(`[${this.name}] Extracting API token with stealth...`);
    
    try {
      const proxy = this.getProxyConfig();
      if (proxy) console.log(`[${this.name}] Using Playwright proxy: ${proxy.server}`);
      
      if (!this.browser) {
        const launchArgs = [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ];

        this.browser = await chromium.launch({ 
          headless: true,
          args: launchArgs,
          proxy: proxy ? { server: proxy.server } : undefined
        });
      }

      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        locale: 'en-AU',
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();
      let extractedToken: string | null = null;
      let extractedApiUrl = this.apiBaseUrl;

      page.on('request', request => {
        const url = request.url();
        const headers = request.headers();
        if (url.includes('api') && (url.includes('ljx.com.au') || url.includes('propertyhub') || url.includes('agentpoint'))) {
          if (headers['authorization']) extractedToken = headers['authorization'];
          else if (headers['x-api-key']) extractedToken = headers['x-api-key'];
          try {
            const urlObj = new URL(url);
            extractedApiUrl = `${urlObj.protocol}//${urlObj.host}`;
          } catch (e) {}
        }
      });

      console.log(`[${this.name}] Loading ${this.siteUrl}...`);
      await page.goto(this.siteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      await this.waitOrganic();

      const capturedConfig = await page.evaluate(() => {
        const config: any = {};
        const names = ['AgentpointSettings', 'PropertyHubConfig', 'LJH_CONFIG', 'api_key', 'apiKey'];
        for (const name of names) {
          if ((window as any)[name]) config[name] = (window as any)[name];
        }
        return config;
      });

      if (capturedConfig) {
        for (const value of Object.values(capturedConfig)) {
          if (typeof value === 'object' && value !== null) {
            const obj = value as any;
            extractedToken = obj.apiKey || obj.api_key || obj.token || extractedToken;
            extractedApiUrl = obj.apiUrl || obj.api_url || extractedApiUrl;
          }
        }
      }

      await context.close();
      return { token: extractedToken, apiUrl: extractedApiUrl, config: capturedConfig };
    } catch (error) {
      console.error(`[${this.name}] Token error:`, error);
      return { token: null, apiUrl: this.apiBaseUrl, config: null };
    }
  }

  private async getToken(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiry) return this.cachedToken;
    const { token } = await this.extractToken();
    if (token) {
      this.cachedToken = token;
      this.tokenExpiry = now + (30 * 60 * 1000);
    }
    return token;
  }

  protected async makeApiRequest(endpoint: string, params: any = {}): Promise<any> {
    const token = await this.getToken();
    const axiosConfig: any = {
      params,
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    };
    if (token) {
      if (token.startsWith('Bearer ')) axiosConfig.headers['Authorization'] = token;
      else axiosConfig.headers['X-Api-Key'] = token;
    }
    const proxy = this.getProxyConfig();
    if (proxy) axiosConfig.httpsAgent = new HttpsProxyAgent(proxy.server);

    await this.waitOrganic();
    const response = await axios.get(endpoint, axiosConfig);
    return response.data;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    try {
      if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
      const state = this.loadState();
      
      if (state.isBlocked && state.lastRun) {
          const hoursSinceBlock = (new Date().getTime() - new Date(state.lastRun).getTime()) / (1000 * 60 * 60);
          if (hoursSinceBlock < 1) return [];
          state.isBlocked = false;
      }

      const isGeneralSync = !criteria.location || criteria.location === 'Any';
      const pageToFetch = isGeneralSync ? (state.lastPage + 1) : 1;

      console.log(`[${this.name}] Fetching API Page ${pageToFetch}...`);
      
      const endpoint = await this.buildApiEndpoint(criteria);
      const params = this.buildApiParams(criteria);
      params.page = pageToFetch;
      
      const data = await this.makeApiRequest(endpoint, params);
      const listings = this.parseApiResponse(data);
      
      state.isBlocked = false;
      if (isGeneralSync) {
        state.lastPage = pageToFetch;
        if (listings.length === 0 || (data.total && state.lastPage * (params.limit || 50) >= data.total)) {
          state.lastPage = 0;
        }
        state.totalProperties = data.total || state.totalProperties;
        this.saveState(state);
        this.logProgress(state.lastPage * (params.limit || 50), state.totalProperties || 0);
      }
      return listings;
    } catch (error: any) {
      if (error.response?.status === 403) {
        const state = this.loadState();
        state.isBlocked = true;
        this.saveState(state);
      }
      console.error(`[${this.name}] Search Error:`, error.message);
      return [];
    }
  }

  protected abstract buildApiEndpoint(criteria: SearchParams): Promise<string>;
  protected abstract buildApiParams(criteria: SearchParams): any;
  protected abstract parseApiResponse(data: any): IndustrialListing[];

  private loadState(): AgentpointState {
    if (fs.existsSync(this.stateFile)) {
      try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')); } catch (e) {}
    }
    return { lastPage: 0, totalProperties: 0, lastRun: new Date().toISOString() };
  }

  private saveState(state: AgentpointState): void {
    state.lastRun = new Date().toISOString();
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2)); } catch (e) {}
  }
}