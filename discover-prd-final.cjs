#!/usr/bin/env node
const { chromium } = require('playwright');

async function discoverPRD() {
  console.log('🔍 Discovering PRD Ballarat ListOnce API with Playwright...\n');
  
  const browser = await chromium.launch({ headless: true });
  
  try {
    const page = await browser.newPage();
    
    const apiCalls = [];
    let clientId = null;
    
    // Intercept all requests
    page.on('request', req => {
      const url = req.url();
      if (url.includes('listonce') || url.includes('/api/')) {
        console.log(`📡 ${req.method()} ${url.substring(0, 120)}${url.length > 120 ? '...' : ''}`);
        
        // Try to extract client_id from URL
        const match = url.match(/[?&]client_id=(\d+)/);
        if (match && !clientId) {
          clientId = match[1];
          console.log(`   ✨ Found client_id: ${clientId}`);
        }
      }
    });
    
    page.on('response', async resp => {
      const url = resp.url();
      if (url.includes('listonce.com.au') && (url.includes('/api/') || url.includes('/v2/'))) {
        console.log(`✅ API Response: ${resp.status()} ${url.substring(0, 100)}...`);
        try {
          const contentType = resp.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            const data = await resp.json();
            apiCalls.push({ url, status: resp.status(), data });
            const keys = Object.keys(data);
            console.log(`   Data keys: ${keys.slice(0, 10).join(', ')}`);
            if (data.client_id) console.log(`   ✨ client_id in response: ${data.client_id}`);
            if (data.results) console.log(`   Results count: ${data.results.length || 'N/A'}`);
          }
        } catch (e) {
          // Not JSON
        }
      }
    });
    
    console.log('🌐 Loading PRD Ballarat property search...');
    await page.goto('https://www.prd.com.au/ballarat/property-search/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    
    console.log('✅ Page loaded successfully\n');
    await page.waitForTimeout(3000);
    
    // Check page content for client_id
    const pageContent = await page.content();
    const contentMatch = pageContent.match(/client_id["\s:=]+(\d+)/i);
    if (contentMatch && !clientId) {
      clientId = contentMatch[1];
      console.log(`✨ Found client_id in page source: ${clientId}\n`);
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 DISCOVERY RESULTS');
    console.log('='.repeat(70));
    
    if (clientId) {
      console.log(`\n🎯 CLIENT_ID DISCOVERED: ${clientId}`);
      console.log(`\nTo activate PRD Ballarat scout:`);
      console.log(`1. Update src/scouts/PRDBallaratScout.ts`);
      console.log(`2. Change: protected readonly clientId = ${clientId};`);
      console.log(`3. Rebuild and test`);
    } else {
      console.log('\n⚠️  No client_id found automatically');
      console.log('   Try manually inspecting Network tab in browser DevTools');
    }
    
    console.log(`\nAPI Calls Found: ${apiCalls.length}`);
    if (apiCalls.length > 0) {
      console.log('\nAPI Endpoints:');
      apiCalls.forEach((call, i) => {
        console.log(`${i + 1}. ${call.url}`);
      });
    }
    
    // Save results
    const fs = require('fs');
    fs.writeFileSync(
      'prd-discovery-final.json',
      JSON.stringify({ clientId, apiCalls, discovered: new Date().toISOString() }, null, 2)
    );
    console.log('\n✅ Full results saved to: prd-discovery-final.json');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

discoverPRD().catch(console.error);
