#!/usr/bin/env node
const https = require('https');

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
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ success: true, data: json });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON' });
        }
      });
    });
    
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.end();
  });
}

async function analyzeAllProperties() {
  console.log('🔍 Analyzing Ray White property types (fetching 500 properties)\n');
  
  const url = 'https://raywhiteballarat.com.au/api/proxy/v1/listings?page=1&pageSize=500';
  const result = await makeRequest(url);
  
  if (!result.success) {
    console.log('❌ Failed to fetch:', result.error);
    return;
  }
  
  const data = result.data;
  console.log(`Total properties in database: ${data.hits}`);
  console.log(`Properties fetched: ${data.data.length}\n`);
  
  const stats = {
    typeCode: {},
    category: {},
    subCategory: {},
    statusCode: {}
  };
  
  data.data.forEach(item => {
    const v = item.value;
    stats.typeCode[v.typeCode] = (stats.typeCode[v.typeCode] || 0) + 1;
    stats.category[v.category || 'none'] = (stats.category[v.category || 'none'] || 0) + 1;
    stats.subCategory[v.subCategory || 'none'] = (stats.subCategory[v.subCategory || 'none'] || 0) + 1;
    stats.statusCode[v.statusCode] = (stats.statusCode[v.statusCode] || 0) + 1;
  });
  
  console.log('📊 Type Code Distribution:');
  Object.entries(stats.typeCode).sort((a,b) => b[1]-a[1]).forEach(([key, count]) => {
    console.log(`  ${key}: ${count} (${(count/data.data.length*100).toFixed(1)}%)`);
  });
  
  console.log('\n📊 Category Distribution:');
  Object.entries(stats.category).sort((a,b) => b[1]-a[1]).forEach(([key, count]) => {
    console.log(`  ${key}: ${count}`);
  });
  
  console.log('\n📊 Sub-Category Distribution:');
  Object.entries(stats.subCategory).sort((a,b) => b[1]-a[1]).slice(0, 20).forEach(([key, count]) => {
    console.log(`  ${key}: ${count}`);
  });
  
  const commercial = data.data.filter(item => {
    const v = item.value;
    const sub = (v.subCategory || '').toLowerCase();
    return v.category === 'commercial' || 
           sub.includes('commercial') ||
           sub.includes('industrial') ||
           sub.includes('office') ||
           sub.includes('warehouse');
  });
  
  console.log(`\n🏢 Commercial/Industrial properties found: ${commercial.length}`);
  
  if (commercial.length > 0) {
    console.log('\nSample commercial properties:');
    commercial.slice(0, 5).forEach(item => {
      const v = item.value;
      console.log(`  - ${v.title}`);
      console.log(`    Type: ${v.typeCode}, Cat: ${v.category}, SubCat: ${v.subCategory}`);
      console.log(`    Location: ${v.address?.suburb}, ${v.address?.state}`);
    });
  }
}

analyzeAllProperties().catch(console.error);
