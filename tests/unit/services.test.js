#!/usr/bin/env node

/**
 * Unit Tests - Services
 * Tests new services (PropertyValueService, MarketService) in isolation
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Running Service Unit Tests (No Network Required)\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`  Testing: ${name}...`);
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     Error: ${error.message}`);
    if (error.stack) console.log(error.stack.split('\n').slice(1,3).join('\n'));
    failed++;
  }
}

// Main execution
(async () => {
  // Test 1: PropertyValueService can be imported
  await test('PropertyValueService can be imported', async () => {
    const { PropertyValueService } = await import('../../dist/services/PropertyValueService.js');
    assert(PropertyValueService, 'PropertyValueService should be defined');
    console.log(`     ✓ PropertyValueService imported successfully`);
  });

  // Test 2: MarketService can be imported
  await test('MarketService can be imported', async () => {
    const { MarketService } = await import('../../dist/services/MarketService.js');
    assert(MarketService, 'MarketService should be defined');
    console.log(`     ✓ MarketService imported successfully`);
  });

  // Test 3: PropertyValueService instantiation
  await test('PropertyValueService can be instantiated', async () => {
    const { PropertyValueService } = await import('../../dist/services/PropertyValueService.js');
    const service = new PropertyValueService();
    assert(service, 'Service instance should be created');
    assert(typeof service.getEstimate === 'function', 'Should have getEstimate method');
    assert(typeof service.getSuburbTrends === 'function', 'Should have getSuburbTrends method');
    console.log(`     ✓ PropertyValueService has required methods`);
  });

  // Test 4: MarketService instantiation
  await test('MarketService can be instantiated', async () => {
    const { MarketService } = await import('../../dist/services/MarketService.js');
    const service = new MarketService();
    assert(service, 'Service instance should be created');
    assert(typeof service.getSuburbTrends === 'function', 'Should have getSuburbTrends method');
    console.log(`     ✓ MarketService has required methods`);
  });

  // Test 5: Verify types/interfaces
  await test('Types module exports expected interfaces (runtime check)', async () => {
      const typesModule = await import('../../dist/types.js');
      console.log(`     ✓ Types module loaded: ${Object.keys(typesModule)}`);
      assert(typesModule.BaseScout, 'BaseScout should be exported');
  });

  // Test 6: Verify Service Method Signatures
  await test('Service methods accept correct arguments', async () => {
      const { PropertyValueService } = await import('../../dist/services/PropertyValueService.js');
      const service = new PropertyValueService();
      
      assert.equal(service.getEstimate.length, 1, 'getEstimate should take 1 argument (address)');
      assert.equal(service.getSuburbTrends.length, 1, 'getSuburbTrends should take 1 argument (suburb)');
  });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Service Unit Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
      process.exit(1);
  } else {
      process.exit(0);
  }
})();
