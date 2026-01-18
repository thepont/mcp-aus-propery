#!/usr/bin/env node
const https = require('https');

function makeRequest(url, followRedirect = true) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*'
      }
    }, (res) => {
      // Handle redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && followRedirect && res.headers.location) {
        console.log(`   Redirect to: ${res.headers.location}`);
        const newUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : `https://${urlObj.hostname}${res.headers.location}`;
        return makeRequest(newUrl, false).then(resolve);
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ 
          success: true, 
          status: res.statusCode, 
          data, 
          contentType: res.headers['content-type'],
          headers: res.headers
        });
      });
    });
    
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.end();
  });
}

async function investigateLJHooker() {
  console.log('🔍 LJ Hooker Technology Investigation\n');
  
  // Test 1: Main site API endpoint
  console.log('1️⃣ Testing LJ Hooker API endpoint...');
  const apiUrl = 'https://www.ljhooker.com.au/api/proxy/v1/listings?page=1&pageSize=10';
  const apiResult = await makeRequest(apiUrl);
  
  console.log(`   Status: ${apiResult.status}`);
  console.log(`   Content-Type: ${apiResult.contentType}`);
  
  if (apiResult.status === 200) {
    try {
      const json = JSON.parse(apiResult.data);
      console.log('   ✅ Valid JSON!');
      console.log(`   Keys: ${Object.keys(json).join(', ')}`);
      if (json.hits) console.log(`   Total properties: ${json.hits}`);
      if (json.data) console.log(`   Properties returned: ${json.data.length}`);
    } catch (e) {
      console.log('   ❌ Not JSON');
      console.log(`   Data preview: ${apiResult.data.substring(0, 300)}`);
    }
  }
  
  // Test 2: Check main page HTML
  console.log('\n2️⃣ Checking main page HTML structure...');
  const pageResult = await makeRequest('https://www.ljhooker.com.au/');
  
  if (pageResult.success) {
    const html = pageResult.data;
    
    console.log('   Technology signatures:');
    const signatures = {
      'VaultRE': /vaultre|vault\.re/i.test(html),
      'React': /__REACT|react-root|data-reactroot/i.test(html),
      'Angular': /ng-app|ng-controller|angular/i.test(html),
      'Vue': /__VUE|v-app|data-v-/i.test(html),
      'WordPress': /wp-content|wordpress/i.test(html),
      'Next.js': /_next|__NEXT/i.test(html),
      'Custom CMS': /ljhooker-cms|custom-platform/i.test(html)
    };
    
    Object.entries(signatures).forEach(([tech, found]) => {
      console.log(`   ${found ? '✅' : '❌'} ${tech}`);
    });
    
    // Look for API endpoints in HTML
    const apiMatches = html.match(/https?:\/\/[^"'\s]+api[^"'\s]*/gi);
    if (apiMatches && apiMatches.length > 0) {
      console.log('\n   API endpoints found in HTML:');
      [...new Set(apiMatches)].slice(0, 5).forEach(url => {
        console.log(`   - ${url}`);
      });
    }
  }
  
  // Test 3: Try alternative endpoints
  console.log('\n3️⃣ Testing alternative API patterns...');
  const alternatives = [
    'https://www.ljhooker.com.au/api/listings',
    'https://www.ljhooker.com.au/api/v1/listings',
    'https://api.ljhooker.com.au/listings',
    'https://www.ljhooker.com.au/wp-json/wp/v2/property'
  ];
  
  for (const url of alternatives) {
    const result = await makeRequest(url);
    console.log(`   ${url}`);
    console.log(`     Status: ${result.status}`);
    if (result.status === 200) {
      try {
        JSON.parse(result.data);
        console.log('     ✅ Returns JSON!');
      } catch (e) {
        console.log(`     Type: ${result.contentType}`);
      }
    }
  }
  
  console.log('\n📋 Conclusion:');
  console.log('   Based on the investigation, LJ Hooker likely uses:');
  console.log('   - A different platform than Ray White VaultRE');
  console.log('   - Possibly a custom CMS or different property management system');
  console.log('   - May require individual office-specific URLs');
}

investigateLJHooker().catch(console.error);
