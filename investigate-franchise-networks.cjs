#!/usr/bin/env node

/**
 * PropTech Franchise Network Reconnaissance
 * 
 * Analyzes Australian real estate franchise websites to identify:
 * - Core tech stack (Headless CMS vs SSR)
 * - API endpoints (REST/GraphQL)
 * - Off-market detection signals in JSON
 * - Sitemap vs UI property count discrepancies
 * - Dark page patterns
 */

const { chromium } = require('playwright');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');

const FRANCHISE_NETWORKS = [
  {
    name: 'Ray White',
    domain: 'raywhite.com',
    searchUrl: 'https://raywhite.com/buy/',
    expectedStack: 'NurtureCloud / OneSystem',
    notes: 'Already partially analyzed - VaultRE proxy API discovered'
  },
  {
    name: 'LJ Hooker',
    domain: 'ljhooker.com.au',
    searchUrl: 'https://www.ljhooker.com.au/buy',
    expectedStack: 'Proprietary / Adobe Experience Manager',
    notes: 'Already analyzed - Agentpoint PropertyHub API discovered'
  },
  {
    name: 'McGrath',
    domain: 'mcgrath.com.au',
    searchUrl: 'https://www.mcgrath.com.au/buy',
    expectedStack: 'Custom React/AEM Headless',
    notes: 'High-end agency with custom tech'
  },
  {
    name: 'Harcourts',
    domain: 'harcourts.com.au',
    searchUrl: 'https://www.harcourts.com.au/Property',
    expectedStack: 'Harcourts One / Pulse',
    notes: 'International franchise with proprietary systems'
  },
  {
    name: 'Raine & Horne',
    domain: 'rh.com.au',
    searchUrl: 'https://www.rh.com.au/buy',
    expectedStack: 'Compass CRM integrations',
    notes: 'Traditional agency with potential modern stack'
  },
  {
    name: 'Belle Property',
    domain: 'belleproperty.com',
    searchUrl: 'https://www.belleproperty.com/buy',
    expectedStack: 'VaultRE / Luxury-tier custom frontend',
    notes: 'Luxury brand - likely high-quality tech'
  }
];

const OFF_MARKET_SIGNAL_PATTERNS = [
  'is_pre_market',
  'is_off_market',
  'is_quiet',
  'is_private',
  'is_internal',
  'visibility',
  'visibility_tier',
  'portal_status',
  'published_to_external',
  'published_to_portals',
  'portal_push',
  'web_status',
  'listing_status',
  'status',
  'availability',
  'marketing_status'
];

