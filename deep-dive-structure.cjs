#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');

async function deepDiveHTML(url, siteName) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔬 Deep Dive: ${siteName}`);
  console.log('='.repeat(70));
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`✓ Loaded: ${url}`);
    
    // Save full HTML
    const html = await page.content();
    fs.writeFileSync(`/tmp/${siteName}-page.html`, html);
    console.log(`✓ Saved HTML to /tmp/${siteName}-page.html (${html.length} bytes)`);
    
    // Look for actual listing containers
    const analysis = await page.evaluate(() => {
      const results = {
        mainContainers: [],
        possibleListings: [],
        links: []
      };
      
      // Find main content containers
      const mainSelectors = [
        '.propertyResults',
        '.search-results',
        '.listings',
        '.properties',
        '[class*="result"]',
        '[class*="listing"]',
        'main',
        '#content',
        '.content'
      ];
      
      for (const selector of mainSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          results.mainContainers.push({
            selector: selector,
            children: el.children.length,
            classes: el.className,
            id: el.id
          });
        }
      }
      
      // Find elements that look like listings
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const classes = el.className?.toString() || '';
        const text = el.textContent?.trim() || '';
        
        // Check if it looks like a property listing
        if (
          (classes.includes('property') || classes.includes('listing') || classes.includes('item')) &&
          text.length > 50 && text.length < 5000 &&
          el.children.length > 0 && el.children.length < 50
        ) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 50) {
            results.possibleListings.push({
              tag: el.tagName,
              classes: classes,
              childCount: el.children.length,
              textLength: text.length,
              sample: text.substring(0, 100).replace(/\s+/g, ' ')
            });
          }
        }
      });
      
      // Find links to property details
      const links = document.querySelectorAll('a');
      links.forEach(link => {
        const href = link.href;
        const text = link.textContent?.trim();
        if (href && (href.includes('property') || href.includes('listing') || text?.includes('View'))) {
          results.links.push({
            href: href,
            text: text?.substring(0, 50)
          });
        }
      });
      
      return results;
    });
    
    console.log(`\n📦 Main Containers (${analysis.mainContainers.length}):`);
    analysis.mainContainers.slice(0, 5).forEach(c => {
      console.log(`   - ${c.selector}`);
      console.log(`     └─ ${c.children} children, class: "${c.classes}"`);
    });
    
    console.log(`\n🎯 Possible Listing Elements (${analysis.possibleListings.length}):`);
    // Group by class patterns
    const uniqueClasses = {};
    analysis.possibleListings.forEach(item => {
      const key = item.classes.split(' ').slice(0, 2).join(' ');
      if (!uniqueClasses[key]) uniqueClasses[key] = [];
      uniqueClasses[key].push(item);
    });
    
    Object.entries(uniqueClasses).slice(0, 10).forEach(([classes, items]) => {
      console.log(`   - "${classes}" (${items.length} items)`);
      if (items[0]) {
        console.log(`     └─ Sample: ${items[0].sample.substring(0, 80)}...`);
      }
    });
    
    console.log(`\n🔗 Property Links (${analysis.links.length}):`);
    analysis.links.slice(0, 5).forEach(link => {
      console.log(`   - ${link.text || '(no text)'}`);
      console.log(`     └─ ${link.href}`);
    });
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  await deepDiveHTML(
    'https://www.cbre.com.au/properties/industrial-warehouse?aspects=isSale,isLease',
    'CBRE'
  );
  
  await deepDiveHTML(
    'https://www.cameron.com.au/commercial/?type=industrial&type=warehouse',
    'Cameron'
  );
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ Deep dive complete - check /tmp/ for HTML files');
  console.log('='.repeat(70));
}

main().catch(console.error);
