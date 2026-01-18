#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

const BALLARAT_AGENCIES = [
  {
    name: 'Ballarat Real Estate',
    url: 'https://www.ballaratrealestate.com.au',
    searchUrl: 'https://www.ballaratrealestate.com.au/buy',
    expectedTech: 'Agentpoint/Reapit'
  },
  {
    name: 'Buxton Ballarat',
    url: 'https://buxton.com.au',
    searchUrl: 'https://buxton.com.au/vic/ballarat/buy',
    expectedTech: 'Rex Software'
  },
  {
    name: 'Jellis Craig Ballarat',
    url: 'https://www.jelliscraig.com.au',
    searchUrl: 'https://www.jelliscraig.com.au/ballarat/buy',
    expectedTech: 'Custom/Reapit'
  },
  {
    name: 'PRD Ballarat',
    url: 'https://www.prd.com.au/ballarat',
    searchUrl: 'https://www.prd.com.au/ballarat/property-search/',
    expectedTech: 'VaultRE/MRI'
  },
  {
    name: 'Ray White Ballarat',
    url: 'https://www.raywhite.com',
    searchUrl: 'https://www.raywhite.com/buy/in-ballarat,+vic+3350/list-1',
    expectedTech: 'VaultRE (network)'
  },
  {
    name: 'Bartrop Real Estate',
    url: 'https://www.bartrop.com.au',
    searchUrl: 'https://www.bartrop.com.au/buy',
    expectedTech: 'Unknown'
  },
  {
    name: 'Ballarat Property Agents',
    url: 'https://www.ballaratpropertyagents.com.au',
    searchUrl: 'https://www.ballaratpropertyagents.com.au/buy',
    expectedTech: 'Unknown'
  }
];

async function checkSitemaps(agencyUrl) {
  console.log(`  Checking sitemaps...`);
  const sitemaps = [];
  const sitemapUrls = [
    `${agencyUrl}/sitemap.xml`,
    `${agencyUrl}/sitemap_index.xml`,
    `${agencyUrl}/sitemap-properties.xml`,
    `${agencyUrl}/property-sitemap.xml`,
    `${agencyUrl}/listings-sitemap.xml`
  ];
  
  for (const url of sitemapUrls) {
    try {
      const response = await axios.get(url, { timeout: 5000 });
      if (response.status === 200 && response.data.includes('<urlset')) {
        console.log(`    ✅ Found sitemap: ${url}`);
        sitemaps.push({
          url: url,
          content: response.data,
          propertyCount: (response.data.match(/<url>/g) || []).length
        });
      }
    } catch (e) {
      // Sitemap not found, continue
    }
  }
  
  return sitemaps;
}

async function checkRobotsTxt(agencyUrl) {
  console.log(`  Checking robots.txt...`);
  try {
    const response = await axios.get(`${agencyUrl}/robots.txt`, { timeout: 5000 });
    if (response.status === 200) {
      const content = response.data;
      const sitemapRefs = content.match(/Sitemap: (.+)/gi) || [];
      console.log(`    ✅ Found robots.txt with ${sitemapRefs.length} sitemap references`);
      return {
        found: true,
        content: content,
        sitemaps: sitemapRefs.map(s => s.replace('Sitemap: ', '').trim())
      };
    }
  } catch (e) {
    console.log(`    ❌ No robots.txt found`);
  }
  return { found: false };
}

