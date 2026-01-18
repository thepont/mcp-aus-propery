#!/usr/bin/env node

/**
 * Comprehensive Integration Test Suite
 * Tests both API approach and Playwright approach
 */

import { chromium } from 'playwright';
import axios from 'axios';

const results = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  tests: []
};

function recordTest(name, status, details, error = null) {
  const test = {
    name,
    status, // 'PASS', 'FAIL', 'SKIP'
    details,
    error: error ? error.message : null,
    timestamp: new Date().toISOString()
  };
  results.tests.push(test);
  
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  if (error) console.log(`   Error: ${error.message}`);
  console.log('');
}

// Test 1: CBRE API Endpoint
async function testCBREApi() {
  console.log('\n═══ Test 1: CBRE API Endpoint ═══\n');
  
  const endpoints = [
    'https://www.cbre.com.au/api/search/properties',
    'https://www.cbre.com.au/api/properties',
    'https://api.cbre.com.au/properties',
    'https://www.cbre.com.au/api/v1/properties'
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(endpoint, {
        propertyTypes: ['Industrial'],
        location: 'Sydney'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000,
        validateStatus: () => true // Accept any status
      });
      
      if (response.status === 200 && response.data) {
        recordTest(`CBRE API: ${endpoint}`, 'PASS', 
          `Status: ${response.status}, Has data: ${!!response.data}`);
        return;
      } else {
        recordTest(`CBRE API: ${endpoint}`, 'FAIL', 
          `Status: ${response.status}, Not a working API`);
      }
    } catch (error) {
      recordTest(`CBRE API: ${endpoint}`, 'FAIL', 
        `Cannot reach endpoint`, error);
    }
  }
}

// Test 2: Cameron API Endpoint
async function testCameronApi() {
  console.log('\n═══ Test 2: Cameron API Endpoint ═══\n');
  
  const endpoints = [
    'https://www.cameron.com.au/api/properties',
    'https://www.cameron.com.au/api/search',
    'https://api.cameron.com.au/properties'
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint, {
        params: {
          type: 'industrial',
          location: 'Melbourne'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000,
        validateStatus: () => true
      });
      
      if (response.status === 200 && response.data) {
        recordTest(`Cameron API: ${endpoint}`, 'PASS', 
          `Status: ${response.status}, Has data: ${!!response.data}`);
        return;
      } else {
        recordTest(`Cameron API: ${endpoint}`, 'FAIL', 
          `Status: ${response.status}, Not a working API`);
      }
    } catch (error) {
      recordTest(`Cameron API: ${endpoint}`, 'FAIL', 
        `Cannot reach endpoint`, error);
    }
  }
}

// Test 3: DNS Resolution
async function testDNSResolution() {
  console.log('\n═══ Test 3: DNS Resolution ═══\n');
  
  const domains = [
    'www.cbre.com.au',
    'www.cameron.com.au'
  ];
  
  for (const domain of domains) {
    try {
      const response = await axios.get(`https://${domain}`, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true
      });
      
      recordTest(`DNS Resolution: ${domain}`, 'PASS', 
        `Status: ${response.status}, Resolved successfully`);
    } catch (error) {
      if (error.code === 'ENOTFOUND') {
        recordTest(`DNS Resolution: ${domain}`, 'FAIL', 
          `DNS lookup failed - domain not resolvable in this environment`, error);
      } else {
        recordTest(`DNS Resolution: ${domain}`, 'FAIL', 
          `Connection error`, error);
      }
    }
  }
}

// Test 4: Playwright Navigation - CBRE
async function testCBREPlaywright() {
  console.log('\n═══ Test 4: CBRE Playwright Navigation ═══\n');
  
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();
    
    const url = 'https://www.cbre.com.au/properties/industrial-warehouse';
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    const title = await page.title();
    const content = await page.content();
    
    // Look for property listings
    const selectors = [
      '.property-card',
      '[data-testid*="property"]',
      'article',
      '.listing'
    ];
    
    let foundElements = 0;
    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        foundElements = count;
        break;
      }
    }
    
    recordTest('CBRE Playwright Navigation', 'PASS', 
      `Page loaded. Title: "${title}", Found ${foundElements} potential property elements`);
      
  } catch (error) {
    recordTest('CBRE Playwright Navigation', 'FAIL', 
      `Navigation failed`, error);
  } finally {
    if (browser) await browser.close();
  }
}

