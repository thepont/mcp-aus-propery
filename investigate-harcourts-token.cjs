#!/usr/bin/env node

/**
 * Harcourts Token Extraction Investigation
 * 
 * This script uses Playwright to:
 * 1. Navigate to Harcourts website
 * 2. Intercept network requests to capture userToken
 * 3. Test if the token can be used to access property data API
 * 4. Determine if tokens are persistent or session-based
 */

const { chromium } = require('playwright');
const fs = require('fs');

async function investigateHarcourtsAPI() {
  console.log('🔍 Starting Harcourts API Token Investigation...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const capturedRequests = [];
  const propertyAPIRequests = [];
  let userToken = null;

  // Intercept all network requests
  page.on('request', request => {
    const url = request.url();
    
    // Look for property data API requests
    if (url.includes('phoenix-propertydata-prod-flex.azurewebsites.net')) {
      console.log(`📡 Property Data API Request: ${url}`);
      propertyAPIRequests.push({
        url: url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      });
      
      // Extract userToken from URL
      const tokenMatch = url.match(/userToken=([^&]+)/);
      if (tokenMatch) {
        userToken = tokenMatch[1];
        console.log(`🔑 Extracted userToken: ${userToken}\n`);
      }
    }
    
    capturedRequests.push({
      url: url,
      method: request.method(),
      resourceType: request.resourceType()
    });
  });

  page.on('response', async response => {
    const url = response.url();
    
    if (url.includes('phoenix-propertydata-prod-flex.azurewebsites.net')) {
      console.log(`📥 Property Data API Response: ${response.status()}`);
      try {
        const responseBody = await response.text();
        console.log(`Response preview: ${responseBody.substring(0, 200)}...\n`);
      } catch (e) {
        console.log(`Could not read response body\n`);
      }
    }
  });

  try {
    console.log('🌐 Navigating to Harcourts homepage...');
    await page.goto('https://www.harcourts.com.au/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('✅ Homepage loaded\n');

    // Wait a bit for any additional async requests
    await page.waitForTimeout(5000);

    // Try to trigger property search
    console.log('🔍 Looking for property search functionality...');
    
    // Check if there's a search button or link
    const searchButton = await page.$('a[href*="buy"], button:has-text("Buy")');
    if (searchButton) {
      console.log('Found search button, clicking...');
      await searchButton.click();
      await page.waitForTimeout(5000);
    }

    // Extract all localStorage and sessionStorage
    const storageData = await page.evaluate(() => {
      return {
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
        cookies: document.cookie
      };
    });

    console.log('\n📦 Browser Storage Data:');
    console.log('localStorage:', Object.keys(storageData.localStorage));
    console.log('sessionStorage:', Object.keys(storageData.sessionStorage));
    console.log('cookies:', storageData.cookies ? 'Present' : 'None');

    // Check for any tokens in storage
    const allStorage = { ...storageData.localStorage, ...storageData.sessionStorage };
    for (const [key, value] of Object.entries(allStorage)) {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth')) {
        console.log(`\n🔑 Found potential token in ${key}:`, value.substring(0, 100));
      }
    }

  } catch (error) {
    console.error('❌ Error during investigation:', error.message);
  }

  await browser.close();

  // Analyze findings
  console.log('\n' + '='.repeat(80));
  console.log('📊 INVESTIGATION RESULTS');
  console.log('='.repeat(80));

  console.log(`\n1. Total Network Requests Captured: ${capturedRequests.length}`);
  console.log(`2. Property API Requests Found: ${propertyAPIRequests.length}`);
  console.log(`3. UserToken Extracted: ${userToken ? 'YES ✅' : 'NO ❌'}`);

  if (userToken) {
    console.log(`\n🔑 EXTRACTED TOKEN:`);
    console.log(`   Token: ${userToken}`);
    console.log(`   Length: ${userToken.length} characters`);
    console.log(`   Format: ${userToken.includes('-') ? 'UUID-like (likely session-based)' : 'Unknown'}`);
    
    // Test if token is persistent across sessions
    console.log(`\n🧪 TOKEN CHARACTERISTICS:`);
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userToken);
    console.log(`   - UUID Format: ${isUUID ? 'YES (likely session-based)' : 'NO'}`);
    console.log(`   - Recommendation: ${isUUID ? 'Generate new token per browser session' : 'Token may be reusable'}`);
  }

  if (propertyAPIRequests.length > 0) {
    console.log(`\n📡 PROPERTY API DETAILS:`);
    propertyAPIRequests.forEach((req, i) => {
      console.log(`\n   Request ${i + 1}:`);
      console.log(`   - URL: ${req.url}`);
      console.log(`   - Method: ${req.method}`);
      console.log(`   - Headers: ${Object.keys(req.headers).length} headers`);
      if (req.postData) {
        console.log(`   - POST Data: ${req.postData.substring(0, 100)}`);
      }
    });
  }

  console.log(`\n💡 IMPLEMENTATION STRATEGY:`);
  if (userToken) {
    console.log(`   ✅ Token extraction via Playwright is VIABLE`);
    console.log(`   ✅ Strategy: Launch browser → Extract token → Make API requests`);
    console.log(`   ✅ Use Playwright's request context to make authenticated API calls`);
    console.log(`   ⚠️  Token appears session-based - generate new token per scout execution`);
  } else {
    console.log(`   ❌ No token found - may require user interaction to trigger API`);
    console.log(`   💡 Try navigating to property search page directly`);
  }

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    userToken: userToken,
    propertyAPIRequests: propertyAPIRequests,
    totalRequests: capturedRequests.length,
    recommendations: {
      viable: !!userToken,
      strategy: userToken ? 'playwright-token-extraction' : 'requires-further-investigation',
      tokenType: userToken && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userToken) 
        ? 'session-based-uuid' 
        : 'unknown'
    }
  };

  fs.writeFileSync(
    'harcourts-token-investigation.json',
    JSON.stringify(results, null, 2)
  );
  console.log(`\n💾 Results saved to: harcourts-token-investigation.json`);

  return results;
}

// Run investigation
investigateHarcourtsAPI()
  .then(() => {
    console.log('\n✅ Investigation complete!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Investigation failed:', error);
    process.exit(1);
  });
