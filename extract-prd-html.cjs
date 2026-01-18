#!/usr/bin/env node
const { chromium } = require('playwright');

async function extractPRDData() {
  console.log('🔍 Extracting PRD Ballarat data from HTML...\n');
  
  const browser = await chromium.launch({ headless: true });
  
  try {
    const page = await browser.newPage();
    
    console.log('🌐 Loading PRD Ballarat...');
    await page.goto('https://www.prd.com.au/ballarat/property-search/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    
    // Extract data from page
    const pageData = await page.evaluate(() => {
      // Look for any embedded JSON or API configuration
      const scripts = Array.from(document.querySelectorAll('script'));
      let listOnceConfig = null;
      let apiCalls = [];
      
      // Check script tags for configuration
      for (const script of scripts) {
        const content = script.textContent || '';
        
        // Look for ListOnce configuration
        if (content.includes('listonce') || content.includes('client_id')) {
          const clientMatch = content.match(/client_id["\s:=]+(\d+)/i);
          if (clientMatch) {
            listOnceConfig = { client_id: clientMatch[1] };
          }
          
          // Look for API URLs
          const apiMatch = content.match(/(https?:\/\/[^\s"']+listonce[^\s"']+)/gi);
          if (apiMatch) {
            apiCalls = apiCalls.concat(apiMatch);
          }
        }
      }
      
      // Extract property cards/listings
      const propertyCards = [];
      const cards = document.querySelectorAll('.property-card, .listing, .property-listing, [class*="property"]');
      
      cards.forEach((card, i) => {
        if (i < 5) { // First 5
          const text = card.textContent || '';
          const images = Array.from(card.querySelectorAll('img')).map(img => img.src);
          propertyCards.push({
            text: text.substring(0, 200),
            images: images.slice(0, 2),
            html: card.outerHTML.substring(0, 500)
          });
        }
      });
      
      return {
        listOnceConfig,
        apiCalls: [...new Set(apiCalls)],
        propertyCards,
        hasListOnceImages: document.body.innerHTML.includes('images.listonce.com.au'),
        pageTitle: document.title,
        bodyClasses: document.body.className
      };
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 EXTRACTION RESULTS');
    console.log('='.repeat(70));
    
    console.log(`\nPage Title: ${pageData.pageTitle}`);
    console.log(`Uses ListOnce Images: ${pageData.hasListOnceImages}`);
    
    if (pageData.listOnceConfig) {
      console.log(`\n🎯 ListOnce Configuration Found!`);
      console.log(`   client_id: ${pageData.listOnceConfig.client_id}`);
    }
    
    if (pageData.apiCalls.length > 0) {
      console.log(`\n📡 API URLs Found in Scripts:`);
      pageData.apiCalls.forEach(url => {
        console.log(`   ${url}`);
      });
    }
    
    console.log(`\nProperty Cards Found: ${pageData.propertyCards.length}`);
    if (pageData.propertyCards.length > 0) {
      console.log(`\nFirst Property Sample:`);
      console.log(`   Text: ${pageData.propertyCards[0].text.substring(0, 150)}...`);
      console.log(`   Images: ${pageData.propertyCards[0].images.length}`);
    }
    
    // Now check the page source more carefully
    const html = await page.content();
    
    // Look for inline data
    const dataMatches = {
      clientId: html.match(/client_id["\s:=]+(\d+)/i),
      apiUrl: html.match(/(https?:\/\/api[^"'\s]+listonce[^"'\s]+)/i),
      listingsData: html.match(/(var|const|let)\s+listings\s*=\s*(\[[^\]]+\])/i)
    };
    
    console.log(`\n�� Additional Analysis:`);
    if (dataMatches.clientId) {
      console.log(`   ✨ Found client_id: ${dataMatches.clientId[1]}`);
    }
    if (dataMatches.apiUrl) {
      console.log(`   ✨ Found API URL: ${dataMatches.apiUrl[1]}`);
    }
    if (dataMatches.listingsData) {
      console.log(`   ✨ Found inline listings data`);
    }
    
    // Save results
    const fs = require('fs');
    fs.writeFileSync(
      'prd-html-extraction.json',
      JSON.stringify({ pageData, dataMatches }, null, 2)
    );
    
    console.log(`\n✅ Results saved to: prd-html-extraction.json`);
    
    // Final conclusion
    console.log(`\n${'='.repeat(70)}`);
    console.log('🎯 CONCLUSION');
    console.log('='.repeat(70));
    
    if (pageData.hasListOnceImages && !pageData.listOnceConfig && dataMatches.apiUrl === null) {
      console.log(`\n⚠️  PRD uses ListOnce for IMAGE HOSTING only`);
      console.log(`   Properties are rendered SERVER-SIDE in HTML`);
      console.log(`   No client-side API calls detected`);
      console.log(`\n   Implementation Options:`);
      console.log(`   1. HTML Scraping with Playwright (complex, fragile)`);
      console.log(`   2. Contact PRD for API access`);
      console.log(`   3. Skip PRD (already have 98,517+ properties from other sources)`);
      console.log(`\n   ❌ Recommendation: Skip PRD Ballarat`);
      console.log(`      Reason: No accessible API, HTML scraping not worth the maintenance`);
    } else if (dataMatches.clientId) {
      console.log(`\n✅ ListOnce API may be accessible!`);
      console.log(`   client_id: ${dataMatches.clientId[1]}`);
      console.log(`\n   Next steps:`);
      console.log(`   1. Update PRDBallaratScout.ts with client_id`);
      console.log(`   2. Test API: https://api.listonce.com.au/api/v2/properties/search?client_id=${dataMatches.clientId[1]}`);
    }
    
  } finally {
    await browser.close();
  }
}

extractPRDData().catch(console.error);
