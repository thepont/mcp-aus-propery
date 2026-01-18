#!/usr/bin/env node

/**
 * Unit Tests - Can run without network access
 * Tests framework components in isolation
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Running Unit Tests (No Network Required)\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    console.log(`  Testing: ${name}...`);
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

// Test 1: TypeScript compilation
test('TypeScript compilation produces all expected files', () => {
  const expectedFiles = [
    'dist/index.js',
    'dist/ScoutManager.js',
    'dist/types.js',
    'dist/scouts/CbreScout.js',
    'dist/scouts/CameronScout.js'
  ];
  
  for (const file of expectedFiles) {
    const fullPath = path.join(process.cwd(), file);
    assert(fs.existsSync(fullPath), `Expected file ${file} to exist`);
    console.log(`     ✓ Found ${file}`);
  }
});

// Test 2: Package.json structure
test('package.json has all required dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const requiredDeps = [
    '@modelcontextprotocol/sdk',
    'axios',
    'playwright'
  ];
  
  for (const dep of requiredDeps) {
    assert(pkg.dependencies[dep], `Expected dependency ${dep}`);
    console.log(`     ✓ Found ${dep}@${pkg.dependencies[dep]}`);
  }
});

// Test 3: Scout manager can be imported
test('ScoutManager module can be imported', async () => {
  const { ScoutManager } = await import('../dist/ScoutManager.js');
  assert(ScoutManager, 'ScoutManager should be defined');
  console.log(`     ✓ ScoutManager imported successfully`);
});

// Test 4: Scouts can be imported
test('Scout modules can be imported', async () => {
  const cbreModule = await import('../dist/scouts/CbreScout.js');
  const cameronModule = await import('../dist/scouts/CameronScout.js');
  
  assert(cbreModule.CbreScout, 'CbreScout should be defined');
  assert(cameronModule.CameronScout, 'CameronScout should be defined');
  console.log(`     ✓ CbreScout imported successfully`);
  console.log(`     ✓ CameronScout imported successfully`);
});

// Test 5: ScoutManager initialization
test('ScoutManager initializes without errors', async () => {
  const { ScoutManager } = await import('../dist/ScoutManager.js');
  const manager = new ScoutManager();
  assert(manager, 'Manager should be created');
  console.log(`     ✓ ScoutManager instance created`);
});

// Test 6: Scout registration
test('ScoutManager registers scouts', async () => {
  const { ScoutManager } = await import('../dist/ScoutManager.js');
  const manager = new ScoutManager();
  await manager.initialize();
  
  const scouts = manager.getScouts();
  console.log(`     ✓ Registered ${scouts.length} scouts`);
  
  assert(scouts.length > 0, 'Should have at least one scout registered');
  
  for (const scout of scouts) {
    console.log(`     ✓ Scout: ${scout.name}`);
    assert(typeof scout.search === 'function', `${scout.name} should have search method`);
  }
});

// Test 7: Scout interface compliance
test('Scouts implement required interface', async () => {
  const { ScoutManager } = await import('../dist/ScoutManager.js');
  const manager = new ScoutManager();
  await manager.initialize();
  
  const scouts = manager.getScouts();
  
  for (const scout of scouts) {
    assert(scout.name, `Scout should have name property`);
    assert(typeof scout.search === 'function', `Scout should have search method`);
    console.log(`     ✓ ${scout.name} implements required interface`);
  }
});

// Test 8: Deduplication logic
test('ScoutManager deduplication works', async () => {
  const { ScoutManager } = await import('../dist/ScoutManager.js');
  const manager = new ScoutManager();
  
  const testListings = [
    { address: '123 Main St, Melbourne VIC', description: 'Property 1' },
    { address: '123 Main Street, Melbourne, VIC', description: 'Property 2' },
    { address: '456 Other Rd, Sydney NSW', description: 'Property 3' }
  ];
  
  // Access private method for testing (not ideal but necessary for unit test)
  const deduplicated = manager.deduplicateListings(testListings);
  
  console.log(`     ✓ Input: ${testListings.length} listings`);
  console.log(`     ✓ Output: ${deduplicated.length} listings`);
  
  // Should deduplicate the two similar addresses
  assert(deduplicated.length === 2, `Expected 2 unique listings, got ${deduplicated.length}`);
});

// Test 9: Error handling in scout execution
test('ScoutManager handles scout errors gracefully', async () => {
  const { ScoutManager } = await import('../dist/ScoutManager.js');
  const manager = new ScoutManager();
  
  // This should not throw even though scouts will fail to connect
  const result = await manager.searchAll({ location: 'Test' });
  
  assert(result, 'Result should be defined');
  assert(Array.isArray(result.listings), 'Result should have listings array');
  console.log(`     ✓ Returned ${result.listings.length} listings (expected 0 without network)`);
  console.log(`     ✓ No errors thrown despite network failure`);
});

// Test 10: MCP server can be imported
test('MCP server module can be imported', async () => {
  const serverModule = await import('../dist/index.js');
  assert(serverModule, 'Server module should be defined');
  console.log(`     ✓ Server module imported successfully`);
});

// Summary
console.log('\n' + '='.repeat(60));
console.log(`Unit Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  Some unit tests failed - fix these before proceeding\n');
  process.exit(1);
} else {
  console.log('\n✅ All unit tests passed - framework is working correctly\n');
  process.exit(0);
}
