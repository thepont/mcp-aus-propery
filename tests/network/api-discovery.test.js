#!/usr/bin/env node

/**
 * Network Tests - API Discovery
 * These tests REQUIRE network access and will fail in restricted environments
 * Run these in GitHub CI or environments with internet access
 */

import { chromium } from 'playwright';
import axios from 'axios';

console.log('🌐 Running Network Tests - API Discovery\n');
console.log('⚠️  These tests REQUIRE internet access to .com.au domains\n');

let passed = 0;
let failed = 0;
const discoveries = {
  cbre: { apis: [], tested_at: new Date().toISOString() },
  cameron: { apis: [], tested_at: new Date().toISOString() }
};

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

// Test 1: CBRE API endpoint discovery
await test('Discover CBRE API endpoints', async () => {
  const endpoints = [
    'https://www.cbre.com.au/api/properties',
    'https://www.cbre.com.au/api/search',
    'https://www.cbre.com.au/api/properties/search',
    'https://api.cbre.com.au/properties'
  ];
  
  console.log('   Attempting to discover CBRE APIs...');
  
  for (const endpoint of endpoints) {
    try {
      console.log(`   Trying: ${endpoint}`);
      const response = await axios.get(endpoint, { timeout: 10000 });
      console.log(`   ✓ SUCCESS: ${response.status} ${response.statusText}`);
      console.log(`   ✓ Content-Type: ${response.headers['content-type']}`);
      discoveries.cbre.apis.push({
        url: endpoint,
        status: response.status,
        contentType: response.headers['content-type'],
        working: true
      });
    } catch (error) {
      console.log(`   ✗ ${error.code || error.message}`);
      discoveries.cbre.apis.push({
        url: endpoint,
        error: error.code || error.message,
        working: false
      });
    }
  }
  
  const workingApis = discoveries.cbre.apis.filter(a => a.working);
  if (workingApis.length === 0) {
    throw new Error('No CBRE API endpoints responded (DNS likely blocked)');
  }
  console.log(`   Found ${workingApis.length} working API(s)`);
});

// Test 2: Cameron API endpoint discovery
await test('Discover Cameron API endpoints', async () => {
  const endpoints = [
    'https://www.cameron.com.au/api/properties',
    'https://www.cameron.com.au/api/search',
    'https://api.cameron.com.au/properties'
  ];
  
  console.log('   Attempting to discover Cameron APIs...');
  
  for (const endpoint of endpoints) {
    try {
      console.log(`   Trying: ${endpoint}`);
      const response = await axios.get(endpoint, { timeout: 10000 });
      console.log(`   ✓ SUCCESS: ${response.status} ${response.statusText}`);
      console.log(`   ✓ Content-Type: ${response.headers['content-type']}`);
      discoveries.cameron.apis.push({
        url: endpoint,
        status: response.status,
        contentType: response.headers['content-type'],
        working: true
      });
    } catch (error) {
      console.log(`   ✗ ${error.code || error.message}`);
      discoveries.cameron.apis.push({
        url: endpoint,
        error: error.code || error.message,
        working: false
      });
    }
  }
  
  const workingApis = discoveries.cameron.apis.filter(a => a.working);
  if (workingApis.length === 0) {
    throw new Error('No Cameron API endpoints responded (DNS likely blocked)');
  }
  console.log(`   Found ${workingApis.length} working API(s)`);
});

// Test 3: Playwright network interception
await test('Intercept network requests with Playwright', async () => {
  console.log('   Launching browser with network monitoring...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const requests = [];
  
  page.on('request', request => {
    const url = request.url();
    const type = request.resourceType();
    if (type === 'xhr' || type === 'fetch') {
      console.log(`   📡 Captured: ${request.method()} ${url}`);
      requests.push({ method: request.method(), url, type });
    }
  });
  
  console.log('   Navigating to CBRE...');
  await page.goto('https://www.cbre.com.au/properties/industrial-warehouse', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  console.log(`   ✓ Captured ${requests.length} API requests`);
  discoveries.cbre.intercepted_requests = requests;
  
  if (requests.length === 0) {
    console.log('   ⚠️  No API requests detected - page may use server-side rendering');
  }
  
  await browser.close();
});

// Save discoveries
import fs from 'fs';
fs.writeFileSync(
  'tests/network/api-discoveries.json',
  JSON.stringify(discoveries, null, 2)
);

console.log('\n' + '='.repeat(60));
console.log(`Network Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  Network tests failed');
  console.log('   This is EXPECTED in environments without internet access');
  console.log('   Run these tests in GitHub CI or a production environment\n');
  console.log('📄 Partial discoveries saved to: tests/network/api-discoveries.json\n');
  process.exit(1);
} else {
  console.log('\n✅ All network tests passed');
  console.log('📄 API discoveries saved to: tests/network/api-discoveries.json\n');
  process.exit(0);
}
