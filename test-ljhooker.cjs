#!/usr/bin/env node
const https = require('https');

function testUrl(url) {
  return new Promise((resolve, reject) => {
    console.log(`🔍 Testing: ${url}`);
    
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ success: true, status: res.statusCode, data: json });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON', status: res.statusCode });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
    
    req.end();
  });
}

async function main() {
  console.log('🏢 LJ Hooker API Discovery\n');
  
  const testUrls = [
    'https://www.ljhooker.com.au/api/proxy/v1/listings?page=1&pageSize=10',
    'https://ljhooker.com.au/api/proxy/v1/listings?page=1&pageSize=10',
    'https://ljhookerballarat.com.au/api/proxy/v1/listings?page=1&pageSize=10'
  ];
  
  for (const url of testUrls) {
    const result = await testUrl(url);
    
    if (result.success) {
      console.log(`✅ SUCCESS! Status: ${result.status}`);
      console.log(`Properties: ${result.data?.hits || result.data?.data?.length || 'unknown'}`);
      
      if (result.data?.data?.[0]?.value) {
        const prop = result.data.data[0].value;
        console.log(`Sample: ${prop.address?.suburb}, ${prop.address?.state}`);
        console.log(`Provider: ${prop.providerCode}`);
      }
      
      console.log('\n✅ LJ Hooker uses VaultRE proxy API!\n');
      break;
    } else {
      console.log(`❌ Failed: ${result.error}\n`);
    }
  }
}

main();
