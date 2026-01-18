#!/usr/bin/env node

// Use the globally installed playwright  
const playwright = require('/home/runner/.cache/ms-playwright-nodejs/playwright/lib/index');

async function discoverPRD() {
  console.log('🔍 Discovering PRD Ballarat ListOnce API...\n');
  
  const browser = await playwright.chromium.launch({
    headless: true
  });
  
  try {
    const page = await browser.newPage();
    
    const apiCalls = [];
    
    // Intercept API requests
    page.on('request', req => {
      const url = req.url();
      if (url.includes('listonce') || url.includes('api')) {
        console.log(`📡 Request: ${req.method()} ${url.substring(0, 100)}...`);
      }
    });
    
    page.on('response', async resp => {
      const url = resp.url();
      if (url.includes('listonce.com.au') && url.includes('/api/')) {
        console.log(`✅ API Response: ${resp.status()} ${url}`);
        try {
          const data = await resp.json();
          apiCalls.push({ url, status: resp.status(), data });
          console.log(`   Keys: ${Object.keys(data).slice(0, 5).join(', ')}`);
        } catch (e) {
          console.log(`   (Not JSON)`);
        }
      }
    });
    
    console.log('🌐 Loading PRD Ballarat...');
    await page.goto('https://www.prd.com.au/ballarat/property-search/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    
    console.log('✅ Page loaded\n');
    await page.waitForTimeout(3000);
    
    console.log('\n📊 RESULTS:');
    console.log(`Found ${apiCalls.length} API calls`);
    
    if (apiCalls.length > 0) {
      apiCalls.forEach(call => {
        console.log(`\n${call.url}`);
        if (call.data.client_id) console.log(`  client_id: ${call.data.client_id}`);
      });
    }
    
  } finally {
    await browser.close();
  }
}

discoverPRD().catch(console.error);