// Test 5: Playwright Navigation - Cameron
async function testCameronPlaywright() {
  console.log('\n═══ Test 5: Cameron Playwright Navigation ═══\n');
  
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();
    
    const url = 'https://www.cameron.com.au/commercial/';
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    const title = await page.title();
    
    const selectors = [
      '.property-card',
      '.listing-item',
      'article',
      '[class*="property"]'
    ];
    
    let foundElements = 0;
    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        foundElements = count;
        break;
      }
    }
    
    recordTest('Cameron Playwright Navigation', 'PASS', 
      `Page loaded. Title: "${title}", Found ${foundElements} potential property elements`);
      
  } catch (error) {
    recordTest('Cameron Playwright Navigation', 'FAIL', 
      `Navigation failed`, error);
  } finally {
    if (browser) await browser.close();
  }
}

// Test 6: Scout Implementation
async function testScoutImplementation() {
  console.log('\n═══ Test 6: Scout Implementation ═══\n');
  
  try {
    const { ScoutManager } = await import('./dist/ScoutManager.js');
    const manager = new ScoutManager();
    
    const scoutNames = await manager.getScoutNames();
    
    if (scoutNames.length === 0) {
      recordTest('Scout Registration', 'FAIL', 
        'No scouts registered');
      return;
    }
    
    recordTest('Scout Registration', 'PASS', 
      `Registered ${scoutNames.length} scouts: ${scoutNames.join(', ')}`);
    
    // Test search execution
    console.log('   Running search...');
    const listings = await manager.findIndustrialDeals({
      location: 'Melbourne',
      maxPrice: 5000000
    });
    
    if (listings.length > 0) {
      recordTest('Scout Search Execution', 'PASS', 
        `Found ${listings.length} listings`);
      
      // Show sample
      console.log('\n   Sample listings:');
      listings.slice(0, 2).forEach((listing, idx) => {
        console.log(`   ${idx + 1}. ${listing.address} (${listing.source})`);
      });
      console.log('');
    } else {
      recordTest('Scout Search Execution', 'FAIL', 
        `No listings found - network issues or website structure changed`);
    }
    
    await manager.cleanup();
    
  } catch (error) {
    recordTest('Scout Implementation', 'FAIL', 
      'Error testing scouts', error);
  }
}

// Test 7: TypeScript Build
async function testBuild() {
  console.log('\n═══ Test 7: TypeScript Build ═══\n');
  
  try {
    const { existsSync } = await import('fs');
    const distExists = existsSync('./dist');
    const indexExists = existsSync('./dist/index.js');
    const scoutManagerExists = existsSync('./dist/ScoutManager.js');
    
    if (distExists && indexExists && scoutManagerExists) {
      recordTest('TypeScript Build', 'PASS', 
        'All compiled files exist');
    } else {
      recordTest('TypeScript Build', 'FAIL', 
        `Missing files: dist=${distExists}, index=${indexExists}, ScoutManager=${scoutManagerExists}`);
    }
  } catch (error) {
    recordTest('TypeScript Build', 'FAIL', 
      'Error checking build', error);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   Comprehensive Integration Test Suite                           ║');
  console.log('║   Testing APIs, Playwright, and Scout Implementation             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  await testBuild();
  await testDNSResolution();
  await testCBREApi();
  await testCameronApi();
  await testCBREPlaywright();
  await testCameronPlaywright();
  await testScoutImplementation();
  
  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   TEST SUMMARY                                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  
  const passed = results.tests.filter(t => t.status === 'PASS').length;
  const failed = results.tests.filter(t => t.status === 'FAIL').length;
  const skipped = results.tests.filter(t => t.status === 'SKIP').length;
  const total = results.tests.length;
  
  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Skipped: ${skipped}`);
  
  console.log('\n📋 Failed Tests:');
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`   ❌ ${t.name}`);
    console.log(`      ${t.details}`);
    if (t.error) {
      console.log(`      Error: ${t.error}`);
    }
  });
  
  // Save results
  const { writeFileSync } = await import('fs');
  writeFileSync('test-results.json', JSON.stringify(results, null, 2));
  console.log('\n💾 Full results saved to test-results.json\n');
  
  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
