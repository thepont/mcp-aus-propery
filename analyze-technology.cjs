#!/usr/bin/env node

const playwright = require('playwright');

async function analyzeSite(url, name) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ANALYZING: ${name}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(60));
  
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  try {
    const page = await context.newPage();
    
    // Capture network requests
    const apiRequests = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/') || url.includes('/wp-json/') || url.includes('/properties') || url.includes('/wpl_api/')) {
        apiRequests.push({
          url,
          method: request.method(),
          resourceType: request.resourceType()
        });
      }
    });
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const html = await page.content();
    
    // WordPress detection
    console.log('\n📦 PLATFORM DETECTION:');
    const isWordPress = html.includes('wp-content') || html.includes('wp-includes') || html.includes('WordPress');
    console.log(`WordPress: ${isWordPress ? '✅ YES' : '❌ NO'}`);
    
    // Australian CRM Systems Detection
    console.log('\n🇦🇺 AUSTRALIAN CRM SYSTEMS:');
    
    const hasVaultRE = html.includes('vaultre.com.au') || html.includes('onesystem.raywhite.com') || 
                       html.includes('nurturecloud.com') || apiRequests.some(r => r.url.includes('vaultre.com.au'));
    console.log(`  VaultRE (Ray White/LJ Hooker): ${hasVaultRE ? '✅ FOUND' : '❌ Not found'}`);
    if (hasVaultRE) {
      console.log(`    → API: https://ap-southeast-2.api.vaultre.com.au/api/v1.3/`);
      console.log(`    → Auth: OAuth2 or API Keys (office-level)`);
    }
    
    const hasRex = html.includes('rexsoftware.com') || apiRequests.some(r => r.url.includes('rexsoftware.com'));
    console.log(`  Rex Software: ${hasRex ? '✅ FOUND' : '❌ Not found'}`);
    if (hasRex) {
      console.log(`    → API: https://api.rexsoftware.com`);
      console.log(`    → Method: POST-based service calls`);
    }
    
    const hasReapit = html.includes('reapit.cloud') || html.includes('agentbox') || 
                      apiRequests.some(r => r.url.includes('reapit.cloud'));
    console.log(`  Reapit/Agentbox (McGrath/Belle): ${hasReapit ? '✅ FOUND' : '❌ Not found'}`);
    if (hasReapit) {
      console.log(`    → API: https://platform.reapit.cloud/`);
      console.log(`    → Method: Webhook-first architecture`);
    }
    
    let hasEPL = false;
    let hasAgentpoint = false;
    let hasPropertyHive = false;
    let hasRealtyna = false;
    
    if (isWordPress) {
      // Check for specific WordPress RE plugins
      console.log('\n🔌 WORDPRESS REAL ESTATE PLUGINS:');
      
      hasEPL = html.includes('easy-property-listings') || html.includes('epl-');
      console.log(`  Easy Property Listings (EPL): ${hasEPL ? '✅ FOUND' : '❌ Not found'}`);
      
      hasAgentpoint = html.includes('agentpoint') || html.includes('propertyhub');
      console.log(`  Agentpoint (PropertyHub): ${hasAgentpoint ? '✅ FOUND' : '❌ Not found'}`);
      
      hasPropertyHive = html.includes('property-hive') || html.includes('propertyhive');
      console.log(`  Property Hive: ${hasPropertyHive ? '✅ FOUND' : '❌ Not found'}`);
      
      hasRealtyna = html.includes('realtyna') || html.includes('wpl-') || html.includes('wpl_');
      console.log(`  Realtyna WPL: ${hasRealtyna ? '✅ FOUND' : '❌ Not found'}`);
      
      // EPL version
      if (hasEPL) {
        const eplVersionMatch = html.match(/easy-property-listings[\/\\]([0-9.]+)/);
        if (eplVersionMatch) {
          console.log(`    → Version: ${eplVersionMatch[1]}`);
        }
      }
    }
    
    // Check meta generator
    const generator = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="generator"]');
      return meta ? meta.content : null;
    });
    if (generator) {
      console.log(`\n  Generator meta: ${generator}`);
    }
    
    // Technology stack
    console.log('\n🛠️  TECHNOLOGY STACK:');
    const scripts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    });
    
    const tech = {
      react: scripts.some(s => s.includes('react')) || html.includes('_reactListening'),
      vue: scripts.some(s => s.includes('vue')) || html.includes('__vue'),
      angular: scripts.some(s => s.includes('angular')) || html.includes('ng-'),
      jquery: scripts.some(s => s.includes('jquery')),
      nextjs: scripts.some(s => s.includes('_next')) || html.includes('__NEXT_DATA__'),
      nuxt: scripts.some(s => s.includes('nuxt')) || html.includes('__NUXT__')
    };
    
    console.log(`  React: ${tech.react ? '✅' : '❌'}`);
    console.log(`  Vue: ${tech.vue ? '✅' : '❌'}`);
    console.log(`  Angular: ${tech.angular ? '✅' : '❌'}`);
    console.log(`  jQuery: ${tech.jquery ? '✅' : '❌'}`);
    console.log(`  Next.js: ${tech.nextjs ? '✅' : '❌'}`);
    console.log(`  Nuxt: ${tech.nuxt ? '✅' : '❌'}`);
    
    // API Detection
    console.log('\n🔍 API ENDPOINTS DETECTED:');
    if (apiRequests.length > 0) {
      const uniqueApis = [...new Set(apiRequests.map(r => r.url))];
      uniqueApis.slice(0, 10).forEach(api => {
        console.log(`  ${api}`);
      });
      if (uniqueApis.length > 10) {
        console.log(`  ... and ${uniqueApis.length - 10} more`);
      }
    } else {
      console.log('  No API requests captured');
    }
    
    // Test known API endpoints
    console.log('\n🧪 TESTING KNOWN API ENDPOINTS:');
    const domain = new URL(url).origin;
    const testEndpoints = [
      '/wp-json/wp/v2/property',
      '/wp-json/wp/v2/commercial',
      '/wp-json/wp/v2/rental',
      '/properties',
      '/properties?summary=1',
      '/wpl_api/v2/listings',
      '/property-api/propertylistings/query'
    ];
    
    for (const endpoint of testEndpoints) {
      try {
        const testUrl = `${domain}${endpoint}`;
        const response = await page.goto(testUrl, { 
          waitUntil: 'networkidle', 
          timeout: 5000 
        });
        if (response && response.status() === 200) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            console.log(`  ✅ ${endpoint} (${response.status()})`);
          }
        }
      } catch (e) {
        // Silent fail
      }
    }
    
    // Recommendation
    console.log('\n💡 RECOMMENDATION:');
    if (hasVaultRE) {
      console.log('  → VaultRE Scout (Ray White/LJ Hooker)');
      console.log('  → Requires: Office invitation for API keys');
      console.log('  → Endpoint: /properties/residential/sale or /lease');
      console.log('  → Docs: docs.api.vaultre.com.au');
    } else if (hasRex) {
      console.log('  → Rex Software Scout');
      console.log('  → Requires: Rex user token');
      console.log('  → Method: POST to service endpoints (e.g., Listing::search)');
      console.log('  → Docs: api-docs.rexsoftware.com');
    } else if (hasReapit) {
      console.log('  → Reapit/Agentbox Scout');
      console.log('  → Requires: Developer Portal registration');
      console.log('  → Method: Webhook-first (push notifications)');
      console.log('  → Docs: foundations-documentation.reapit.cloud');
    } else if (hasEPL) {
      console.log('  → Use WordPressEPLScout base class');
      console.log('  → API: /wp-json/wp/v2/{property|commercial|rental}');
      console.log('  → Auth: Usually public or WP Application Passwords');
    } else if (hasAgentpoint) {
      console.log('  → Use Agentpoint PropertyHub API');
      console.log('  → API: /properties with query operators');
    } else if (hasPropertyHive) {
      console.log('  → Use Property Hive REST API');
      console.log('  → API: /wp-json/wp/v2/property with CRUD support');
    } else if (hasRealtyna) {
      console.log('  → Use Realtyna WPL API v2');
      console.log('  → API: /wpl_api/v2/listings');
    } else if (!isWordPress) {
      console.log('  → Custom platform detected');
      console.log('  → Requires custom scout implementation');
      console.log('  → Check network tab for APIs or use Playwright scraping');
    } else {
      console.log('  → WordPress but no known RE plugin detected');
      console.log('  → May use custom implementation or theme-based');
    }
    
  } catch (error) {
    console.error(`❌ Error analyzing ${name}:`, error.message);
  } finally {
    await browser.close();
  }
}

(async () => {
  await analyzeSite('https://www.prd.com.au/ballarat/', 'PRD Ballarat');
  await analyzeSite('https://www.cbre.com.au/', 'CBRE Australia');
  
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(60) + '\n');
})();
