#!/usr/bin/env node

/**
 * Direct Playwright test to see if we can actually access the websites
 */

import { chromium } from 'playwright';

async function testDirectAccess() {
  console.log('🔍 Testing direct Playwright access to real estate websites...\n');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  // Test CBRE
  console.log('📄 Testing CBRE...');
  try {
    const page = await context.newPage();
    const response = await page.goto('https://www.cbre.com.au/properties/industrial-warehouse', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log(`✅ CBRE Response: ${response.status()} ${response.statusText()}`);
    console.log(`   URL: ${response.url()}`);
    
    const title = await page.title();
    console.log(`   Page Title: ${title}`);
    
    // Try to find properties
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log(`   Page has ${bodyText.length} characters of text`);
    
    // Look for common selectors
    const selectors = ['.property-card', '[data-testid*="property"]', 'article', '.listing'];
    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`   Found ${count} elements matching "${selector}"`);
      }
    }
    
    await page.close();
  } catch (error) {
    console.log(`❌ CBRE Failed: ${error.message}`);
  }
  
  console.log('');
  
  // Test Cameron
  console.log('📄 Testing Cameron...');
  try {
    const page = await context.newPage();
    const response = await page.goto('https://www.cameron.com.au/commercial/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log(`✅ Cameron Response: ${response.status()} ${response.statusText()}`);
    console.log(`   URL: ${response.url()}`);
    
    const title = await page.title();
    console.log(`   Page Title: ${title}`);
    
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log(`   Page has ${bodyText.length} characters of text`);
    
    // Look for common selectors
    const selectors = ['.property-card', '.listing-item', 'article', '[class*="property"]'];
    for (const selector of selectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`   Found ${count} elements matching "${selector}"`);
      }
    }
    
    await page.close();
  } catch (error) {
    console.log(`❌ Cameron Failed: ${error.message}`);
  }
  
  await browser.close();
  
  console.log('\n✅ Test complete!\n');
}

testDirectAccess().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