async function deepInvestigateAgency(agency) {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`DEEP INVESTIGATION: ${agency.name}`);
  console.log(`Expected Technology: ${agency.expectedTech}`);
  console.log(`${'='.repeat(100)}`);
  
  const results = {
    agency: agency.name,
    url: agency.url,
    searchUrl: agency.searchUrl,
    expectedTech: agency.expectedTech,
    timestamp: new Date().toISOString(),
    
    // Discovery results
    crm: null,
    apiEndpoints: [],
    offMarketSignals: [],
    authenticationMethod: null,
    
    // Technical fingerprints
    sitemaps: [],
    robotsTxt: null,
    
    // Off-market indicators
    hiddenPropertyPatterns: [],
    statusFields: [],
    portalPublishing: [],
    
    errors: []
  };
  
  // Step 1: Check sitemaps and robots.txt
  try {
    results.sitemaps = await checkSitemaps(agency.url);
    results.robotsTxt = await checkRobotsTxt(agency.url);
  } catch (e) {
    results.errors.push(`Sitemap/robots check failed: ${e.message}`);
  }
  
  // Step 2: Launch browser and intercept network
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  const apiCalls = [];
  const propertyData = [];
  
  // Intercept ALL network requests
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    const headers = request.headers();
    
    // Look for property-related API calls
    if (url.includes('/api/') || 
        url.includes('/wp-json/') ||
        url.includes('listing') ||
        url.includes('propert') ||
        url.includes('search') ||
        request.resourceType() === 'xhr' ||
        request.resourceType() === 'fetch') {
      
      apiCalls.push({
        url: url,
        method: method,
        headers: headers,
        postData: request.postData(),
        resourceType: request.resourceType()
      });
    }
  });
  
  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    
    // Capture JSON responses that might contain property data
    if (contentType.includes('application/json') && 
        (url.includes('listing') || url.includes('propert') || url.includes('search'))) {
      try {
        const json = await response.json();
        propertyData.push({
          url: url,
          data: json,
          status: response.status()
        });
      } catch (e) {
        // Not valid JSON or access denied
      }
    }
  });
  
  try {
    console.log(`\n  Navigating to: ${agency.searchUrl}`);
    await page.goto(agency.searchUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Step 3: Detect CRM/Tech Stack
    console.log(`\n  Detecting CRM/Tech Stack...`);
    const techDetection = await page.evaluate(() => {
      const detection = {
        crm: null,
        signals: []
      };
      
      // Check for Agentpoint/Reapit
      if (window.AgentpointSettings || window.PropertyHubConfig) {
        detection.crm = 'Agentpoint/Reapit';
        detection.signals.push('Window config object found');
        if (window.AgentpointSettings) {
          detection.agentpointConfig = window.AgentpointSettings;
        }
      }
      
      // Check for Rex Software
      if (window.RexConfig || window.RexAPI || document.querySelector('[data-rex]')) {
        detection.crm = 'Rex Software';
        detection.signals.push('Rex indicators found');
      }
      
      // Check for VaultRE
      if (window.VaultREConfig || window.OneSystemConfig) {
        detection.crm = 'VaultRE';
        detection.signals.push('VaultRE config found');
      }
      
      // Check for domain patterns in scripts
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      for (const script of scripts) {
        const src = script.src;
        if (src.includes('agentpoint') || src.includes('propertyhub')) {
          detection.crm = detection.crm || 'Agentpoint';
          detection.signals.push(`Script: ${src}`);
        }
        if (src.includes('rexsoftware')) {
          detection.crm = detection.crm || 'Rex Software';
          detection.signals.push(`Script: ${src}`);
        }
        if (src.includes('vaultre') || src.includes('onesystem')) {
          detection.crm = detection.crm || 'VaultRE';
          detection.signals.push(`Script: ${src}`);
        }
      }
      
      return detection;
    });
    
    results.crm = techDetection.crm;
    results.crmSignals = techDetection.signals;
    
    if (techDetection.agentpointConfig) {
      results.agentpointConfig = techDetection.agentpointConfig;
    }
    
    console.log(`    CRM Detected: ${results.crm || 'Unknown'}`);
    
    // Step 4: Wait for potential AJAX calls
    await page.waitForTimeout(5000);
    
    // Step 5: Try to scroll down to trigger lazy loading
    console.log(`\n  Scrolling to trigger lazy loading...`);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(2000);
    
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(2000);
    
  } catch (error) {
    console.error(`  ❌ Error during investigation: ${error.message}`);
    results.errors.push(error.message);
  } finally {
    await browser.close();
  }
  
  // Step 6: Analyze collected data
  console.log(`\n  Analyzing collected data...`);
  console.log(`    API calls captured: ${apiCalls.length}`);
  console.log(`    Property responses: ${propertyData.length}`);
  
  // Categorize API endpoints
  const categorizedApis = {
    agentpoint: [],
    rex: [],
    vaultre: [],
    wordpress: [],
    other: []
  };
  
  for (const call of apiCalls) {
    const url = call.url.toLowerCase();
    
    if (url.includes('agentpoint') || url.includes('propertyhub')) {
      categorizedApis.agentpoint.push(call);
    } else if (url.includes('rex')) {
      categorizedApis.rex.push(call);
    } else if (url.includes('vaultre') || url.includes('onesystem')) {
      categorizedApis.vaultre.push(call);
    } else if (url.includes('wp-json')) {
      categorizedApis.wordpress.push(call);
    } else if (url.includes('listing') || url.includes('propert') || url.includes('search')) {
      categorizedApis.other.push(call);
    }
  }
  
  results.categorizedApis = categorizedApis;
  
  // Analyze property data for off-market indicators
  console.log(`\n  Searching for off-market indicators...`);
  
  for (const response of propertyData) {
    try {
      const data = response.data;
      
      // Recursively search for off-market indicators
      const indicators = findOffMarketIndicators(data);
      if (indicators.length > 0) {
        results.offMarketSignals.push({
          url: response.url,
          indicators: indicators
        });
      }
      
      // Look for status fields
      const statusFields = findStatusFields(data);
      if (statusFields.length > 0) {
        results.statusFields.push(...statusFields);
      }
      
      // Look for portal publishing info
      const portalInfo = findPortalPublishing(data);
      if (portalInfo.length > 0) {
        results.portalPublishing.push(...portalInfo);
      }
      
    } catch (e) {
      // Skip invalid data
    }
  }
  
  // Generate recommendations
  console.log(`\n  Generating recommendations...`);
  results.recommendations = generateRecommendations(results);
  
  console.log(`\n  ✅ Investigation complete for ${agency.name}`);
  
  return results;
}

