#!/usr/bin/env node

const { chromium } = require('playwright');

async function investigateSite(url, siteName) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔍 Investigating ${siteName}: ${url}`);
  console.log('='.repeat(70));
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Navigate to page
    console.log('📍 Navigating to page...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Take screenshot
    await page.screenshot({ path: `/tmp/${siteName}-screenshot.png`, fullPage: false });
    console.log(`✓ Screenshot saved to /tmp/${siteName}-screenshot.png`);
    
    // Get page title
    const title = await page.title();
    console.log(`✓ Page title: "${title}"`);
    
    // Check for JSON-LD
    const jsonLd = await page.$$eval('script[type="application/ld+json"]', scripts => 
      scripts.map(s => s.textContent)
    );
    console.log(`\n📊 JSON-LD Scripts: ${jsonLd.length} found`);
    if (jsonLd.length > 0) {
      jsonLd.forEach((json, i) => {
        try {
          const parsed = JSON.parse(json);
          console.log(`   [${i}] @type: ${parsed['@type'] || 'unknown'}`);
        } catch (e) {
          console.log(`   [${i}] Invalid JSON`);
        }
      });
    }
    
    // Search for common property listing patterns
    console.log('\n🏢 Searching for property listing elements...');
    
    const patterns = [
      { selector: '.property-card', name: 'property-card' },
      { selector: '.listing-card', name: 'listing-card' },
      { selector: '.listing-item', name: 'listing-item' },
      { selector: '[class*="property"]', name: 'elements with "property" in class' },
      { selector: '[class*="listing"]', name: 'elements with "listing" in class' },
      { selector: '[data-testid*="property"]', name: 'elements with "property" in testid' },
      { selector: 'article', name: 'article elements' },
      { selector: '[role="article"]', name: 'article role' },
    ];
    
    for (const { selector, name } of patterns) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`   ✓ ${name}: ${count} found`);
        
        // Get classes from first element
        if (count > 0) {
          const firstElement = page.locator(selector).first();
          const classes = await firstElement.getAttribute('class');
          if (classes) {
            console.log(`     └─ Sample classes: ${classes.split(' ').slice(0, 5).join(', ')}`);
          }
        }
      }
    }
    
    // Try to find any network requests
    console.log('\n🌐 Intercepting network requests...');
    const requests = [];
    
    page.on('request', request => {
      const url = request.url();
      if (url.includes('api') || url.includes('search') || url.includes('property') || url.includes('graphql')) {
        requests.push({
          url: url,
          method: request.method(),
          type: request.resourceType()
        });
      }
    });
    
    // Wait a bit for any AJAX to load
    await page.waitForTimeout(3000);
    
    if (requests.length > 0) {
      console.log(`   Found ${requests.length} relevant requests:`);
      requests.forEach(req => {
        console.log(`   - ${req.method} ${req.url}`);
      });
    } else {
      console.log('   No API/search/property requests detected');
    }
    
    // Get page content sample
    console.log('\n📄 Page content analysis:');
    const bodyText = await page.locator('body').textContent();
    const hasListings = bodyText.toLowerCase().includes('property') || 
                        bodyText.toLowerCase().includes('industrial') ||
                        bodyText.toLowerCase().includes('warehouse');
    console.log(`   Contains property keywords: ${hasListings ? '✓' : '✗'}`);
    
    // Check if page is using React/Vue/Angular
    const hasReact = await page.evaluate(() => !!window.React || !!document.querySelector('[data-reactroot]'));
    const hasVue = await page.evaluate(() => !!window.Vue || !!document.querySelector('[data-v-]'));
    const hasAngular = await page.evaluate(() => !!window.angular || !!document.querySelector('[ng-app]'));
    
    console.log('\n⚙️  Framework detection:');
    if (hasReact) console.log('   ✓ React detected');
    if (hasVue) console.log('   ✓ Vue detected');
    if (hasAngular) console.log('   ✓ Angular detected');
    if (!hasReact && !hasVue && !hasAngular) console.log('   No major frameworks detected');
    
  } catch (error) {
    console.error(`❌ Error investigating ${siteName}:`, error.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('🔬 Real Website Structure Investigation');
  console.log('This will help us fix the scouts with actual data\n');
  
  // Investigate CBRE
  await investigateSite(
    'https://www.cbre.com.au/properties/industrial-warehouse?aspects=isSale,isLease',
    'CBRE'
  );
  
  // Investigate Cameron
  await investigateSite(
    'https://www.cameron.com.au/commercial/?type=industrial&type=warehouse',
    'Cameron'
  );
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ Investigation complete!');
  console.log('Screenshots saved in /tmp/');
  console.log('='.repeat(70));
}

main().catch(console.error);
