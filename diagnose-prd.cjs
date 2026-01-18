#!/usr/bin/env node

const { chromium } = require('playwright');

async function diagnosePRD() {
  console.log('🔍 DIAGNOSING: PRD Ballarat');
  console.log('=' .repeat(70));
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const allRequests = [];
  const apiRequests = [];
  
  page.on('request', request => {
    const url = request.url();
    allRequests.push(url);
    
    if (
      url.includes('/api/') ||
      url.includes('/graphql') ||
      url.includes('properties') ||
      url.includes('search')
    ) {
      apiRequests.push({ method: request.method(), url });
      console.log(`📡 API: ${request.method()} ${url}`);
    }
  });
  
  try {
    console.log('\n📍 Loading PRD Ballarat commercial listings...');
    await page.goto('https://www.prd.com.au/ballarat/buy/?proptype=Commercial', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('✓ Page loaded\n');
    
    // Check for property cards
    const propertySelectors = [
      '.property-card',
      '.listing-card',
      '.property-item',
      '[class*="property"]',
      'article',
      '.result-item'
    ];
    
    console.log('🏢 Property card selectors:');
    for (const selector of propertySelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`   ✓ ${selector}: ${count} found`);
      }
    }
    
    // Check page source
    const content = await page.content();
    
    console.log('\n🔍 Technology detection:');
    if (content.includes('wp-content')) console.log('   ✓ WordPress detected');
    if (content.includes('easy-property-listings')) console.log('   ✓ EPL plugin detected');
    if (content.includes('react')) console.log('   ✓ React detected');
    if (content.includes('vue')) console.log('   ✓ Vue detected');
    if (content.includes('angular')) console.log('   ✓ Angular detected');
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/prd-ballarat.png' });
    console.log('\n📸 Screenshot saved to /tmp/prd-ballarat.png');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total requests: ${allRequests.length}`);
  console.log(`API requests: ${apiRequests.length}`);
  
  if (apiRequests.length > 0) {
    console.log('\n🎯 API ENDPOINTS FOUND:');
    apiRequests.forEach(req => {
      console.log(`   ${req.method} ${req.url}`);
    });
  } else {
    console.log('\n❌ No API endpoints found - will need HTML scraping');
  }
}

diagnosePRD().catch(console.error);