function findOffMarketIndicators(obj, path = '') {
  const indicators = [];
  
  if (typeof obj !== 'object' || obj === null) return indicators;
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    
    // Check for off-market related keys
    if (lowerKey.includes('off') && lowerKey.includes('market') ||
        lowerKey.includes('quiet') ||
        lowerKey.includes('unlisted') ||
        lowerKey.includes('pre') && lowerKey.includes('market') ||
        lowerKey === 'is_private' ||
        lowerKey === 'visibility' ||
        lowerKey === 'portal_push' ||
        lowerKey === 'web_status') {
      
      indicators.push({
        field: currentPath,
        value: value,
        type: 'off_market_flag'
      });
    }
    
    // Recursively search nested objects
    if (typeof value === 'object') {
      indicators.push(...findOffMarketIndicators(value, currentPath));
    }
  }
  
  return indicators;
}

function findStatusFields(obj, path = '') {
  const statusFields = [];
  
  if (typeof obj !== 'object' || obj === null) return statusFields;
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    
    if (lowerKey === 'status' || lowerKey === 'state' || lowerKey === 'listing_status') {
      statusFields.push({
        field: currentPath,
        value: value,
        type: 'status_field'
      });
    }
    
    if (typeof value === 'object') {
      statusFields.push(...findStatusFields(value, currentPath));
    }
  }
  
  return statusFields;
}

function findPortalPublishing(obj, path = '') {
  const portalInfo = [];
  
  if (typeof obj !== 'object' || obj === null) return portalInfo;
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    
    if (lowerKey.includes('portal') || 
        lowerKey.includes('publish') ||
        lowerKey === 'rea' ||
        lowerKey === 'domain' ||
        lowerKey === 'syndication') {
      
      portalInfo.push({
        field: currentPath,
        value: value,
        type: 'portal_publishing'
      });
    }
    
    if (typeof value === 'object') {
      portalInfo.push(...findPortalPublishing(value, currentPath));
    }
  }
  
  return portalInfo;
}

