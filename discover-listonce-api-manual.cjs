#!/usr/bin/env node

const axios = require('axios');

(async () => {
  console.log('🔍 Testing ListOnce API v2...\n');
  
  // Test base endpoint
  const baseUrl = 'https://api.listonce.com.au/api/v2';
  
  // Common PRD client IDs to try (we need to discover the actual one)
  const testEndpoints = [
    '/properties/search?category=commercial&status=current&limit=10',
    '/properties/search?status=current&limit=5',
  ];
  
  for (const endpoint of testEndpoints) {
    try {
      console.log(`\nTesting: ${baseUrl}${endpoint}`);
      const response = await axios.get(baseUrl + endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      console.log(`✅ Status: ${response.status}`);
      console.log(`Response keys:`, Object.keys(response.data));
      
      if (response.data.data) {
        console.log(`Properties found: ${response.data.data.length}`);
        if (response.data.data[0]) {
          const first = response.data.data[0];
          console.log(`Sample property:`, {
            id: first.id,
            address: first.address,
            category: first.category,
            client_id: first.client_id
          });
        }
      }
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ Status: ${error.response.status}`);
        console.log(`Message: ${error.response.data?.message || 'No message'}`);
      } else {
        console.log(`❌ Error: ${error.message}`);
      }
    }
  }
  
  console.log('\n✅ API discovery complete');
})();
