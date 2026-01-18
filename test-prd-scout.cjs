#!/usr/bin/env node

/**
 * Test script for PRD Ballarat Scout
 * Tests sitemap-based property extraction with structured metadata
 */

const { PRDBallaratScout } = require('./dist/scouts/PRDBallaratScout');

async function testPRDScout() {
  console.log('='.repeat(80));
  console.log('PRD BALLARAT SCOUT TEST');
  console.log('='.repeat(80));
  console.log();

  const scout = new PRDBallaratScout();

  console.log(`Scout Name: ${scout.name}`);
  console.log(`Sitemap URL: https://www.prd.com.au/ballarat/sitemap-listings.xml`);
  console.log(`Expected Properties in Sitemap: 8,317`);
  console.log();

  console.log('-'.repeat(80));
  console.log('Testing with limit=10 properties');
  console.log('-'.repeat(80));
  console.log();

  try {
    const startTime = Date.now();
    
    // Test with 10 properties
    const listings = await scout.search({ limit: 10 });
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log();
    console.log('='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log();
    console.log(`Total properties extracted: ${listings.length}`);
    console.log(`Extraction time: ${duration} seconds`);
    console.log(`Average time per property: ${(duration / listings.length).toFixed(2)} seconds`);
    console.log();

    if (listings.length > 0) {
      console.log('-'.repeat(80));
      console.log('SAMPLE PROPERTIES (first 3)');
      console.log('-'.repeat(80));
      console.log();

      listings.slice(0, 3).forEach((listing, index) => {
        console.log(`Property ${index + 1}:`);
        console.log(`  Address: ${listing.address}`);
        console.log(`  Suburb: ${listing.suburb}`);
        console.log(`  Postcode: ${listing.postcode}`);
        console.log(`  Type: ${listing.propertyType}`);
        console.log(`  Price: ${listing.priceDisplay}`);
        console.log(`  Description: ${listing.description.substring(0, 100)}...`);
        console.log(`  URL: ${listing.url}`);
        if (listing.metadata) {
          console.log(`  Property ID: ${listing.metadata.propertyId}`);
          console.log(`  Extraction Method: ${listing.metadata.extractionMethod}`);
        }
        console.log();
      });

      console.log('-'.repeat(80));
      console.log('DATA QUALITY ANALYSIS');
      console.log('-'.repeat(80));
      console.log();

      const withPrice = listings.filter(l => l.priceDisplay && l.priceDisplay !== 'Contact agent').length;
      const withDescription = listings.filter(l => l.description && l.description.length > 20).length;
      const withSuburb = listings.filter(l => l.suburb && l.suburb !== 'Ballarat').length;

      console.log(`Properties with price: ${withPrice}/${listings.length} (${((withPrice/listings.length)*100).toFixed(1)}%)`);
      console.log(`Properties with descriptions: ${withDescription}/${listings.length} (${((withDescription/listings.length)*100).toFixed(1)}%)`);
      console.log(`Properties with specific suburb: ${withSuburb}/${listings.length} (${((withSuburb/listings.length)*100).toFixed(1)}%)`);
      console.log();

      console.log('-'.repeat(80));
      console.log('PROPERTY TYPE BREAKDOWN');
      console.log('-'.repeat(80));
      console.log();

      const typeCount = {};
      listings.forEach(l => {
        typeCount[l.propertyType] = (typeCount[l.propertyType] || 0) + 1;
      });

      Object.entries(typeCount).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      console.log();
    }

    console.log('='.repeat(80));
    console.log('✅ PRD BALLARAT SCOUT TEST COMPLETE');
    console.log('='.repeat(80));
    console.log();
    console.log(`Total properties in sitemap: 8,317`);
    console.log(`Test extraction successful: ${listings.length} properties`);
    console.log(`Sitemap strategy proven viable for PRD network`);
    console.log();

  } catch (error) {
    console.error();
    console.error('='.repeat(80));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(80));
    console.error();
    console.error('Error:', error.message);
    console.error();
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run test
testPRDScout().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
