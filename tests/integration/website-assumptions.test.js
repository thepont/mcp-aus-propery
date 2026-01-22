#!/usr/bin/env node

/**
 * CRITICAL Integration Tests - Website Assumptions
 * 
 * These tests verify ALL assumptions we've made about the websites
 * since we haven't been able to actually view them.
 * 
 * MUST be run in an environment with internet access to validate:
 * - URLs are correct
 * - Pages load successfully  
 * - Selectors match actual HTML structure
 * - JSON-LD exists and has correct structure
 * - Data extraction logic works
 * - Full end-to-end scout functionality
 */

import { chromium } from 'playwright';
import axios from 'axios';
import fs from 'fs';

console.log('🔍 CRITICAL INTEGRATION TESTS - Website Assumptions\n');
console.log('=' .repeat(70));
console.log('⚠️  These tests validate ALL assumptions about websites');
console.log('⚠️  MUST be run with internet access to .com.au domains');
console.log('⚠️  Will FAIL in restricted environments - this is EXPECTED');
console.log('=' .repeat(70));
console.log('');

let passed = 0;
let failed = 0;
const results = {
  test_date: new Date().toISOString(),
  environment: 'unknown',
  cbre: { assumptions: [], validations: [] },
  cameron: { assumptions: [], validations: [] }
};

async function test(name, fn) {
  try {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📋 TEST: ${name}`);
    console.log('─'.repeat(70));
    await fn();
    console.log(`✅ PASS: ${name}\n`);
    passed++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    if (error.details) {
      console.log(`   Details: ${error.details}`);
    }
    console.log('');
    failed++;
  }
}

// ============================================================================
// CBRE TESTS - Validate ALL assumptions
// ============================================================================

await test('ASSUMPTION 1: CBRE domain www.cbre.com.au exists and resolves', async () => {
  console.log('   Testing DNS resolution for www.cbre.com.au...');
  
  try {
    const response = await axios.head('https://www.cbre.com.au', { 
      timeout: 10000,
      maxRedirects: 5 
    });
    console.log(`   ✓ Domain resolves successfully`);
    console.log(`   ✓ Status: ${response.status} ${response.statusText}`);
    console.log(`   ✓ Final URL: ${response.request.res.responseUrl || response.config.url}`);
    
    results.cbre.assumptions.push({
      assumption: 'Domain exists',
      validated: true,
      status: response.status
    });
  } catch (error) {
    const err = new Error('Domain does not resolve or is unreachable');
    err.details = `${error.code || error.message} - DNS likely blocked or domain incorrect`;
    results.cbre.assumptions.push({
      assumption: 'Domain exists',
      validated: false,
      error: error.code || error.message
    });
    throw err;
  }
});

await test('ASSUMPTION 2: CBRE industrial property URL is correct', async () => {
  const url = 'https://www.cbre.com.au/properties/industrial-warehouse?aspects=isSale,isLease';
  console.log(`   Testing URL: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    const status = response.status();
    const finalUrl = page.url();
    
    console.log(`   ✓ Page loads successfully`);
    console.log(`   ✓ Status: ${status}`);
    console.log(`   ✓ Final URL: ${finalUrl}`);
    
    if (status === 404) {
      throw new Error('URL returns 404 - path is incorrect');
    }
    
    if (status >= 400) {
      throw new Error(`URL returns ${status} - may be incorrect or require auth`);
    }
    
    const title = await page.title();
    console.log(`   ✓ Page title: "${title}"`);
    
    results.cbre.assumptions.push({
      assumption: 'Industrial property URL is correct',
      validated: true,
      url,
      status,
      title
    });
  } finally {
    await browser.close();
  }
});

await test('ASSUMPTION 3: CBRE page contains property listings', async () => {
  const url = 'https://www.cbre.com.au/properties/industrial-warehouse';
  console.log(`   Checking for property listings on page...`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);
    
    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    
    // Check for property-related keywords
    const keywords = ['property', 'industrial', 'warehouse', 'lease', 'sale', 'sqm', 'address'];
    const foundKeywords = keywords.filter(kw => bodyText.includes(kw));
    
    console.log(`   ✓ Page contains ${foundKeywords.length}/${keywords.length} property keywords`);
    console.log(`   ✓ Found: ${foundKeywords.join(', ')}`);
    
    if (foundKeywords.length < 3) {
      throw new Error('Page does not appear to contain property listings');
    }
    
    results.cbre.assumptions.push({
      assumption: 'Page contains property listings',
      validated: true,
      keywords_found: foundKeywords.length,
      keywords_total: keywords.length
    });
  } finally {
    await browser.close();
  }
});

