#!/usr/bin/env node

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

(async () => {
  console.log('🗺️  Harcourts Sitemap Analysis\n');
  
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });
  
  const results = {
    timestamp: new Date().toISOString(),
    sitemapsAnalyzed: [],
    propertyUrlsFound: 0,
    sampleUrls: []
  };
  
  // Check sitemap index
  try {
    console.log('📄 Fetching sitemap index...');
    const indexResponse = await axios.get('https://www.harcourts.com.au/sitemap-index.xml', { timeout: 30000 });
    const indexData = parser.parse(indexResponse.data);
    
    let sitemaps = [];
    if (indexData.sitemapindex && indexData.sitemapindex.sitemap) {
      sitemaps = Array.isArray(indexData.sitemapindex.sitemap) 
        ? indexData.sitemapindex.sitemap 
        : [indexData.sitemapindex.sitemap];
    }
    
    console.log(`✅ Found ${sitemaps.length} sitemaps in index\n`);
    
    // Look for property-related sitemaps
    const propertySitemaps = sitemaps.filter(sm => {
      const loc = sm.loc || '';
      return loc.includes('property') || loc.includes('listing') || loc.includes('Properties');
    });
    
    console.log(`🏠 Property-related sitemaps: ${propertySitemaps.length}`);
    propertySitemaps.forEach(sm => console.log(`  - ${sm.loc}`));
    
    // Analyze the first few property sitemaps
    for (const sm of propertySitemaps.slice(0, 3)) {
      try {
        console.log(`\n📄 Analyzing: ${sm.loc}`);
        const smResponse = await axios.get(sm.loc, { timeout: 30000 });
        const smData = parser.parse(smResponse.data);
        
        let urls = [];
        if (smData.urlset && smData.urlset.url) {
          urls = Array.isArray(smData.urlset.url) ? smData.urlset.url : [smData.urlset.url];
        }
        
        console.log(`  ✅ Found ${urls.length} URLs`);
        
        results.sitemapsAnalyzed.push({
          url: sm.loc,
          urlCount: urls.length,
          sampleUrls: urls.slice(0, 5).map(u => u.loc)
        });
        
        results.propertyUrlsFound += urls.length;
        results.sampleUrls.push(...urls.slice(0, 10).map(u => u.loc));
        
      } catch (e) {
        console.log(`  ❌ Error analyzing sitemap: ${e.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error fetching sitemap index:', error.message);
  }
  
  // Also check direct properties sitemap
  try {
    console.log('\n📄 Checking direct properties sitemap...');
    const propsResponse = await axios.get('https://www.harcourts.com.au/sitemap-properties.xml', { timeout: 30000 });
    const propsData = parser.parse(propsResponse.data);
    
    let urls = [];
    if (propsData.urlset && propsData.urlset.url) {
      urls = Array.isArray(propsData.urlset.url) ? propsData.urlset.url : [propsData.urlset.url];
    }
    
    console.log(`✅ Found ${urls.length} property URLs in direct sitemap`);
    
    if (urls.length > 0) {
      results.sitemapsAnalyzed.push({
        url: 'https://www.harcourts.com.au/sitemap-properties.xml',
        urlCount: urls.length,
        sampleUrls: urls.slice(0, 10).map(u => u.loc)
      });
      
      results.propertyUrlsFound += urls.length;
      results.sampleUrls.push(...urls.slice(0, 10).map(u => u.loc));
    }
    
  } catch (error) {
    console.error('❌ Error checking properties sitemap:', error.message);
  }
  
  // Results
  console.log('\n\n📊 SITEMAP ANALYSIS RESULTS\n');
  console.log('='.repeat(60));
  console.log(`\n🏠 Total Property URLs Found: ${results.propertyUrlsFound}`);
  console.log(`\n📋 Sample Property URLs:`);
  [...new Set(results.sampleUrls)].slice(0, 10).forEach(url => console.log(`  - ${url}`));
  
  console.log(`\n📁 Sitemaps Analyzed: ${results.sitemapsAnalyzed.length}`);
  results.sitemapsAnalyzed.forEach(sm => {
    console.log(`  - ${sm.url} (${sm.urlCount} URLs)`);
  });
  
  const fs = require('fs');
  fs.writeFileSync('harcourts-sitemap-analysis.json', JSON.stringify(results, null, 2));
  console.log('\n💾 Full results saved to: harcourts-sitemap-analysis.json');
  
  console.log('\n✅ Analysis complete!');
})();
