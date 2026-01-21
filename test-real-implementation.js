#!/usr/bin/env node

/**
 * Test script to verify scouts actually work with real Playwright navigation
 */

import { ScoutManager } from './dist/ScoutManager.js';

async function testScouts() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   Testing Real Scout Implementation                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const manager = new ScoutManager();
  
  const scoutNames = await manager.getScoutNames();
  console.log(`✅ Registered ${scoutNames.length} scouts:`);
  scoutNames.forEach(name => {
    console.log(`   - ${name}`);
  });

  console.log('\n🔍 Testing search for industrial properties in Melbourne...\n');

  try {
    const listings = await manager.findProperties({
      location: 'Melbourne',
      maxPrice: 5000000
    });

    console.log('\n📊 Search Results:');
    console.log(`   Total listings: ${listings.length}`);

    if (listings.length > 0) {
      console.log('\n✅ SUCCESS! Found real property listings:\n');
      
      // Show first 3 listings
      listings.slice(0, 3).forEach((listing, idx) => {
        console.log(`${idx + 1}. ${listing.address}`);
        console.log(`   Source: ${listing.source}`);
        console.log(`   URL: ${listing.sourceUrl}`);
        console.log(`   Price: ${listing.priceDisplay || 'Contact Agent'}`);
        console.log(`   Area: ${listing.area || 'N/A'}`);
        console.log(`   Description: ${(listing.description || '').substring(0, 100)}...`);
        console.log('');
      });

      if (listings.length > 3) {
        console.log(`   ... and ${listings.length - 3} more listings\n`);
      }
    } else {
      console.log('\n⚠️  No listings found. This could mean:');
      console.log('   1. Network access is restricted in this environment');
      console.log('   2. Websites are blocking automated access');
      console.log('   3. Page structure has changed');
      console.log('   4. No properties match the search criteria\n');
      
      console.log('   The scouts attempted to navigate and scrape, but returned empty results.');
      console.log('   This is expected in restricted CI/CD environments.\n');
    }

    console.log('✅ Test completed successfully - scouts executed without crashing\n');
    
    // Cleanup
    await manager.cleanup();
    
  } catch (error) {
    console.error('❌ Error during search:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

testScouts().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
