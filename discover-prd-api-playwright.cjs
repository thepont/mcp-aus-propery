#!/usr/bin/env node

const { chromium } = require('playwright');

async function discoverPRDAPI() {
  console.log('🔍 Discovering PRD Ballarat API with Playwright...\n');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const apiCalls = [];
    const allRequests = [];
    
    // Intercept all network requests
    page.on('request', request => {
      const url = request.url();
      allRequests.push({
        url: url,
        method: request.method(),
        resourceType: request.resourceType(),
        headers: request.headers()
      });
      
      // Look for API-like requests
      if (url.includes('api') || 
          url.includes('listonce') || 
          url.includes('/v1/') || 
          url.includes('/v2/') ||
          url.includes('json') ||
          request.resourceType() === 'xhr' ||
          request.resourceType() === 'fetch') {
        console.log(`📡 API Request: ${request.method()} ${url}`);
      }
    });
    
    page.on('response', async response => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      // Capture API responses
      if ((url.includes('api') || url.includes('listonce') || url.includes('json')) &&
          contentType.includes('application/json')) {
        try {
          const data = await response.json();
          apiCalls.push({
            url: url,
            status: response.status(),
            method: response.request().method(),
            data: data
          });
          console.log(`✅ JSON Response from: ${url}`);
          console.log(`   Status: ${response.status()}`);
          console.log(`   Data keys: ${Object.keys(data).join(', ')}`);
        } catch (e) {
          // Not JSON or failed to parse
        }
      }
    });
    
    // Navigate to PRD Ballarat property search
    console.log('\n🌐 Navigating to PRD Ballarat property search...');
    await page.goto('https://www.prd.com.au/ballarat/property-search/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    
    console.log('✅ Page loaded successfully\n');
    
    // Wait a bit for any lazy-loaded requests
    await page.waitForTimeout(3000);
    
    // Try to perform a search for commercial properties
    console.log('🔍 Attempting to trigger property search...');
    
    // Look for search form or filters
    const searchButtons = await page.$$('button, input[type="submit"], a.search');
    console.log(`   Found ${searchButtons.length} potential search triggers`);
    
    // Check for commercial/industrial filters
    const commercialLinks = await page.$$('a:has-text("Commercial"), button:has-text("Commercial"), input[value*="commercial"]');
    if (commercialLinks.length > 0) {
      console.log(`   Found ${commercialLinks.length} commercial filter options`);
      try {
        await commercialLinks[0].click();
        await page.waitForTimeout(2000);
        console.log('   ✅ Clicked commercial filter');
      } catch (e) {
        console.log('   ⚠️  Could not click commercial filter');
      }
    }
    
    // Look for any form submissions
    const forms = await page.$$('form');
    console.log(`   Found ${forms.length} forms on page`);
    
    // Check page source for embedded API configuration
    console.log('\n🔍 Checking page source for API configuration...');
    const pageContent = await page.content();
    
    // Look for API URLs in the source
    const apiPatterns = [
      /api\.listonce\.com\.au/g,
      /client_id["\s:=]+(\d+)/gi,
      /apiKey["\s:=]+["']([^"']+)["']/gi,
      /baseUrl["\s:=]+["']([^"']+)["']/gi
    ];
    
    for (const pattern of apiPatterns) {
      const matches = pageContent.match(pattern);
      if (matches) {
        console.log(`   Found pattern: ${pattern}`);
        matches.slice(0, 5).forEach(match => console.log(`     - ${match}`));
      }
    }
    
    // Execute JavaScript to check for global configs
    console.log('\n🔍 Checking for JavaScript configuration objects...');
    const jsConfig = await page.evaluate(() => {
      const configs = {};
      
      // Common config object names
      const configNames = ['listOnceConfig', 'apiConfig', 'siteConfig', 'APP_CONFIG', 'window.config'];
      
      for (const name of configNames) {
        try {
          const parts = name.split('.');
          let obj = window;
          for (const part of parts) {
            obj = obj[part];
          }
          if (obj) {
            configs[name] = JSON.stringify(obj, null, 2);
          }
        } catch (e) {
          // Config doesn't exist
        }
      }
      
      return configs;
    });
    
    if (Object.keys(jsConfig).length > 0) {
      console.log('   Found configuration objects:');
      for (const [name, value] of Object.entries(jsConfig)) {
        console.log(`   - ${name}:`);
        console.log(`     ${value.substring(0, 200)}...`);
      }
    } else {
      console.log('   No standard configuration objects found');
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 DISCOVERY SUMMARY');
    console.log('='.repeat(70));
    
    console.log(`\nTotal Requests: ${allRequests.length}`);
    console.log(`API Calls with JSON: ${apiCalls.length}`);
    
    if (apiCalls.length > 0) {
      console.log('\n🎯 API Endpoints Discovered:');
      apiCalls.forEach((call, i) => {
        console.log(`\n${i + 1}. ${call.method} ${call.url}`);
        console.log(`   Status: ${call.status}`);
        if (call.data) {
          console.log(`   Response keys: ${Object.keys(call.data).join(', ')}`);
          if (call.data.client_id) console.log(`   ✅ client_id: ${call.data.client_id}`);
          if (call.data.results) console.log(`   ✅ results count: ${call.data.results.length || 'N/A'}`);
        }
      });
    } else {
      console.log('\n⚠️  No JSON API endpoints discovered');
      console.log('    The site may use:');
      console.log('    - Server-side rendering only');
      console.log('    - Non-JSON API formats');
      console.log('    - Complex client-side JavaScript that needs interaction');
    }
    
    // Save detailed results
    const fs = require('fs');
    fs.writeFileSync(
      '/home/runner/work/mcp-aus-propery/mcp-aus-propery/prd-api-discovery-results.json',
      JSON.stringify({ apiCalls, allRequests: allRequests.slice(0, 100), jsConfig }, null, 2)
    );
    
    console.log('\n✅ Full results saved to: prd-api-discovery-results.json');
    
  } catch (error) {
    console.error('\n❌ Error during discovery:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

discoverPRDAPI().catch(console.error);