async function investigateNetwork(network) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Investigating: ${network.name} (${network.domain})`);
  console.log(`${'='.repeat(80)}`);

  const results = {
    name: network.name,
    domain: network.domain,
    techStack: {
      detected: null,
      framework: null,
      renderingMethod: null
    },
    apis: {
      endpoints: [],
      patterns: []
    },
    offMarketSignals: [],
    sitemap: {
      totalUrls: 0,
      propertyUrls: 0,
      sitemapUrl: null
    },
    darkPages: {
      detected: false,
      examples: []
    }
  };

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    // Track network requests
    const apiCalls = [];
    context.on('request', request => {
      const url = request.url();
      const method = request.method();
      const resourceType = request.resourceType();
      
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        apiCalls.push({
          url,
          method,
          resourceType,
          postData: request.postData()
        });
      }
    });

    const responses = [];
    context.on('response', async response => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (contentType.includes('json') || url.includes('/api/') || url.includes('/graphql')) {
        try {
          const body = await response.text();
          responses.push({
            url,
            status: response.status(),
            contentType,
            body: body.substring(0, 5000) // First 5000 chars
          });
        } catch (e) {
          // Ignore errors reading response body
        }
      }
    });

    const page = await context.newPage();

    // Step 1: Analyze homepage for tech stack
    console.log(`\n[1/5] Analyzing homepage tech stack...`);
    await page.goto(`https://www.${network.domain}`, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    const techStack = await page.evaluate(() => {
      const frameworks = {
        react: !!window.React || !!document.querySelector('[data-reactroot], [data-reactid]'),
        vue: !!window.Vue || !!document.querySelector('[data-v-]'),
        angular: !!window.angular || !!document.querySelector('[ng-app], [data-ng-app]'),
        nextjs: !!window.__NEXT_DATA__,
        nuxt: !!window.__NUXT__,
        gatsby: !!window.___gatsby
      };

      const cms = {
        wordpress: !!document.querySelector('link[href*="wp-content"]') || !!document.querySelector('meta[name="generator"][content*="WordPress"]'),
        aem: !!document.querySelector('[data-cmp-is], [class*="cmp-"]') || !!window.digitalData,
        drupal: !!window.Drupal,
        contentful: !!document.querySelector('[data-contentful]')
      };

      const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
      
      return {
        frameworks,
        cms,
        scripts: scripts.slice(0, 10) // First 10 scripts
      };
    });

    results.techStack.detected = techStack;

    // Step 2: Navigate to search page and capture API calls
    console.log(`\n[2/5] Navigating to search page and capturing API calls...`);
    
    // Clear previous API calls
    apiCalls.length = 0;
    responses.length = 0;

    await page.goto(network.searchUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Wait for API calls to complete
    await page.waitForTimeout(5000);

    // Try interacting with map or filters to trigger more API calls
    try {
      // Look for map view button
      const mapButton = await page.$('button:has-text("Map"), .map-view, [class*="map"]');
      if (mapButton) {
        await mapButton.click();
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log('  No map interaction available');
    }

    console.log(`  Captured ${apiCalls.length} XHR/Fetch requests`);
    console.log(`  Captured ${responses.length} JSON responses`);

    // Analyze API calls
    results.apis.endpoints = apiCalls
      .filter(call => 
        call.url.includes('/api/') || 
        call.url.includes('/graphql') ||
        call.url.includes('property') ||
        call.url.includes('listing') ||
        call.url.includes('search')
      )
      .map(call => ({
        url: call.url,
        method: call.method,
        type: call.resourceType
      }));

    // Extract API patterns
    const uniqueEndpoints = new Set();
    results.apis.endpoints.forEach(endpoint => {
      try {
        const url = new URL(endpoint.url);
        const pattern = `${url.origin}${url.pathname}`;
        uniqueEndpoints.add(pattern);
      } catch (e) {}
    });

    results.apis.patterns = Array.from(uniqueEndpoints);

    // Step 3: Analyze JSON responses for off-market signals
    console.log(`\n[3/5] Analyzing JSON responses for off-market signals...`);
    
    for (const response of responses) {
      try {
        const json = JSON.parse(response.body);
        const signals = findOffMarketSignals(json);
        if (signals.length > 0) {
          results.offMarketSignals.push({
            url: response.url,
            signals
          });
        }
      } catch (e) {
        // Not valid JSON or parsing error
      }
    }

    console.log(`  Found ${results.offMarketSignals.length} responses with potential off-market signals`);

    // Step 4: Check for sitemaps
    console.log(`\n[4/5] Checking for sitemaps...`);
    
    const sitemapUrls = [
      `https://www.${network.domain}/sitemap.xml`,
      `https://www.${network.domain}/sitemap_index.xml`,
      `https://www.${network.domain}/sitemap-properties.xml`,
      `https://www.${network.domain}/property-sitemap.xml`
    ];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await axios.get(sitemapUrl, { timeout: 10000 });
        if (response.status === 200) {
          results.sitemap.sitemapUrl = sitemapUrl;
          
          const parser = new XMLParser();
          const sitemapData = parser.parse(response.data);
          
          if (sitemapData.urlset && sitemapData.urlset.url) {
            const urls = Array.isArray(sitemapData.urlset.url) 
              ? sitemapData.urlset.url 
              : [sitemapData.urlset.url];
            
            results.sitemap.totalUrls = urls.length;
            results.sitemap.propertyUrls = urls.filter(u => {
              const loc = u.loc || '';
              return loc.includes('property') || 
                     loc.includes('listing') || 
                     loc.includes('buy') ||
                     loc.includes('sale');
            }).length;
          } else if (sitemapData.sitemapindex) {
            // It's a sitemap index
            const sitemaps = Array.isArray(sitemapData.sitemapindex.sitemap)
              ? sitemapData.sitemapindex.sitemap
              : [sitemapData.sitemapindex.sitemap];
            
            console.log(`  Found sitemap index with ${sitemaps.length} sitemaps`);
            results.sitemap.totalUrls = `Index with ${sitemaps.length} sitemaps`;
          }
          
          console.log(`  Found sitemap: ${sitemapUrl}`);
          console.log(`  Total URLs: ${results.sitemap.totalUrls}`);
          console.log(`  Property URLs: ${results.sitemap.propertyUrls}`);
          break;
        }
      } catch (e) {
        // Sitemap not found at this URL
      }
    }

    if (!results.sitemap.sitemapUrl) {
      console.log(`  No sitemap found`);
    }

    // Step 5: Check robots.txt for hidden paths
    console.log(`\n[5/5] Checking robots.txt...`);
    
    try {
      const robotsResponse = await axios.get(`https://www.${network.domain}/robots.txt`, { timeout: 10000 });
      if (robotsResponse.status === 200) {
        const robotsTxt = robotsResponse.data;
        const disallowedPaths = robotsTxt.split('\n')
          .filter(line => line.toLowerCase().includes('disallow:'))
          .map(line => line.split(':')[1]?.trim())
          .filter(Boolean);
        
        console.log(`  Found ${disallowedPaths.length} disallowed paths`);
        
        // Check if any disallowed paths might be property pages
        const propertyPaths = disallowedPaths.filter(path => 
          path.includes('property') || 
          path.includes('listing') ||
          path.includes('offmarket') ||
          path.includes('pre-market')
        );
        
        if (propertyPaths.length > 0) {
          results.darkPages.detected = true;
          results.darkPages.examples = propertyPaths.slice(0, 5);
          console.log(`  Potential dark pages detected: ${propertyPaths.length}`);
        }
      }
    } catch (e) {
      console.log(`  No robots.txt found`);
    }

    await browser.close();

  } catch (error) {
    console.error(`Error investigating ${network.name}:`, error.message);
    results.error = error.message;
  }

  return results;
}