function generateRecommendations(results) {
  const recommendations = [];
  
  if (results.crm === 'Agentpoint/Reapit') {
    recommendations.push({
      priority: 'HIGH',
      action: 'Check API endpoint',
      details: 'Look for https://api.agentpoint.com.au/v1/properties with status="current" field'
    });
  }
  
  if (results.crm === 'Rex Software') {
    recommendations.push({
      priority: 'HIGH',
      action: 'Check GraphQL/REST endpoint',
      details: 'Look for published_to_portals array - missing REA indicates off-market'
    });
  }
  
  if (results.crm === 'VaultRE') {
    recommendations.push({
      priority: 'HIGH',
      action: 'Check VaultRE API',
      details: 'Look for web_status field indicating off-market properties'
    });
  }
  
  if (results.sitemaps.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Compare sitemap vs search results',
      details: `Found ${results.sitemaps.length} sitemaps - compare URLs to find unlisted properties`
    });
  }
  
  if (results.offMarketSignals.length > 0) {
    recommendations.push({
      priority: 'CRITICAL',
      action: 'Off-market signals detected',
      details: `Found ${results.offMarketSignals.length} potential off-market indicators in API responses`
    });
  }
  
  return recommendations;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  BALLARAT REAL ESTATE DEEP INVESTIGATION                                             ║');
  console.log('║  Senior Web Security Researcher & PropTech Engineer                                  ║');
  console.log('║  Target: Off-Market & Unlisted Property Discovery                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  
  const allResults = [];
  
  for (const agency of BALLARAT_AGENCIES) {
    try {
      const result = await deepInvestigateAgency(agency);
      allResults.push(result);
      
      // Delay between agencies
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(`\n❌ Failed to investigate ${agency.name}:`, error.message);
      allResults.push({
        agency: agency.name,
        url: agency.url,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // Save detailed results
  const outputFile = 'ballarat-deep-investigation.json';
  fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));
  
  // Generate summary report
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  INVESTIGATION SUMMARY                                                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  
  console.log('\n┌─ AGENCY OVERVIEW ─────────────────────────────────────────────────────────────────┐\n');
  
  for (const result of allResults) {
    if (result.error) {
      console.log(`❌ ${result.agency}: ERROR - ${result.error}\n`);
      continue;
    }
    
    console.log(`📍 ${result.agency}`);
    console.log(`   CRM/Tech: ${result.crm || 'Unknown'}`);
    console.log(`   API Endpoints Found: ${Object.values(result.categorizedApis || {}).flat().length}`);
    
    if (result.categorizedApis) {
      if (result.categorizedApis.agentpoint.length > 0) {
        console.log(`   - Agentpoint APIs: ${result.categorizedApis.agentpoint.length}`);
      }
      if (result.categorizedApis.rex.length > 0) {
        console.log(`   - Rex Software APIs: ${result.categorizedApis.rex.length}`);
      }
      if (result.categorizedApis.vaultre.length > 0) {
        console.log(`   - VaultRE APIs: ${result.categorizedApis.vaultre.length}`);
      }
    }
    
    console.log(`   Sitemaps: ${result.sitemaps.length}`);
    console.log(`   Off-Market Signals: ${result.offMarketSignals.length}`);
    console.log(`   Status Fields: ${result.statusFields.length}`);
    console.log(`   Portal Publishing Info: ${result.portalPublishing.length}`);
    
    if (result.recommendations && result.recommendations.length > 0) {
      console.log(`\n   🔍 RECOMMENDATIONS:`);
      for (const rec of result.recommendations) {
        console.log(`      [${rec.priority}] ${rec.action}`);
        console.log(`      → ${rec.details}`);
      }
    }
    
    console.log('');
  }
  
  console.log('└───────────────────────────────────────────────────────────────────────────────────┘');
  console.log(`\n✅ Full investigation results saved to: ${outputFile}`);
  console.log(`📊 Total agencies investigated: ${allResults.length}`);
  console.log(`🔍 Agencies with off-market signals: ${allResults.filter(r => r.offMarketSignals && r.offMarketSignals.length > 0).length}`);
}

main().catch(console.error);
