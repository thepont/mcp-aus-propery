#!/usr/bin/env node

/**
 * Test Ballarat Agency Scouts
 * 
 * Tests the newly implemented scouts:
 * 1. Ballarat Real Estate (Agentpoint)
 * 2. Bartrop Real Estate (Sitemap strategy)
 */

import { BallaratRealEstateScout } from './dist/scouts/BallaratRealEstateScout.js';
import { BartropScout } from './dist/scouts/BartropScout.js';

async function testBallaratRealEstate() {
  console.log('\n='.repeat(80));
  console.log('Testing Ballarat Real Estate Scout (Agentpoint)');
  console.log('='.repeat(80));

  const scout = new BallaratRealEstateScout();
  
  try {
    const results = await scout.search({
      location: 'Ballarat'
    });

    console.log(`\n✅ Found ${results.length} properties`);
    
    if (results.length > 0) {
      console.log('\nFirst 3 properties:');
      results.slice(0, 3).forEach((prop, i) => {
        console.log(`\n${i + 1}. ${prop.address}`);
        console.log(`   Price: ${prop.priceDisplay || 'Not specified'}`);
        console.log(`   URL: ${prop.sourceUrl}`);
        console.log(`   Description: ${prop.description.substring(0, 100)}...`);
      });
    }

    return results.length;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return 0;
  }
}

async function testBartrop() {
  console.log('\n='.repeat(80));
  console.log('Testing Bartrop Real Estate Scout (Sitemap Strategy)');
  console.log('='.repeat(80));

  const scout = new BartropScout();
  
  try {
    // Test with a small sample
    const results = await scout.search({
      location: 'Ballarat'
    });

    console.log(`\n✅ Found ${results.length} properties via sitemap`);
    
    if (results.length > 0) {
      console.log('\nFirst 3 properties:');
      results.slice(0, 3).forEach((prop, i) => {
        console.log(`\n${i + 1}. ${prop.address}`);
        console.log(`   Price: ${prop.priceDisplay || 'Not specified'}`);
        console.log(`   URL: ${prop.sourceUrl}`);
        console.log(`   Extracted via: ${prop.metadata?.extractedVia}`);
      });
    }

    await scout.cleanup();
    return results.length;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return 0;
  }
}

async function main() {
  console.log('🔍 Testing Ballarat Agency Scouts');
  console.log('This will test the newly implemented scouts for Ballarat agencies\n');

  const results = {
    ballaratRE: 0,
    bartrop: 0
  };

  // Test Ballarat Real Estate
  results.ballaratRE = await testBallaratRealEstate();

  // Test Bartrop
  results.bartrop = await testBartrop();

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Ballarat Real Estate: ${results.ballaratRE} properties`);
  console.log(`Bartrop Real Estate:  ${results.bartrop} properties`);
  console.log(`Total:                ${results.ballaratRE + results.bartrop} properties`);
  console.log('='.repeat(80));
}

main().catch(console.error);