function findOffMarketSignals(obj, path = '', signals = []) {
  if (obj === null || obj === undefined) return signals;
  
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check if key matches any off-market signal pattern
      const matchingPattern = OFF_MARKET_SIGNAL_PATTERNS.find(pattern => 
        lowerKey.includes(pattern.toLowerCase())
      );
      
      if (matchingPattern) {
        signals.push({
          path: path ? `${path}.${key}` : key,
          key,
          value: obj[key],
          pattern: matchingPattern
        });
      }
      
      // Recursively search nested objects and arrays
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const newPath = path ? `${path}.${key}` : key;
        findOffMarketSignals(obj[key], newPath, signals);
      }
    }
  }
  
  return signals;
}

function generatePropTechAnatomyTable(results) {
  console.log('\n' + '='.repeat(120));
  console.log('PROPTECH ANATOMY TABLE - Australian Franchise Networks');
  console.log('='.repeat(120));
  console.log('');
  
  // Header
  console.log('| Network | Tech Stack | Primary API Endpoint | Off-Market Signals | Sitemap Status |');
  console.log('|---------|-----------|---------------------|-------------------|----------------|');
  
  // Rows
  for (const result of results) {
    const network = result.name.padEnd(12);
    
    // Tech stack summary
    let techStack = 'Unknown';
    if (result.techStack.detected) {
      const frameworks = Object.entries(result.techStack.detected.frameworks)
        .filter(([k, v]) => v)
        .map(([k]) => k);
      const cms = Object.entries(result.techStack.detected.cms)
        .filter(([k, v]) => v)
        .map(([k]) => k);
      
      if (frameworks.length > 0 || cms.length > 0) {
        techStack = [...frameworks, ...cms].join(', ');
      }
    }
    techStack = techStack.substring(0, 25).padEnd(25);
    
    // Primary API
    const primaryApi = result.apis.patterns[0] || 'None detected';
    const apiShort = primaryApi.substring(0, 45).padEnd(45);
    
    // Off-market signals
    const signalsCount = result.offMarketSignals.reduce((acc, s) => acc + s.signals.length, 0);
    const signalsSummary = signalsCount > 0 
      ? `${signalsCount} signals found` 
      : 'None detected';
    const signalsShort = signalsSummary.substring(0, 25).padEnd(25);
    
    // Sitemap
    const sitemapStatus = result.sitemap.sitemapUrl 
      ? `${result.sitemap.propertyUrls} properties`
      : 'No sitemap';
    const sitemapShort = sitemapStatus.substring(0, 20);
    
    console.log(`| ${network} | ${techStack} | ${apiShort} | ${signalsShort} | ${sitemapShort} |`);
  }
  
  console.log('');
}

