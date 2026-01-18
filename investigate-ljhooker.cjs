#!/usr/bin/env node
const https = require('https');
const { chromium } = require('playwright');

function makeRequest(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/html'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ success: true, status: res.statusCode, data, contentType: res.headers['content-type'] });
      });
    });
    
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.end();
  });
}

async function investigateLJHooker() {
  console.log('🔍 LJ Hooker Technology Investigation\n');
  
  // Test main site API
  console.log('1️⃣ Testing main LJ Hooker site API...');
  const apiResult = await makeRequest('https://www.ljhooker.com.au/api/proxy/v1/listings?page=1&pageSize=10');
  console.log(`   Status: ${apiResult.status}`);
  console.log(`   Content-Type: ${apiResult.contentType}`);
  console.log(`   Data length: ${apiResult.data?.length || 0} bytes`);
  
  if (apiResult.status === 200) {
    try {
      const json = JSON.parse(apiResult.data);
      console.log('   ✅ Valid JSON returned');
      console.log(`   Properties: ${json.hits || json.data?.length || 'unknown'}`);
    } catch (e) {
      console.log('   ❌ Not valid JSON');
      console.log(`   Preview: ${apiResult.data.substring(0, 200)}`);
    }
  }
  
  console.log('\n2️⃣ Using Playwright to analyze LJ Hooker website...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Track network requests
  const apis = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('json') || url.includes('listings')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const json = await response.json();
          apis.push({
            url,
            status: response.status(),
            method: response.request().method(),
            preview: JSON.stringify(json).substring(0, 200)
          });
        }
      } catch (e) {
        // Not JSON or failed to parse
      }
    }
  });
  
  console.log('   Navigating to LJ Hooker property search...');
  try {
    await page.goto('https://www.ljhooker.com.au/search/buy/residential', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('   ✅ Page loaded successfully');
    
    // Check for technology signatures
    const pageContent = await page.content();
    
    console.log('\n3️⃣ Technology Detection:');
    const technologies = {
      'VaultRE': pageContent.includes('vaultre') || pageContent.includes('vault'),
      'React': pageContent.includes('react'),
      'Angular': pageContent.includes('ng-') || pageContent.includes('angular'),
      'Vue': pageContent.includes('vue'),
      'WordPress': pageContent.includes('wp-content') || pageContent.includes('wordpress'),
      'Next.js': pageContent.includes('_next'),
      'Nuxt': pageContent.includes('_nuxt')
    };
    
    Object.entries(technologies).forEach(([tech, detected]) => {
      console.log(`   ${detected ? '✅' : '❌'} ${tech}`);
    });
    
    // Check for specific elements
    console.log('\n4️⃣ Page Structure:');
    const propertyCards = await page.$$('.property-card, .listing-card, [data-testid*="property"], article');
    console.log(`   Property cards found: ${propertyCards.length}`);
    
    // Check meta tags
    const generator = await page.$eval('meta[name="generator"]', el => el.content).catch(() => null);
    if (generator) {
      console.log(`   CMS: ${generator}`);
    }
    
    console.log('\n5️⃣ API Calls Detected:');
    if (apis.length > 0) {
      apis.forEach(api => {
        console.log(`   ${api.method} ${api.url}`);
        console.log(`      Status: ${api.status}`);
        console.log(`      Preview: ${api.preview}...`);
      });
    } else {
      console.log('   ⚠️  No JSON API calls detected');
      console.log('   This suggests server-side rendering or different data loading approach');
    }
    
  } catch (error) {
    console.log(`   ❌ Failed to load page: ${error.message}`);
  }
  
  await browser.close();
  
  console.log('\n📋 Summary:');
  console.log('   LJ Hooker appears to use a different system than Ray White.');
  console.log('   Recommendation: Check individual office sites or use different approach.');
}

investigateLJHooker().catch(console.error);
