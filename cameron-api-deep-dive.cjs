#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');

async function deepAPIDive() {
  console.log('🔬 DEEP API INVESTIGATION - Cameron Real Estate');
  console.log('=' .repeat(70));
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Track ALL network activity
  const allRequests = [];
  const apiRequests = [];
  const ajaxRequests = [];
  
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();
    const postData = request.postData();
    
    allRequests.push({ url, method, resourceType, postData });
    
    // Look for any potential API calls
    if (
      url.includes('/api/') ||
      url.includes('/graphql') ||
      url.includes('/search') ||
      url.includes('/query') ||
      url.includes('/properties') ||
      url.includes('/commercial') ||
      url.includes('/listing') ||
      resourceType === 'xhr' ||
      resourceType === 'fetch'
    ) {
      apiRequests.push({ url, method, resourceType, postData });
      console.log(`🔍 Potential API: ${method} ${url}`);
    }
  });
  
  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        ajaxRequests.push({
          url,
          status: response.status(),
          data: data
        });
        console.log(`📦 JSON Response from: ${url}`);
        console.log(`   Status: ${response.status()}`);
        console.log(`   Data keys: ${Object.keys(data).slice(0, 10).join(', ')}`);
      } catch (err) {
        // Not JSON or already consumed
      }
    }
  });
  
  try {
    console.log('\n📍 Step 1: Navigate to Cameron commercial page...');
    await page.goto('https://www.cameron.com.au/commercial/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    console.log('✓ Page loaded');
    
    // Wait for any AJAX to complete
    await page.waitForTimeout(3000);
    
    console.log('\n📍 Step 2: Perform a search for "industrial"...');
    
    // Look for search input
    const searchInput = await page.locator('input[type="search"], input[name="s"], input[placeholder*="Search"], #search, .search-field').first();
    const searchExists = await searchInput.count() > 0;
    
    if (searchExists) {
      console.log('✓ Found search input, entering "industrial"...');
      await searchInput.fill('industrial');
      await page.waitForTimeout(1000);
      
      // Try to submit
      const searchButton = await page.locator('button[type="submit"], .search-submit, .search-button, input[type="submit"]').first();
      if (await searchButton.count() > 0) {
        console.log('✓ Clicking search button...');
        await searchButton.click();
        await page.waitForTimeout(3000);
      } else {
        console.log('✓ Pressing Enter...');
        await searchInput.press('Enter');
        await page.waitForTimeout(3000);
      }
    } else {
      console.log('⚠️  No search input found');
    }
    
    console.log('\n📍 Step 3: Try filter interactions...');
    
    // Look for filter dropdowns/buttons
    const filterSelectors = [
      'select[name*="type"]',
      'select[name*="property"]',
      '.filter select',
      '.epl-search-row select',
      'button[class*="filter"]'
    ];
    
    for (const selector of filterSelectors) {
      const element = await page.locator(selector).first();
      if (await element.count() > 0) {
        console.log(`✓ Found filter: ${selector}`);
        try {
          await element.click();
          await page.waitForTimeout(1000);
        } catch (err) {
          console.log(`  └─ Could not interact: ${err.message}`);
        }
      }
    }
    
    console.log('\n📍 Step 4: Try pagination...');
    
    // Look for pagination
    const nextPageSelectors = [
      'a.next',
      '.pagination a:has-text("Next")',
      '.pagination a:has-text("2")',
      '[rel="next"]',
      'a[href*="page"]'
    ];
    
    for (const selector of nextPageSelectors) {
      const element = await page.locator(selector).first();
      if (await element.count() > 0) {
        console.log(`✓ Found pagination: ${selector}`);
        const href = await element.getAttribute('href');
        console.log(`  └─ Link: ${href}`);
        break;
      }
    }
    
    console.log('\n📍 Step 5: Check page source for hidden APIs...');
    
    const content = await page.content();
    
    // Look for API endpoints in JavaScript
    const apiPatterns = [
      /https?:\/\/[^"'\s]+\/api\/[^"'\s]+/g,
      /https?:\/\/[^"'\s]+\/graphql[^"'\s]*/g,
      /ajax_url['"]\s*:\s*['"]([^'"]+)['"]/g,
      /endpoint['"]\s*:\s*['"]([^'"]+)['"]/g,
      /"url":\s*"([^"]*api[^"]*)"/g,
      /"url":\s*"([^"]*search[^"]*)"/g
    ];
    
    const foundEndpoints = new Set();
    for (const pattern of apiPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        foundEndpoints.add(match[0]);
      }
    }
    
    if (foundEndpoints.size > 0) {
      console.log('\n📌 Found potential API endpoints in page source:');
      for (const endpoint of foundEndpoints) {
        console.log(`   - ${endpoint}`);
      }
    } else {
      console.log('⚠️  No API endpoints found in page source');
    }
    
    // Check for AJAX variables
    const ajaxVars = await page.evaluate(() => {
      const vars = {};
      if (window.ajaxurl) vars.ajaxurl = window.ajaxurl;
      if (window.ajax_url) vars.ajax_url = window.ajax_url;
      if (window.wp) vars.wp = 'WordPress detected';
      return vars;
    });
    
    if (Object.keys(ajaxVars).length > 0) {
      console.log('\n📌 Found AJAX variables:');
      console.log(JSON.stringify(ajaxVars, null, 2));
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
  
  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total requests captured: ${allRequests.length}`);
  console.log(`Potential API requests: ${apiRequests.length}`);
  console.log(`JSON responses: ${ajaxRequests.length}`);
  
  if (apiRequests.length > 0) {
    console.log('\n🎯 POTENTIAL API ENDPOINTS:');
    apiRequests.forEach((req, i) => {
      console.log(`\n${i + 1}. ${req.method} ${req.url}`);
      console.log(`   Type: ${req.resourceType}`);
      if (req.postData) {
        console.log(`   POST Data: ${req.postData.substring(0, 200)}...`);
      }
    });
  }
  
  if (ajaxRequests.length > 0) {
    console.log('\n📦 JSON RESPONSES:');
    ajaxRequests.forEach((resp, i) => {
      console.log(`\n${i + 1}. ${resp.url}`);
      console.log(`   Status: ${resp.status}`);
      if (resp.data && typeof resp.data === 'object') {
        console.log(`   Keys: ${Object.keys(resp.data).slice(0, 10).join(', ')}`);
      }
    });
  }
  
  // Save detailed report
  const report = {
    summary: {
      totalRequests: allRequests.length,
      potentialAPIs: apiRequests.length,
      jsonResponses: ajaxRequests.length
    },
    allRequests: allRequests,
    apiRequests: apiRequests,
    ajaxResponses: ajaxRequests
  };
  
  fs.writeFileSync('cameron-api-deep-dive.json', JSON.stringify(report, null, 2));
  console.log('\n💾 Full report saved to: cameron-api-deep-dive.json');
  
  // Conclusion
  console.log('\n' + '='.repeat(70));
  console.log('🔍 CONCLUSION');
  console.log('='.repeat(70));
  
  if (apiRequests.length === 0) {
    console.log('❌ NO API ENDPOINTS FOUND');
    console.log('   Cameron appears to use server-side rendering only');
    console.log('   Properties are rendered in HTML on page load');
    console.log('   ✓ HTML scraping is the correct approach');
  } else {
    console.log('✅ FOUND POTENTIAL APIs');
    console.log('   Review the endpoints above');
    console.log('   Test them manually to confirm they return property data');
  }
}

deepAPIDive().catch(console.error);