async function main() {
  console.log('PropTech Franchise Network Reconnaissance Tool');
  console.log('Analyzing Australian real estate franchise websites...\n');

  const results = [];

  for (const network of FRANCHISE_NETWORKS) {
    const result = await investigateNetwork(network);
    results.push(result);
    
    // Small delay between networks
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Save detailed results
  fs.writeFileSync(
    'franchise-networks-analysis.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\n\nDetailed results saved to: franchise-networks-analysis.json');

  // Generate PropTech Anatomy Table
  generatePropTechAnatomyTable(results);

  // Generate detailed report
  console.log('\n' + '='.repeat(120));
  console.log('DETAILED FINDINGS');
  console.log('='.repeat(120));

  for (const result of results) {
    console.log(`\n### ${result.name} (${result.domain})`);
    console.log(`\n**Tech Stack:**`);
    if (result.techStack.detected) {
      console.log(`- Frameworks: ${Object.entries(result.techStack.detected.frameworks).filter(([k,v]) => v).map(([k]) => k).join(', ') || 'None'}`);
      console.log(`- CMS: ${Object.entries(result.techStack.detected.cms).filter(([k,v]) => v).map(([k]) => k).join(', ') || 'None'}`);
    }
    
    console.log(`\n**API Endpoints (${result.apis.patterns.length} unique):**`);
    result.apis.patterns.slice(0, 5).forEach(pattern => {
      console.log(`- ${pattern}`);
    });
    
    console.log(`\n**Off-Market Signals:**`);
    if (result.offMarketSignals.length > 0) {
      result.offMarketSignals.slice(0, 3).forEach(signal => {
        console.log(`- URL: ${signal.url}`);
        signal.signals.slice(0, 3).forEach(s => {
          console.log(`  * ${s.key} = ${JSON.stringify(s.value)}`);
        });
      });
    } else {
      console.log('- None detected');
    }
    
    console.log(`\n**Sitemap:**`);
    if (result.sitemap.sitemapUrl) {
      console.log(`- URL: ${result.sitemap.sitemapUrl}`);
      console.log(`- Total URLs: ${result.sitemap.totalUrls}`);
      console.log(`- Property URLs: ${result.sitemap.propertyUrls}`);
    } else {
      console.log('- No sitemap found');
    }
    
    if (result.darkPages.detected) {
      console.log(`\n**Dark Pages:**`);
      console.log(`- Detected: Yes`);
      console.log(`- Examples: ${result.darkPages.examples.join(', ')}`);
    }
  }

  console.log('\n\nInvestigation complete!');
}

main().catch(console.error);
