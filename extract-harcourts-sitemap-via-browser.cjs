#!/usr/bin/env node

const { chromium } = require('playwright');
const { XMLParser } = require('fast-xml-parser');

(async () => {
  console.log('🗺️  Harcourts Sitemap Extraction via Browser\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });
  
  const results = {
    timestamp: new Date().toISOString(),
    propertyUrlsFound: 0,
    sampleUrls: [],
    sitemapsChecked: []
  };
  
  const sitemapUrls = [
    'https://www.harcourts.com.au/sitemap-properties.xml',
    'https://www.harcourts.com.au/sitemap-index.xml',
    'https://www.harcourts.com.au/sitemap.xml'
  ];
  
  for (const sitemapUrl of sitemapUrls) {
    try {
      console.log(`\n📄 Fetching: ${sitemapUrl}`);
      const response = await page.goto(sitemapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      if (response && response.status() === 200) {
        const content = await page.content();
        const xmlData = parser.parse(content);
        
        let urls = [];
        
        // Check if it's a sitemap index
        if (xmlData.sitemapindex && xmlData.sitemapindex.sitemap) {
          const sitemaps = Array.isArray(xmlData.sitemapindex.sitemap) 
            ? xmlData.sitemapindex.sitemap 
            : [xmlData.sitemapindex.sitemap];
          
          console.log(`  ✅ Sitemap index with ${sitemaps.length} sitemaps`);
          
          // Look for property sitemaps
          const propertySitemaps = sitemaps.filter(sm => {
            const loc = sm.loc || '';
            return loc.toLowerCase().includes('property') || loc.toLowerCase().includes('listing');
          });
          
          console.log(`  🏠 Property-related sitemaps: ${propertySitemaps.length}`);
          
          // Fetch the first property sitemap
          if (propertySitemaps.length > 0) {
            const propSitemapUrl = propertySitemaps[0].loc;
            console.log(`\n  📄 Fetching property sitemap: ${propSitemapUrl}`);
            
            const propResponse = await page.goto(propSitemapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            if (propResponse && propResponse.status() === 200) {
              const propContent = await page.content();
              const propXml = parser.parse(propContent);
              
              if (propXml.urlset && propXml.urlset.url) {
                urls = Array.isArray(propXml.urlset.url) ? propXml.urlset.url : [propXml.urlset.url];
                console.log(`    ✅ Found ${urls.length} property URLs`);
              }
            }
          }
        }
        // Check if it's a regular sitemap with URLs
        else if (xmlData.urlset && xmlData.urlset.url) {
          urls = Array.isArray(xmlData.urlset.url) ? xmlData.urlset.url : [xmlData.urlset.url];
          console.log(`  ✅ Found ${urls.length} URLs`);
        }
        
        if (urls.length > 0) {
          results.sitemapsChecked.push({
            url: sitemapUrl,
            urlCount: urls.length
          });
          
          results.propertyUrlsFound += urls.length;
          results.sampleUrls.push(...urls.slice(0, 20).map(u => u.loc));
        }
        
      } else {
        console.log(`  ❌ HTTP ${response ? response.status() : 'N/A'}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  await browser.close();
  
  // Results
  console.log('\n\n📊 RESULTS\n');
  console.log('='.repeat(60));
  console.log(`\n🏠 Total Property URLs Found: ${results.propertyUrlsFound}`);
  
  if (results.sampleUrls.length > 0) {
    console.log(`\n📋 Sample Property URLs:`);
    [...new Set(results.sampleUrls)].slice(0, 15).forEach(url => console.log(`  - ${url}`));
    
    console.log(`\n📝 URL Pattern Analysis:`);
    const uniqueUrls = [...new Set(results.sampleUrls)];
    const patterns = {};
    uniqueUrls.forEach(url => {
      const match = url.match(/harcourts\.com\.au\/([^\/]+)/);
      if (match) {
        patterns[match[1]] = (patterns[match[1]] || 0) + 1;
      }
    });
    Object.entries(patterns).forEach(([pattern, count]) => {
      console.log(`  - /${pattern}/... (${count} URLs)`);
    });
  } else {
    console.log('\n❌ No property URLs found in sitemaps');
  }
  
  console.log(`\n📁 Sitemaps Successfully Accessed: ${results.sitemapsChecked.length}`);
  results.sitemapsChecked.forEach(sm => {
    console.log(`  - ${sm.url} (${sm.urlCount} URLs)`);
  });
  
  const fs = require('fs');
  fs.writeFileSync('harcourts-sitemap-browser-extraction.json', JSON.stringify(results, null, 2));
  console.log('\n💾 Full results saved to: harcourts-sitemap-browser-extraction.json');
  
  console.log('\n✅ Extraction complete!');
})();