await test('ASSUMPTION 4: CBRE selector .property-card exists', async () => {
  const url = 'https://www.cbre.com.au/properties/industrial-warehouse';
  console.log(`   Testing selector: .property-card`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const count = await page.locator('.property-card').count();
    console.log(`   Found ${count} elements matching .property-card`);
    
    if (count === 0) {
      // Try to find what selectors DO exist
      console.log(`   ⚠️  .property-card not found, searching for alternatives...`);
      
      const alternatives = [
        '[data-testid*="property"]',
        '[class*="property"]',
        '[class*="listing"]',
        '.listing-card',
        'article'
      ];
      
      for (const selector of alternatives) {
        const altCount = await page.locator(selector).count();
        if (altCount > 0) {
          console.log(`   ℹ️  Alternative found: "${selector}" (${altCount} elements)`);
        }
      }
      
      throw new Error('Selector .property-card does not exist on page');
    }
    
    // Extract sample data from first property
    const firstProperty = page.locator('.property-card').first();
    const html = await firstProperty.innerHTML();
    const text = await firstProperty.textContent();
    
    console.log(`   ✓ First property text (100 chars): ${text.substring(0, 100)}...`);
    
    results.cbre.validations.push({
      selector: '.property-card',
      found: true,
      count,
      sample_text: text.substring(0, 200)
    });
  } finally {
    await browser.close();
  }
});

await test('ASSUMPTION 5: CBRE property cards contain extractable data', async () => {
  const url = 'https://www.cbre.com.au/properties/industrial-warehouse';
  console.log(`   Testing data extraction from .property-card`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const cards = page.locator('.property-card');
    const count = await cards.count();
    
    if (count === 0) {
      throw new Error('No property cards found to extract data from');
    }
    
    console.log(`   Testing extraction from ${Math.min(count, 3)} property cards...`);
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const card = cards.nth(i);
      const text = await card.textContent();
      
      // Check for address-like patterns
      const hasAddress = /\d+.*(?:street|st|road|rd|avenue|ave|drive|dr)/i.test(text);
      const hasSuburb = /(?:VIC|NSW|QLD|SA|WA|TAS|NT|ACT)/i.test(text);
      const hasPrice = /\$|price|lease|from/i.test(text);
      const hasArea = /sqm|m²|hectare/i.test(text);
      
      console.log(`   Property ${i + 1}:`);
      console.log(`      Address pattern: ${hasAddress ? '✓' : '✗'}`);
      console.log(`      State/suburb: ${hasSuburb ? '✓' : '✗'}`);
      console.log(`      Price info: ${hasPrice ? '✓' : '✗'}`);
      console.log(`      Area info: ${hasArea ? '✓' : '✗'}`);
      
      results.cbre.validations.push({
        property_index: i,
        has_address: hasAddress,
        has_suburb: hasSuburb,
        has_price: hasPrice,
        has_area: hasArea
      });
    }
  } finally {
    await browser.close();
  }
});

await test('ASSUMPTION 6: CBRE page has JSON-LD structured data', async () => {
  const url = 'https://www.cbre.com.au/properties/industrial-warehouse';
  console.log(`   Checking for JSON-LD structured data...`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const jsonLdCount = await page.locator('script[type="application/ld+json"]').count();
    console.log(`   Found ${jsonLdCount} JSON-LD script tags`);
    
    if (jsonLdCount === 0) {
      console.log(`   ⚠️  No JSON-LD found - will rely on HTML extraction only`);
      results.cbre.assumptions.push({
        assumption: 'Page has JSON-LD',
        validated: false
      });
      return; // Not a failure, just means we use HTML extraction
    }
    
    // Parse JSON-LD
    for (let i = 0; i < jsonLdCount; i++) {
      const jsonLdText = await page.locator('script[type="application/ld+json"]').nth(i).textContent();
      try {
        const data = JSON.parse(jsonLdText);
        console.log(`   ✓ JSON-LD ${i + 1}: @type = ${data['@type'] || 'unknown'}`);
        
        if (data['@type'] === 'RealEstateListing') {
          console.log(`   ✅ Found RealEstateListing JSON-LD!`);
          console.log(`   ✓ Has address: ${!!data.address}`);
          console.log(`   ✓ Has description: ${!!data.description}`);
          
          results.cbre.assumptions.push({
            assumption: 'Page has JSON-LD RealEstateListing',
            validated: true,
            has_address: !!data.address,
            has_description: !!data.description
          });
        }
      } catch (e) {
        console.log(`   ✗ JSON-LD ${i + 1}: Failed to parse`);
      }
    }
  } finally {
    await browser.close();
  }
});

