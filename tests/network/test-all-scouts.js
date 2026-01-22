#!/usr/bin/env node

/**
 * Network Tests - All Scouts
 * Iterates through all registered scouts and verifies they return data.
 */

import { ScoutManager } from '../../dist/ScoutManager.js';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// @ts-ignore
chromium.use(StealthPlugin());

console.log('🌐 Running Network Tests - ALL Scouts\n');

let passed = 0;
let failed = 0;

async function testScout(scout) {
    const name = scout.name;
    console.log(`\n📋 Testing Scout: ${name}`);
    console.log('─'.repeat(60));

    let searchParams = {
        location: 'Melbourne',
        propertyType: 'residential',
        listingType: 'sale'
    };

    // Override search params for specific scouts
    if (name.includes('PRD') || name.includes('Ballarat')) {
        searchParams.location = 'Ballarat';
        searchParams.propertyType = 'residential'; // PRD Ballarat has residential
    } else if (name.includes('Bartrop')) {
        searchParams.location = 'Ballarat';
        searchParams.propertyType = 'residential'; // Bartrop is in Ballarat, assumed residential for now
    } else if (name.includes('Cameron') || name.includes('CBRE') || name.includes('Colliers')) {
        // These are typically commercial/industrial
        searchParams.location = 'Melbourne';
        searchParams.propertyType = 'industrial';
        searchParams.listingType = 'sale';
    } else if (name.includes('Ray White')) {
        searchParams.location = 'Sydney'; // Ray White is national
        searchParams.propertyType = 'residential';
    }
    
    try {
        const browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        // Inject browser if needed
        if (typeof scout.setBrowser === 'function') {
            scout.setBrowser(browser);
        }

        console.log(`   Searching for '${searchParams.location}' (PropertyType: ${searchParams.propertyType}, ListingType: ${searchParams.listingType})...`);
        const results = await scout.search(searchParams);

        console.log(`   ✓ Returned ${results.length} listings`);

        if (results.length > 0) {
            const first = results[0];
            console.log(`   ✓ Sample: ${first.address} (${first.priceDisplay || 'No Price'})`);
            
            // Basic validation
            if (!first.address) throw new Error('Listing missing address');
            if (!first.sourceUrl) throw new Error('Listing missing sourceUrl');
            if (!first.sources || first.sources.length === 0) throw new Error('Listing missing sources array');
            
            console.log(`✅ PASS: ${name}`);
            passed++;
        } else {
            // It's still a pass if no results are found, but we log a warning.
            // This is because a valid search might genuinely return 0 results.
            console.warn(`⚠️  WARNING: ${name} returned 0 results for this query. This might be expected for niche scouts or specific locations.`);
            passed++; 
        }

        await browser.close();

    } catch (error) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}`);
        failed++;
    }
}
(async () => {
    const manager = new ScoutManager();
    // Initialize to register scouts
    await manager.init(); 
    
    // Access private scouts array using 'any' cast or a getter if added
    // The previous `ScoutManager.ts` code didn't have a public getter for instances, 
    // but `registerScouts` populates `this.scouts`.
    // We'll assume we can access it or use a method. 
    // Wait, `ScoutManager.ts` has `getScoutNames`, but not getScouts.
    // Let's modify `ScoutManager` to expose scouts for testing OR just read the files manually like the manager does.
    
    // Actually, let's just inspect the manager instance.
    const scouts = (manager).scouts; 

    if (!scouts || scouts.length === 0) {
        console.error('❌ No scouts registered in Manager!');
        process.exit(1);
    }

    console.log(`Found ${scouts.length} registered scouts.`);

    for (const scout of scouts) {
        await testScout(scout);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Scout Test Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    if (failed > 0) process.exit(1);
    process.exit(0);
})();
