#!/usr/bin/env node

const { chromium } = require('playwright');

async function analyzePRD() {
  console.log('🔍 Deep Analysis: PRD Ballarat\n');
  console.log('Launching browser and capturing all network traffic...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  const apiRequests = [];
  const allRequests = [];
  
  // Intercept all requests
  page.on('request', request => {
    const url = request.url();
    allRequests.push({
      url,
      method: request.method(),
      type: request.resourceType()
    });
    
    if (url.includes('/api/') || 
        url.includes('property') || 
        url.includes('listing') ||
        url.includes('search') ||
        request.resourceType() === 'fetch' ||
        request.resourceType() === 'xhr') {
      apiRequests.push({
        url,
        method: request.method(),
        type: request.resourceType(),
        headers: request.headers()
      });
    }
  });
  
  // Capture responses
  const apiResponses = [];
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/') || 
        url.includes('property') || 
        url.includes('listing') ||
        url.includes('search')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const json = await response.json();
          apiResponses.push({
            url,
            status: response.status(),
            data: json
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  });
  
  try {
    console.log('📍 Navigating to https://www.prd.com.au/ballarat/');
    await page.goto('https://www.prd.com.au/ballarat/', { 
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('⏳ Waiting for page to fully load...\n');
    await page.waitForTimeout(3000);
    
    // Try to click on property search or listings
    console.log('🔍 Looking for property search elements...');
    const possibleSelectors = [
      'a[href*="property"]',
      'a[href*="listing"]', 
      'a[href*="commercial"]',
      'button:has-text("Search")',
      'input[placeholder*="Search"]'
    ];
    
    for (const selector of possibleSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`   Found: ${selector}`);
          const href = await element.getAttribute('href');
          if (href) console.log(`   → ${href}`);
        }
      } catch (e) {
        // Element not found
      }
    }
    
    // Check for search pages
    console.log('\n📄 Trying to navigate to property search page...');
    try {
      await page.goto('https://www.prd.com.au/ballarat/property-search/', {
        waitUntil: 'networkidle',
        timeout: 15000
      });
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('   Property search page not accessible');
    }
    
    // Try commercial search
    console.log('📄 Trying commercial listings...');
    try {
      await page.goto('https://www.prd.com.au/ballarat/commercial/', {
        waitUntil: 'networkidle',
        timeout: 15000
      });
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('   Commercial page not accessible');
    }
    
  } catch (error) {
    console.error('Error during navigation:', error.message);
  }
  
  await browser.close();
  
  // Report findings
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINDINGS');
  console.log('='.repeat(60));
  
  console.log(`\nTotal Requests: ${allRequests.length}`);
  console.log(`API/Property Requests: ${apiRequests.length}\n`);
  
  if (apiRequests.length > 0) {
    console.log('🔗 API Endpoints Found:');
    apiRequests.forEach((req, i) => {
      console.log(`\n${i + 1}. ${req.method} ${req.url}`);
      console.log(`   Type: ${req.type}`);
      if (req.headers.authorization) {
        console.log(`   Auth: ${req.headers.authorization.substring(0, 50)}...`);
      }
    });
  } else {
    console.log('❌ No API endpoints detected');
  }
  
  if (apiResponses.length > 0) {
    console.log('\n\n📦 API Responses:');
    apiResponses.forEach((res, i) => {
      console.log(`\n${i + 1}. ${res.url}`);
      console.log(`   Status: ${res.status}`);
      console.log(`   Data preview: ${JSON.stringify(res.data).substring(0, 200)}...`);
    });
  }
  
  // Check page structure
  console.log('\n\n🏗️  PAGE STRUCTURE ANALYSIS:');
  
  const scriptTags = allRequests.filter(r => r.url.includes('.js'));
  console.log(`\nJavaScript files loaded: ${scriptTags.length}`);
  
  const prdScripts = scriptTags.filter(r => 
    r.url.includes('prd.com.au') && 
    !r.url.includes('google') && 
    !r.url.includes('analytics')
  );
  
  if (prdScripts.length > 0) {
    console.log('\n📜 PRD-specific scripts:');
    prdScripts.slice(0, 10).forEach(script => {
      console.log(`   - ${script.url}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('💡 CONCLUSION');
  console.log('='.repeat(60));
  
  if (apiRequests.length === 0) {
    console.log(`
❌ No REST APIs found for property data

PRD Ballarat appears to use:
  → Server-side rendering (no client-side property API)
  → Custom Angular platform
  → No standard CRM integration detected

Recommended Approach:
  1. Use Playwright to scrape HTML directly
  2. Navigate to property listing pages
  3. Extract property data from HTML structure
  4. No API integration possible

This requires a custom scout implementation with:
  → HTML selectors for property cards
  → Page navigation logic
  → Data extraction from rendered HTML
`);
  } else {
    console.log(`
✅ Found ${apiRequests.length} potential API endpoints

Next Steps:
  1. Test API endpoints manually
  2. Identify authentication requirements
  3. Determine response format
  4. Build scout using discovered APIs
`);
  }
  
  // Save detailed report
  const fs = require('fs');
  fs.writeFileSync('prd-analysis-detailed.json', JSON.stringify({
    allRequests: allRequests.slice(0, 50),
    apiRequests,
    apiResponses,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  console.log('\n📄 Detailed report saved to: prd-analysis-detailed.json\n');
}

analyzePRD().catch(console.error);
