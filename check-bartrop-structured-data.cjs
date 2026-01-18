#!/usr/bin/env node

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Visit a sample property page
    console.log('Fetching property page...');
    await page.goto('https://www.bartrop.com.au/property?property_id=1715000/2-507-bell-street-redan', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Check for JSON-LD
    const jsonLd = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      return scripts.map(s => {
        try {
          return JSON.parse(s.textContent || '');
        } catch {
          return null;
        }
      }).filter(Boolean);
    });
    
    // Check for meta tags
    const metaTags = await page.evaluate(() => {
      const metas = Array.from(document.querySelectorAll('meta[property], meta[name]'));
      return metas.map(m => ({
        property: m.getAttribute('property') || m.getAttribute('name'),
        content: m.getAttribute('content')
      })).filter(m => m.content && m.property);
    });
    
    // Check for data attributes
    const dataAttrs = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-property], [data-listing], [data-price], [data-address]'));
      return elements.map(el => ({
        tag: el.tagName,
        attributes: Array.from(el.attributes)
          .filter(attr => attr.name.startsWith('data-'))
          .map(attr => ({ name: attr.name, value: attr.value }))
      })).filter(el => el.attributes.length > 0);
    });
    
    // Check for window object data
    const windowData = await page.evaluate(() => {
      const data = {
        hasPropertyData: typeof window.propertyData !== 'undefined',
        hasListingData: typeof window.listingData !== 'undefined',
        propertyData: window.propertyData || null,
        listingData: window.listingData || null
      };
      return data;
    });
    
    // Check page title and URL patterns
    const title = await page.title();
    const url = page.url();
    
    console.log('\n=== STRUCTURED DATA ANALYSIS ===');
    console.log('URL:', url);
    console.log('Title:', title);
    
    console.log('\n--- JSON-LD Found:', jsonLd.length);
    if (jsonLd.length > 0) {
      console.log(JSON.stringify(jsonLd, null, 2));
    } else {
      console.log('No JSON-LD found');
    }
    
    console.log('\n--- Meta Tags (relevant):');
    const relevantMetas = metaTags.filter(m => 
      m.property.includes('og:') || 
      m.property.includes('twitter:') ||
      m.property.includes('price') ||
      m.property.includes('address') ||
      m.property.includes('property')
    );
    console.log(JSON.stringify(relevantMetas, null, 2));
    
    console.log('\n--- Data Attributes:', dataAttrs.length);
    if (dataAttrs.length > 0) {
      console.log(JSON.stringify(dataAttrs, null, 2));
    } else {
      console.log('No data attributes found');
    }
    
    console.log('\n--- Window Object Data:');
    console.log(JSON.stringify(windowData, null, 2));
    
    // Check for JSON/XML endpoints
    console.log('\n--- Checking for alternative formats...');
    
    // Try .json extension
    const jsonUrl = url.replace(/\?/, '.json?');
    try {
      const jsonResp = await page.goto(jsonUrl, { timeout: 5000, waitUntil: 'domcontentloaded' });
      if (jsonResp && jsonResp.ok()) {
        const contentType = jsonResp.headers()['content-type'];
        console.log('JSON endpoint exists:', jsonUrl, 'Content-Type:', contentType);
        const jsonText = await jsonResp.text();
        console.log('Sample:', jsonText.substring(0, 200));
      }
    } catch (e) {
      console.log('No .json endpoint found');
    }
    
    // Try .xml extension
    const xmlUrl = url.replace(/\?/, '.xml?');
    try {
      const xmlResp = await page.goto(xmlUrl, { timeout: 5000, waitUntil: 'domcontentloaded' });
      if (xmlResp && xmlResp.ok()) {
        const contentType = xmlResp.headers()['content-type'];
        console.log('XML endpoint exists:', xmlUrl, 'Content-Type:', contentType);
      }
    } catch (e) {
      console.log('No .xml endpoint found');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
