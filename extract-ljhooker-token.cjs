#!/usr/bin/env node

const { chromium } = require('playwright');

async function extractLJHookerToken() {
  console.log('🔍 Extracting LJ Hooker API Token via Playwright\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  const apiRequests = [];
  const tokens = new Set();
  
  // Intercept all requests
  page.on('request', request => {
    const url = request.url();
    const headers = request.headers();
    
    // Look for API requests
    if (url.includes('api') || url.includes('ljx.com.au') || url.includes('propertyhub') || url.includes('agentpoint')) {
      console.log(`📡 API Request: ${url}`);
      
      // Extract authentication headers
      if (headers['authorization']) {
        console.log(`   🔑 Authorization: ${headers['authorization']}`);
        tokens.add(headers['authorization']);
      }
      if (headers['x-api-key']) {
        console.log(`   🔑 X-Api-Key: ${headers['x-api-key']}`);
        tokens.add(headers['x-api-key']);
      }
      if (headers['api-key']) {
        console.log(`   🔑 Api-Key: ${headers['api-key']}`);
        tokens.add(headers['api-key']);
      }
      
      apiRequests.push({
        url,
        method: request.method(),
        headers: {
          authorization: headers['authorization'],
          'x-api-key': headers['x-api-key'],
          'api-key': headers['api-key']
        }
      });
    }
  });
  
  // Capture responses
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('api') || url.includes('ljx.com.au')) {
      console.log(`   📥 Response: ${response.status()}`);
      if (response.status() === 200) {
        try {
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('json')) {
            const json = await response.json();
            console.log(`   ✅ JSON Response with ${JSON.stringify(json).length} chars`);
          }
        } catch (e) {
          // Not JSON
        }
      }
    }
  });
  
  try {
    console.log('\n1️⃣ Loading LJ Hooker homepage...');
    await page.goto('https://www.ljhooker.com.au/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    console.log('\n2️⃣ Checking for configuration objects in window...');
    const configObjects = await page.evaluate(() => {
      const configs = {};
      
      // Common config object names
      const names = [
        'AgentpointSettings',
        'PropertyHubConfig', 
        'LJH_CONFIG',
        'LJHA',
        'api_key',
        'apiKey',
        'config'
      ];
      
      for (const name of names) {
        if (window[name]) {
          configs[name] = JSON.stringify(window[name], null, 2);
        }
      }
      
      return configs;
    });
    
    if (Object.keys(configObjects).length > 0) {
      console.log('\n📦 Found configuration objects:');
      for (const [name, value] of Object.entries(configObjects)) {
        console.log(`\n${name}:`);
        console.log(value.substring(0, 500));
      }
    }
    
    console.log('\n3️⃣ Navigating to search page...');
    await page.goto('https://www.ljhooker.com.au/search-results?searchProfile=sale&searchOrigin=residentialSale', { 
      waitUntil: 'networkidle', 
      timeout: 30000 
    });
    await page.waitForTimeout(3000);
    
    console.log('\n4️⃣ Trying to trigger a search...');
    
    // Try to find and interact with search box
    const searchBox = await page.$('input[type="text"]').catch(() => null);
    if (searchBox) {
      console.log('   Found search input, typing...');
      await searchBox.fill('Sydney');
      await page.waitForTimeout(2000);
      
      // Try to submit
      const searchButton = await page.$('button[type="submit"]').catch(() => null);
      if (searchButton) {
        console.log('   Clicking search button...');
        await searchButton.click();
        await page.waitForTimeout(5000);
      }
    }
    
    console.log('\n5️⃣ Checking commercial properties page...');
    await page.goto('https://www.ljhooker.com.au/search-results?searchProfile=sale&searchOrigin=commercialSale', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(3000);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  await browser.close();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`\n🔗 Total API requests captured: ${apiRequests.length}`);
  console.log(`🔑 Unique tokens found: ${tokens.size}`);
  
  if (tokens.size > 0) {
    console.log('\n✅ TOKENS EXTRACTED:');
    for (const token of tokens) {
      console.log(`   ${token}`);
    }
  } else {
    console.log('\n⚠️  No authentication tokens found in headers.');
    console.log('   This means either:');
    console.log('   - The API is public (no auth required)');
    console.log('   - Auth is handled via cookies/sessions');
    console.log('   - API calls are made server-side');
  }
  
  if (apiRequests.length > 0) {
    console.log('\n📋 API ENDPOINTS FOUND:');
    const uniqueUrls = [...new Set(apiRequests.map(r => r.url))];
    uniqueUrls.forEach(url => {
      console.log(`   ${url}`);
    });
    
    // Save to file
    require('fs').writeFileSync(
      '/home/runner/work/mcp-aus-propery/mcp-aus-propery/ljhooker-api-analysis.json',
      JSON.stringify({ tokens: Array.from(tokens), requests: apiRequests, endpoints: uniqueUrls }, null, 2)
    );
    console.log('\n💾 Saved detailed analysis to ljhooker-api-analysis.json');
  }
}

extractLJHookerToken().catch(console.error);