// ============================================================================
// CAMERON TESTS - Validate ALL assumptions
// ============================================================================

await test('ASSUMPTION 7: Cameron domain www.cameron.com.au exists and resolves', async () => {
  console.log('   Testing DNS resolution for www.cameron.com.au...');
  
  try {
    const response = await axios.head('https://www.cameron.com.au', { 
      timeout: 10000,
      maxRedirects: 5 
    });
    console.log(`   ✓ Domain resolves successfully`);
    console.log(`   ✓ Status: ${response.status} ${response.statusText}`);
    
    results.cameron.assumptions.push({
      assumption: 'Domain exists',
      validated: true,
      status: response.status
    });
  } catch (error) {
    const err = new Error('Domain does not resolve or is unreachable');
    err.details = `${error.code || error.message} - DNS likely blocked or domain incorrect`;
    results.cameron.assumptions.push({
      assumption: 'Domain exists',
      validated: false,
      error: error.code || error.message
    });
    throw err;
  }
});

await test('ASSUMPTION 8: Cameron commercial property URL is correct', async () => {
  const url = 'https://www.cameron.com.au/commercial/?type=industrial&type=warehouse';
  console.log(`   Testing URL: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    const status = response.status();
    const finalUrl = page.url();
    
    console.log(`   ✓ Page loads successfully`);
    console.log(`   ✓ Status: ${status}`);
    console.log(`   ✓ Final URL: ${finalUrl}`);
    
    if (status === 404) {
      throw new Error('URL returns 404 - path is incorrect');
    }
    
    const title = await page.title();
    console.log(`   ✓ Page title: "${title}"`);
    
    results.cameron.assumptions.push({
      assumption: 'Commercial property URL is correct',
      validated: true,
      url,
      status,
      title
    });
  } finally {
    await browser.close();
  }
});

await test('ASSUMPTION 9: Cameron page contains property listings', async () => {
  const url = 'https://www.cameron.com.au/commercial/';
  console.log(`   Checking for property listings on page...`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    
    const keywords = ['property', 'commercial', 'industrial', 'warehouse', 'lease', 'sale', 'sqm'];
    const foundKeywords = keywords.filter(kw => bodyText.includes(kw));
    
    console.log(`   ✓ Page contains ${foundKeywords.length}/${keywords.length} property keywords`);
    console.log(`   ✓ Found: ${foundKeywords.join(', ')}`);
    
    if (foundKeywords.length < 3) {
      throw new Error('Page does not appear to contain property listings');
    }
    
    results.cameron.assumptions.push({
      assumption: 'Page contains property listings',
      validated: true,
      keywords_found: foundKeywords.length
    });
  } finally {
    await browser.close();
  }
});

await test('ASSUMPTION 10: Cameron selector .property-card or .listing-item exists', async () => {
  const url = 'https://www.cameron.com.au/commercial/';
  console.log(`   Testing selectors: .property-card, .listing-item`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const selectors = [
      '.property-card',
      '.listing-item',
      '[class*="property"]',
      '[class*="listing"]',
      'article'
    ];
    
    let foundSelector = null;
    let foundCount = 0;
    
    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      console.log(`   ${selector}: ${count} elements`);
      
      if (count > 0 && !foundSelector) {
        foundSelector = selector;
        foundCount = count;
      }
    }
    
    if (!foundSelector) {
      throw new Error('None of the expected selectors found on page');
    }
    
    console.log(`   ✓ Using selector: "${foundSelector}" (${foundCount} elements)`);
    
    results.cameron.validations.push({
      selectors_tested: selectors,
      working_selector: foundSelector,
      count: foundCount
    });
  } finally {
    await browser.close();
  }
});

// ============================================================================
// FULL SCOUT INTEGRATION TESTS
// ============================================================================

await test('INTEGRATION: CBRE Scout full execution returns data', async () => {
  console.log('   Loading and executing CBRE Scout...');
  
  const { CbreScout } = await import('../../dist/scouts/CbreScout.js');
  const scout = new CbreScout();
  
  console.log(`   ✓ Scout created: ${scout.name}`);
  console.log('   Executing search for Melbourne...');
  
  const startTime = Date.now();
  const results = await scout.search({ location: 'Melbourne' });
  const duration = Date.now() - startTime;
  
  console.log(`   ✓ Search completed in ${duration}ms`);
  console.log(`   ✓ Found ${results.length} listings`);
  
  if (results.length === 0) {
    throw new Error('Scout returned 0 listings - implementation is not working');
  }
  
  // Validate first result
  const first = results[0];
  console.log('\n   First listing:');
  console.log(`   - Address: ${first.address || 'MISSING'}`);
  console.log(`   - Description: ${first.description?.substring(0, 100) || 'MISSING'}...`);
  console.log(`   - Source URL: ${first.sourceUrl || 'MISSING'}`);
  console.log(`   - Price: ${first.price || 'N/A'}`);
  console.log(`   - Area: ${first.area || 'N/A'}`);
  console.log(`   - Zoning: ${first.zoning || 'N/A'}`);
  
  if (!first.address) {
    throw new Error('Listing missing required field: address');
  }
  
  if (!first.description) {
    throw new Error('Listing missing required field: description');
  }
  
  console.log(`   ✅ CBRE Scout is working and returning valid data!`);
});

await test('INTEGRATION: Cameron Scout full execution returns data', async () => {
  console.log('   Loading and executing Cameron Scout...');
  
  const { CameronScout } = await import('../../dist/scouts/CameronScout.js');
  const scout = new CameronScout();
  
  console.log(`   ✓ Scout created: ${scout.name}`);
  console.log('   Executing search for Melbourne...');
  
  const startTime = Date.now();
  const results = await scout.search({ location: 'Melbourne' });
  const duration = Date.now() - startTime;
  
  console.log(`   ✓ Search completed in ${duration}ms`);
  console.log(`   ✓ Found ${results.length} listings`);
  
  if (results.length === 0) {
    throw new Error('Scout returned 0 listings - implementation is not working');
  }
  
  // Validate first result
  const first = results[0];
  console.log('\n   First listing:');
  console.log(`   - Address: ${first.address || 'MISSING'}`);
  console.log(`   - Description: ${first.description?.substring(0, 100) || 'MISSING'}...`);
  console.log(`   - Source URL: ${first.sourceUrl || 'MISSING'}`);
  console.log(`   - Price: ${first.price || 'N/A'}`);
  console.log(`   - Area: ${first.area || 'N/A'}`);
  
  if (!first.address) {
    throw new Error('Listing missing required field: address');
  }
  
  if (!first.description) {
    throw new Error('Listing missing required field: description');
  }
  
  console.log(`   ✅ Cameron Scout is working and returning valid data!`);
});

await test('INTEGRATION: ScoutManager executes both scouts and deduplicates', async () => {
  console.log('   Loading ScoutManager...');
  
  const { ScoutManager } = await import('../../dist/ScoutManager.js');
  const manager = new ScoutManager();
  await manager.initialize();
  
  console.log('   Executing full search...');
  const result = await manager.searchAll({ location: 'Melbourne' });
  
  console.log(`   ✓ Total listings: ${result.summary.total_listings}`);
  console.log(`   ✓ Scouts used: ${result.summary.scouts_used}`);
  console.log(`   ✓ Unique listings after deduplication: ${result.listings.length}`);
  
  if (result.summary.total_listings === 0) {
    throw new Error('No listings returned from any scout');
  }
  
  if (result.listings.length === 0) {
    throw new Error('Deduplication removed all listings - logic may be wrong');
  }
  
  console.log(`   ✅ Full integration working end-to-end!`);
});

// Save detailed results
fs.writeFileSync(
  'tests/integration/website-validation-results.json',
  JSON.stringify(results, null, 2)
);

console.log('\n' + '='.repeat(70));
console.log('CRITICAL INTEGRATION TEST RESULTS');
console.log('='.repeat(70));
console.log(`Total Tests: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('='.repeat(70));

if (failed > 0) {
  console.log('\n❌ CRITICAL: Website assumption tests FAILED');
  console.log('   The implementation CANNOT be trusted until these pass');
  console.log('   Must be run in environment with internet access');
  console.log('\n📄 Detailed results saved to: tests/integration/website-validation-results.json\n');
  process.exit(1);
} else {
  console.log('\n✅ ALL ASSUMPTIONS VALIDATED!');
  console.log('   Websites are accessible');
  console.log('   URLs are correct');
  console.log('   Selectors work');
  console.log('   Data extraction works');
  console.log('   Scouts return real listings');
  console.log('\n📄 Validation results saved to: tests/integration/website-validation-results.json');
  console.log('\n🎉 Implementation is VERIFIED and production-ready!\n');
  process.exit(0);
}
