#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');

async function deepDivePRD() {
  console.log('🔬 DEEP DIVE: PRD Ballarat Commercial Properties');
  console.log('=' .repeat(70));
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const apiCalls = [];
  
  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        apiCalls.push({ url, data });
        console.log(`📦 JSON: ${url}`);
        console.log(`   Keys: ${Object.keys(data).slice(0, 10).join(', ')}`);
      } catch {}
    }
  });
  
  try {
    console.log('\n📍 Step 1: Load buy page...');
    await page.goto('https://www.prd.com.au/ballarat/buy/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for dynamic content
    await page.waitForTimeout(3000);
    
    // Save HTML
    const html = await page.content();
    fs.writeFileSync('/tmp/prd-page.html', html);
    console.log('✓ HTML saved');
    
    // Look for property listings
    const analysis = await page.evaluate(() => {
      const results = {
        listingElements: [],
        possibleContainers: [],
        links: []
      };
      
      // Find all links
      document.querySelectorAll('a').forEach(link => {
        const href = link.href;
        const text = link.textContent?.trim();
        if (href && (href.includes('property') || href.includes('listing') || href.includes('buy'))) {
          results.links.push({ href, text: text?.substring(0, 50) });
        }
      });
      
      // Find containers with multiple children
      document.querySelectorAll('div, section, article').forEach(el => {
        if (el.children.length > 3 && el.children.length < 50) {
          const classes = el.className?.toString() || '';
          if (classes) {
            results.possibleContainers.push({
              tag: el.tagName,
              classes,
              childCount: el.children.length
            });
          }
        }
      });
      
      return results;
    });
    
    console.log(`\n🔗 Property-related links (${analysis.links.length}):`);
    analysis.links.slice(0, 5).forEach(link => {
      console.log(`   - ${link.text || '(no text)'}`);
      console.log(`     ${link.href}`);
    });
    
    console.log(`\n📦 Possible listing containers (${analysis.possibleContainers.length}):`);
    const uniqueContainers = {};
    analysis.possibleContainers.forEach(c => {
      const key = c.classes.split(' ').slice(0, 2).join(' ');
      if (!uniqueContainers[key]) uniqueContainers[key] = c;
    });
    Object.values(uniqueContainers).slice(0, 10).forEach((c) => {
      console.log(`   - ${c.tag}.${c.classes.split(' ')[0]} (${c.childCount} children)`);
    });
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
  
  console.log('\n' + '='.repeat(70));
  console.log(`📊 Found ${apiCalls.length} JSON API calls`);
  
  if (apiCalls.length > 0) {
    console.log('\n✅ APIs FOUND:');
    apiCalls.forEach(call => {
      console.log(`   ${call.url}`);
    });
    fs.writeFileSync('/tmp/prd-api-calls.json', JSON.stringify(apiCalls, null, 2));
    console.log('\n💾 Saved to /tmp/prd-api-calls.json');
  } else {
    console.log('\n❌ No JSON APIs found');
    console.log('   PRD likely uses server-side rendering');
    console.log('   OR properties are on a different page');
  }
}

deepDivePRD().catch(console.error);
