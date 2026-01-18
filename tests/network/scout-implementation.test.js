#!/usr/bin/env node

/**
 * Network Tests - Scout Implementation
 * Tests actual scout functionality with real network requests
 * REQUIRES internet access - will fail in restricted environments
 */

import { chromium } from 'playwright';

console.log('🌐 Running Network Tests - Scout Implementation\n');
console.log('⚠️  These tests REQUIRE internet access to .com.au domains\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`\n📋 Testing: ${name}`);
    console.log('─'.repeat(60));
    await fn();
    console.log(`✅ PASS: ${name}\n`);
    passed++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    console.log(`   This is EXPECTED if DNS is blocked\n`);
    failed++;
  }
}

// Test 1: CBRE Scout - Playwright Navigation
await test('CBRE Scout - Navigate and extract with Playwright', async () => {
  const url = 'https://www.cbre.com.au/properties/industrial-warehouse';
  console.log(`   Target URL: ${url}`);
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  console.log('   Navigating...');
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  
  console.log(`   ✓ Status: ${response.status()} ${response.statusText()}`);
  console.log(`   ✓ URL: ${response.url()}`);
  
  const title = await page.title();
  console.log(`   ✓ Page Title: ${title}`);
  
  // Check for JSON-LD
  console.log('\n   Checking for JSON-LD structured data...');
  const jsonLdScripts = await page.locator('script[type="application/ld+json"]').count();
  console.log(`   ✓ Found ${jsonLdScripts} JSON-LD script(s)`);
  
  if (jsonLdScripts > 0) {
    const jsonLdContent = await page.locator('script[type="application/ld+json"]').first().textContent();
    try {
      const data = JSON.parse(jsonLdContent);
      console.log(`   ✓ JSON-LD type: ${data['@type'] || 'unknown'}`);
      if (data['@type'] === 'RealEstateListing') {
        console.log(`   ✓ Found RealEstateListing!`);
      }
    } catch (e) {
      console.log(`   ✗ Failed to parse JSON-LD`);
    }
  }
  
  // Check for property cards
  console.log('\n   Checking for property listings...');
  const selectors = [
    '.property-card',
    '[data-testid*="property"]',
    '.listing-card',
    'article',
    '[class*="property"]'
  ];
  
  let foundListings = false;
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      console.log(`   ✓ Found ${count} elements: "${selector}"`);
      foundListings = true;
      
      // Try to extract data from first listing
      const firstListing = page.locator(selector).first();
      const text = await firstListing.textContent();
      console.log(`   ✓ Sample text (first 100 chars): ${text.substring(0, 100)}...`);
    }
  }
  
  if (!foundListings) {
    console.log(`   ⚠️  No property listings found with tested selectors`);
    console.log(`   ⚠️  Manual inspection needed to find correct selectors`);
  }
  
  await browser.close();
  
  if (!foundListings) {
    throw new Error('No property listings found - selectors need adjustment');
  }
});

// Test 2: Cameron Scout - Playwright Navigation
await test('Cameron Scout - Navigate and extract with Playwright', async () => {
  const url = 'https://www.cameron.com.au/commercial/';
  console.log(`   Target URL: ${url}`);
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  console.log('   Navigating...');
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  
  console.log(`   ✓ Status: ${response.status()} ${response.statusText()}`);
  console.log(`   ✓ URL: ${response.url()}`);
  
  const title = await page.title();
  console.log(`   ✓ Page Title: ${title}`);
  
  // Check for JSON-LD
  console.log('\n   Checking for JSON-LD structured data...');
  const jsonLdScripts = await page.locator('script[type="application/ld+json"]').count();
  console.log(`   ✓ Found ${jsonLdScripts} JSON-LD script(s)`);
  
  // Check for property cards
  console.log('\n   Checking for property listings...');
  const selectors = [
    '.property-card',
    '.listing-item',
    'article',
    '[class*="property"]',
    '[class*="listing"]'
  ];
  
  let foundListings = false;
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      console.log(`   ✓ Found ${count} elements: "${selector}"`);
      foundListings = true;
      
      // Try to extract data from first listing
      const firstListing = page.locator(selector).first();
      const text = await firstListing.textContent();
      console.log(`   ✓ Sample text (first 100 chars): ${text.substring(0, 100)}...`);
    }
  }
  
  if (!foundListings) {
    console.log(`   ⚠️  No property listings found with tested selectors`);
    console.log(`   ⚠️  Manual inspection needed to find correct selectors`);
  }
  
  await browser.close();
  
  if (!foundListings) {
    throw new Error('No property listings found - selectors need adjustment');
  }
});

// Test 3: Full Scout Execution
await test('Full Scout Execution - CBRE Scout', async () => {
  console.log('   Loading CBRE Scout...');
  const { CbreScout } = await import('../../dist/scouts/CbreScout.js');
  
  const scout = new CbreScout();
  console.log(`   ✓ Scout created: ${scout.name}`);
  
  console.log('\n   Executing search...');
  const results = await scout.search({ location: 'Melbourne' });
  
  console.log(`   ✓ Search completed`);
  console.log(`   ✓ Found ${results.length} listings`);
  
  if (results.length > 0) {
    const first = results[0];
    console.log('\n   Sample listing:');
    console.log(`   - Address: ${first.address || 'N/A'}`);
    console.log(`   - Description: ${first.description?.substring(0, 100) || 'N/A'}...`);
    console.log(`   - Source URL: ${first.sourceUrl || 'N/A'}`);
    console.log(`   - Source: ${first.source || 'N/A'}`);
  } else {
    throw new Error('Scout returned 0 listings - check implementation');
  }
});

// Test 4: Full Scout Execution - Cameron
await test('Full Scout Execution - Cameron Scout', async () => {
  console.log('   Loading Cameron Scout...');
  const { CameronScout } = await import('../../dist/scouts/CameronScout.js');
  
  const scout = new CameronScout();
  console.log(`   ✓ Scout created: ${scout.name}`);
  
  console.log('\n   Executing search...');
  const results = await scout.search({ location: 'Melbourne' });
  
  console.log(`   ✓ Search completed`);
  console.log(`   ✓ Found ${results.length} listings`);
  
  if (results.length > 0) {
    const first = results[0];
    console.log('\n   Sample listing:');
    console.log(`   - Address: ${first.address || 'N/A'}`);
    console.log(`   - Description: ${first.description?.substring(0, 100) || 'N/A'}...`);
    console.log(`   - Source URL: ${first.sourceUrl || 'N/A'}`);
    console.log(`   - Source: ${first.source || 'N/A'}`);
  } else {
    throw new Error('Scout returned 0 listings - check implementation');
  }
});

console.log('\n' + '='.repeat(60));
console.log(`Network Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  Scout implementation tests failed');
  console.log('   This is EXPECTED in environments without internet access');
  console.log('   Run these tests in GitHub CI or a production environment\n');
  process.exit(1);
} else {
  console.log('\n✅ All scout implementation tests passed');
  console.log('   Scouts are working correctly!\n');
  process.exit(0);
}
