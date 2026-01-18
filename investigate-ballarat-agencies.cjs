#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');

const BALLARAT_AGENCIES = [
  {
    name: 'Ballarat Real Estate',
    url: 'https://www.ballaratrealestate.com.au',
    searchUrl: 'https://www.ballaratrealestate.com.au/buy'
  },
  {
    name: 'Buxton Ballarat',
    url: 'https://buxton.com.au',
    searchUrl: 'https://buxton.com.au/vic/ballarat/buy'
  },
  {
    name: 'McGrath Ballarat',
    url: 'https://www.mcgrath.com.au',
    searchUrl: 'https://www.mcgrath.com.au/buy/vic/ballarat'
  },
  {
    name: 'PRD Ballarat',
    url: 'https://www.prd.com.au/ballarat',
    searchUrl: 'https://www.prd.com.au/ballarat/property-search/'
  },
  {
    name: 'Fletchers Ballarat',
    url: 'https://www.fletchersballarat.com.au',
    searchUrl: 'https://www.fletchersballarat.com.au/buy'
  },
  {
    name: 'Ray White Ballarat',
    url: 'https://www.raywhite.com',
    searchUrl: 'https://www.raywhite.com/buy/in-ballarat,+vic+3350/list-1'
  }
];

async function investigateAgency(agency) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Investigating: ${agency.name}`);
  console.log(`${'='.repeat(80)}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  const results = {
    agency: agency.name,
    url: agency.url,
    searchUrl: agency.searchUrl,
    timestamp: new Date().toISOString(),
    apis: [],
    technology: {
      wordpress: false,
      cms: null,
      frameworks: []
    },
    authentication: {
      found: false,
      type: null,
      location: null
    },
    errors: []
  };
  
  const apiCalls = [];
  const tokens = new Set();
  
  // Intercept network requests
  page.on('request', request => {
    const url = request.url();
    const headers = request.headers();
    
    // Look for API calls
    if (url.includes('/api/') || 
        url.includes('/wp-json/') ||
        url.includes('.json') ||
        url.includes('graphql') ||
        request.resourceType() === 'xhr' ||
        request.resourceType() === 'fetch') {
      
      apiCalls.push({
        url: url,
        method: request.method(),
        headers: headers,
        resourceType: request.resourceType()
      });
      
      // Look for authentication tokens
      if (headers['authorization']) {
        tokens.add(`Authorization: ${headers['authorization']}`);
      }
      if (headers['x-api-key']) {
        tokens.add(`X-API-Key: ${headers['x-api-key']}`);
      }
      if (headers['x-auth-token']) {
        tokens.add(`X-Auth-Token: ${headers['x-auth-token']}`);
      }
    }
  });
  
  try {
    console.log(`Navigating to: ${agency.searchUrl}`);
    await page.goto(agency.searchUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Check for WordPress
    const isWordPress = await page.evaluate(() => {
      return !!(
        document.querySelector('meta[name="generator"][content*="WordPress"]') ||
        document.querySelector('link[href*="wp-content"]') ||
        document.querySelector('script[src*="wp-includes"]')
      );
    });
    results.technology.wordpress = isWordPress;
    
    // Check for various CMS/frameworks
    const techStack = await page.evaluate(() => {
      const detections = {
        react: !!(window.React || document.querySelector('[data-reactroot]') || document.querySelector('[data-reactid]')),
        vue: !!(window.Vue || document.querySelector('[data-v-]')),
        angular: !!(window.angular || document.querySelector('[ng-app]') || document.querySelector('[ng-controller]')),
        django: !!document.querySelector('input[name="csrfmiddlewaretoken"]'),
        nextjs: !!document.querySelector('#__next'),
        nuxt: !!document.querySelector('#__nuxt')
      };
      
      // Check for config objects
      const configs = {
        agentpoint: !!(window.AgentpointSettings || window.PropertyHubConfig),
        vaultre: !!(window.VaultREConfig || window.OneSystemConfig),
        rex: !!(window.RexConfig || window.RexAPI)
      };
      
      return { detections, configs };
    });
    
    if (techStack.detections.react) results.technology.frameworks.push('React');
    if (techStack.detections.vue) results.technology.frameworks.push('Vue');
    if (techStack.detections.angular) results.technology.frameworks.push('Angular');
    if (techStack.detections.django) results.technology.cms = 'Django';
    if (techStack.detections.nextjs) results.technology.frameworks.push('Next.js');
    if (techStack.detections.nuxt) results.technology.frameworks.push('Nuxt');
    
    // Wait a bit for any AJAX calls to complete
    await page.waitForTimeout(3000);
    
    // Try to trigger property search if possible
    try {
      const searchButton = await page.$('button[type="submit"], input[type="submit"], .search-button, .btn-search');
      if (searchButton) {
        console.log('Triggering search...');
        await searchButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('Could not trigger search:', e.message);
    }
    
    // Process collected API calls
    const uniqueApis = {};
    for (const call of apiCalls) {
      const urlObj = new URL(call.url);
      const basePath = urlObj.origin + urlObj.pathname;
      
      if (!uniqueApis[basePath]) {
        uniqueApis[basePath] = {
          url: basePath,
          method: call.method,
          queryParams: urlObj.search,
          headers: call.headers,
          type: call.resourceType,
          category: categorizeApi(call.url)
        };
      }
    }
    
    results.apis = Object.values(uniqueApis);
    
    // Check for authentication
    if (tokens.size > 0) {
      results.authentication.found = true;
      results.authentication.tokens = Array.from(tokens);
    }
    
    // Try to extract config objects
    const configObjects = await page.evaluate(() => {
      const configs = {};
      if (window.AgentpointSettings) configs.agentpoint = window.AgentpointSettings;
      if (window.PropertyHubConfig) configs.propertyHub = window.PropertyHubConfig;
      if (window.VaultREConfig) configs.vaultre = window.VaultREConfig;
      if (window.RexConfig) configs.rex = window.RexConfig;
      return configs;
    });
    
    if (Object.keys(configObjects).length > 0) {
      results.configObjects = configObjects;
      results.authentication.found = true;
      results.authentication.type = 'Frontend config object';
      results.authentication.location = Object.keys(configObjects).join(', ');
    }
    
    console.log(`✅ Found ${results.apis.length} API endpoints`);
    console.log(`✅ Technology: ${results.technology.frameworks.join(', ') || 'Custom'}`);
    console.log(`✅ Authentication: ${results.authentication.found ? 'Found' : 'None detected'}`);
    
  } catch (error) {
    console.error(`❌ Error investigating ${agency.name}:`, error.message);
    results.errors.push(error.message);
  } finally {
    await browser.close();
  }
  
  return results;
}

function categorizeApi(url) {
  const lower = url.toLowerCase();
  if (lower.includes('listing') || lower.includes('property') || lower.includes('properties')) {
    return 'property_data';
  }
  if (lower.includes('agent') || lower.includes('staff')) {
    return 'agent_data';
  }
  if (lower.includes('search')) {
    return 'search';
  }
  if (lower.includes('map') || lower.includes('geo')) {
    return 'geospatial';
  }
  if (lower.includes('wp-json')) {
    return 'wordpress_api';
  }
  if (lower.includes('graphql')) {
    return 'graphql';
  }
  return 'other';
}

async function main() {
  console.log('Ballarat Agency API Investigation');
  console.log('==================================\n');
  
  const allResults = [];
  
  for (const agency of BALLARAT_AGENCIES) {
    try {
      const result = await investigateAgency(agency);
      allResults.push(result);
      
      // Small delay between agencies
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Failed to investigate ${agency.name}:`, error);
      allResults.push({
        agency: agency.name,
        url: agency.url,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // Save results
  const outputFile = 'ballarat-agencies-investigation.json';
  fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Investigation complete! Results saved to: ${outputFile}`);
  console.log(`${'='.repeat(80)}`);
  
  // Print summary
  console.log('\n\nSUMMARY:');
  console.log('========\n');
  
  for (const result of allResults) {
    if (result.error) {
      console.log(`❌ ${result.agency}: ERROR - ${result.error}`);
      continue;
    }
    
    console.log(`\n${result.agency}:`);
    console.log(`  APIs found: ${result.apis.length}`);
    console.log(`  Technology: ${result.technology.frameworks.join(', ') || result.technology.cms || 'Custom'}`);
    console.log(`  WordPress: ${result.technology.wordpress ? 'Yes' : 'No'}`);
    console.log(`  Authentication: ${result.authentication.found ? 'Required' : 'Public'}`);
    
    if (result.apis.length > 0) {
      console.log(`  Key APIs:`);
      const propertyApis = result.apis.filter(api => api.category === 'property_data' || api.category === 'search');
      propertyApis.slice(0, 3).forEach(api => {
        console.log(`    - ${api.method} ${api.url}`);
      });
    }
  }
}

main().catch(console.error);
