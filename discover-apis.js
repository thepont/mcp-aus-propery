#!/usr/bin/env node

/**
 * API Discovery Tool - Intercepts network requests to find real APIs
 * Uses Playwright to navigate pages and capture XHR/Fetch requests
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

async function discoverCBREApis() {
  console.log('\n🔍 Discovering CBRE APIs...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  const apiRequests = [];
  
  // Intercept all network requests
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();
    
    // Capture API-like requests
    if (resourceType === 'xhr' || resourceType === 'fetch' || 
        url.includes('/api/') || url.includes('/graphql') || 
        url.includes('.json') || url.includes('/search')) {
      apiRequests.push({
        url,
        method,
        resourceType,
        postData: request.postData(),
        headers: request.headers()
      });
    }
  });
  
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/') || url.includes('/graphql') || url.includes('.json')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          console.log(`📡 JSON Response from: ${url}`);
          console.log(`   Keys: ${Object.keys(data).join(', ')}`);
        }
      } catch (e) {
        // Not JSON or error reading
      }
    }
  });
  
  try {
    console.log('📄 Navigating to CBRE industrial properties...');
    await page.goto('https://www.cbre.com.au/properties/industrial-warehouse', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('✅ Page loaded');
    
    // Wait for dynamic content
    await page.waitForTimeout(5000);
    
    // Try interacting with search/filters
    try {
      const searchInput = page.locator('input[type="search"], input[placeholder*="search"]').first();
      if (await searchInput.count() > 0) {
        console.log('🔎 Found search input, trying to search...');
        await searchInput.fill('Sydney');
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('⚠️  No search input found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  await browser.close();
  
  console.log(`\n📊 Captured ${apiRequests.length} API requests:\n`);
  
  const uniqueUrls = [...new Set(apiRequests.map(r => r.url))];
  uniqueUrls.forEach(url => {
    const req = apiRequests.find(r => r.url === url);
    console.log(`   ${req.method} ${url}`);
    if (req.postData) {
      console.log(`      POST Data: ${req.postData.substring(0, 100)}...`);
    }
  });
  
  return apiRequests;
}

async function discoverCameronApis() {
  console.log('\n🔍 Discovering Cameron APIs...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  const apiRequests = [];
  
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();
    
    if (resourceType === 'xhr' || resourceType === 'fetch' || 
        url.includes('/api/') || url.includes('/graphql') || 
        url.includes('.json') || url.includes('/search')) {
      apiRequests.push({
        url,
        method,
        resourceType,
        postData: request.postData(),
        headers: request.headers()
      });
    }
  });
  
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/') || url.includes('/graphql') || url.includes('.json')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          console.log(`📡 JSON Response from: ${url}`);
          console.log(`   Keys: ${Object.keys(data).join(', ')}`);
        }
      } catch (e) {
        // Not JSON
      }
    }
  });
  
  try {
    console.log('📄 Navigating to Cameron commercial properties...');
    await page.goto('https://www.cameron.com.au/commercial/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('✅ Page loaded');
    await page.waitForTimeout(5000);
    
    // Try filtering for industrial
    try {
      const filters = page.locator('select, [role="combobox"], button').all();
      console.log(`🔎 Found ${(await filters).length} potential filter elements`);
    } catch (e) {
      console.log('⚠️  No filters found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  await browser.close();
  
  console.log(`\n📊 Captured ${apiRequests.length} API requests:\n`);
  
  const uniqueUrls = [...new Set(apiRequests.map(r => r.url))];
  uniqueUrls.forEach(url => {
    const req = apiRequests.find(r => r.url === url);
    console.log(`   ${req.method} ${url}`);
    if (req.postData) {
      console.log(`      POST Data: ${req.postData.substring(0, 100)}...`);
    }
  });
  
  return apiRequests;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   API Discovery Tool - Finding Real Estate APIs                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  
  const discoveries = {
    cbre: [],
    cameron: []
  };
  
  try {
    discoveries.cbre = await discoverCBREApis();
  } catch (error) {
    console.error('CBRE discovery failed:', error.message);
  }
  
  try {
    discoveries.cameron = await discoverCameronApis();
  } catch (error) {
    console.error('Cameron discovery failed:', error.message);
  }
  
  // Save discoveries
  writeFileSync(
    'api-discoveries.json',
    JSON.stringify(discoveries, null, 2)
  );
  
  console.log('\n✅ API discovery complete! Results saved to api-discoveries.json\n');
}

main().catch(console.error);
