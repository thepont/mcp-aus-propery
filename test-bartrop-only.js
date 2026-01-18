#!/usr/bin/env node

/**
 * Test Bartrop Scout (Sitemap Strategy)
 */

import { BartropScout } from './dist/scouts/BartropScout.js';

async function main() {
  console.log('🔍 Testing Bartrop Real Estate Scout (Sitemap Strategy)\n');

  const scout = new BartropScout();
  
  try {
    console.log('Starting search (will fetch up to 50 properties from sitemap)...\n');
    
    const results = await scout.search({
      location: 'Ballarat'
    });

    console.log(`\n✅ Successfully extracted ${results.length} properties from Bartrop sitemap`);
    
    if (results.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('SAMPLE PROPERTIES (first 5):');
      console.log('='.repeat(80));
      
      results.slice(0, 5).forEach((prop, i) => {
        console.log(`\n${i + 1}. ${prop.address}`);
        console.log(`   Price: ${prop.priceDisplay || 'Not specified'}`);
        console.log(`   URL: ${prop.sourceUrl}`);
        console.log(`   Category: ${prop.zoning || 'Unknown'}`);
        console.log(`   Description: ${prop.description.substring(0, 150)}...`);
      });
      
      console.log('\n' + '='.repeat(80));
      console.log('STATISTICS:');
      console.log('='.repeat(80));
      console.log(`Total properties: ${results.length}`);
      console.log(`With prices: ${results.filter(p => p.price || p.priceDisplay).length}`);
      console.log(`With descriptions: ${results.filter(p => p.description && p.description.length > 50).length}`);
      console.log('='.repeat(80));
    } else {
      console.log('\n⚠️ No properties found. This may indicate:');
      console.log('  - Site structure changed');
      console.log('  - Selectors need adjustment');
      console.log('  - Network issues');
    }

    await scout.cleanup();
    
    return results.length > 0 ? 0 : 1;
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await scout.cleanup();
    return 1;
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
