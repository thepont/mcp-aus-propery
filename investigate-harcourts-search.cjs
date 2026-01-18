#!/usr/bin/env node

const { chromium } = require('playwright');

(async () => {
  console.log('🔍 Harcourts Property Search & API Investigation\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  const apiRequests = [];
  const propertyApiRequests = [];
  
  // Capture all network requests
  page.on('request', req => {
    const url = req.url();
    if (url.includes('api') || url.includes('property') || url.includes('listing') || url.includes('search')) {
      apiRequests.push({
        url: url,
        method: req.method(),
        headers: req.headers()
      });
    }
  });
  
  page.on('response', async resp => {
    const url = resp.url();
    if ((url.includes('api') || url.includes('property') || url.includes('listing') || url.includes('search')) 
        && resp.status() === 200) {
      try {
        const contentType = resp.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const json = await resp.json();
          propertyApiRequests.push({
            url: url,
            method: resp.request().method(),
            status: resp.status(),
            data: json
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  });
  
  try {
    // Navigate to homepage
    console.log('📄 Navigating to Harcourts homepage...');
    await page.goto('https://www.harcourts.com.au/', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('✅ Homepage loaded\n');
    
    // Wait a bit for any lazy-loaded scripts
    await page.waitForTimeout(2000);
    
    // Try to find and interact with search
    console.log('🔍 Looking for property search...');
    
    // Try clicking on "Buy" or "Property Search" link
    const searchSelectors = [
      'a[href*="Property"]',
      'a:has-text("Buy")',
      'a:has-text("Search")',
      'button:has-text("Search")',
      'input[type="search"]'
    ];
    
    let searchClicked = false;
    for (const selector of searchSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          console.log(`✅ Found search element: ${selector}`);
          await element.click();
          await page.waitForTimeout(3000);
          searchClicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!searchClicked) {
      console.log('⚠️  Could not find search element, trying direct URL...');
      await page.goto('https://www.harcourts.com.au/Property/Residential/For-Sale', 
                      { waitUntil: 'networkidle', timeout: 30000 });
    }
    
    console.log('✅ On search/property page\n');
    await page.waitForTimeout(3000);
    
    // Try to click on a property listing
    console.log('🏠 Looking for property listings...');
    const propertySelectors = [
      'a[href*="/Property/"]',
      '.property-card a',
      '.listing a',
      'article a'
    ];
    
    for (const selector of propertySelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          console.log(`✅ Found property listing: ${selector}`);
          await element.click();
          await page.waitForTimeout(5000);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
  } catch (error) {
    console.error('❌ Error during navigation:', error.message);
  }
  
  // Check for sitemap
  console.log('\n📋 Checking for sitemaps...');
  const sitemapUrls = [
    'https://www.harcourts.com.au/sitemap.xml',
    'https://www.harcourts.com.au/sitemap-index.xml',
    'https://www.harcourts.com.au/sitemap_index.xml',
    'https://www.harcourts.com.au/sitemap-properties.xml'
  ];
  
  const foundSitemaps = [];
  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await page.goto(sitemapUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (response && response.status() === 200) {
        console.log(`✅ Found sitemap: ${sitemapUrl}`);
        foundSitemaps.push(sitemapUrl);
      }
    } catch (e) {
      console.log(`❌ No sitemap at: ${sitemapUrl}`);
    }
  }
  
  // Results
  console.log('\n\n📊 INVESTIGATION RESULTS\n');
  console.log('='.repeat(60));
  
  console.log(`\n🌐 Total API Requests Captured: ${apiRequests.length}`);
  if (apiRequests.length > 0) {
    console.log('\nAPI Endpoints Found:');
    const uniqueUrls = [...new Set(apiRequests.map(r => r.url))];
    uniqueUrls.slice(0, 20).forEach(url => console.log(`  - ${url}`));
  }
  
  console.log(`\n🏠 Property API Requests with Data: ${propertyApiRequests.length}`);
  if (propertyApiRequests.length > 0) {
    console.log('\nProperty API Endpoints:');
    propertyApiRequests.forEach((req, i) => {
      console.log(`  ${i + 1}. ${req.method} ${req.url}`);
      console.log(`     Status: ${req.status}`);
      console.log(`     Data keys: ${Object.keys(req.data).join(', ')}`);
    });
  }
  
  console.log(`\n📋 Sitemaps Found: ${foundSitemaps.length}`);
  foundSitemaps.forEach(url => console.log(`  - ${url}`));
  
  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    totalApiRequests: apiRequests.length,
    apiEndpoints: [...new Set(apiRequests.map(r => r.url))],
    propertyApiRequests: propertyApiRequests.map(r => ({
      url: r.url,
      method: r.method,
      status: r.status,
      dataKeys: Object.keys(r.data)
    })),
    sitemapsFound: foundSitemaps
  };
  
  const fs = require('fs');
  fs.writeFileSync('harcourts-search-investigation.json', JSON.stringify(results, null, 2));
  console.log('\n💾 Results saved to: harcourts-search-investigation.json');
  
  await browser.close();
  console.log('\n✅ Investigation complete!');
})();
