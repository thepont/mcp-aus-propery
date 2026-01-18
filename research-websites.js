#!/usr/bin/env node

/**
 * Research script to investigate actual website structure
 * This will help us understand how to properly scrape CBRE and Cameron
 */

import { chromium } from 'playwright';

async function researchCBRE() {
  console.log('\n🔍 Researching CBRE Australia...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    // Try the properties page
    console.log('📄 Navigating to CBRE properties page...');
    await page.goto('https://www.cbre.com.au/properties', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('✅ Page loaded successfully');
    console.log('📍 URL:', page.url());
    console.log('📰 Title:', await page.title());
    
    // Check for API calls in network
    const requests = [];
    page.on('request', request => {
      if (request.url().includes('api') || request.url().includes('search')) {
        requests.push({
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType()
        });
      }
    });
    
    // Wait a bit for any XHR/fetch requests
    await page.waitForTimeout(3000);
    
    if (requests.length > 0) {
      console.log('\n🌐 API Requests detected:');
      requests.forEach(req => {
        console.log(`  - ${req.method} ${req.url}`);
      });
    }
    
    // Try to find property listings
    const propertySelectors = [
      '.property-card',
      '.property-item',
      '[class*="property"]',
      '[data-testid*="property"]',
      'article',
      '.listing'
    ];
    
    for (const selector of propertySelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`\n✨ Found ${count} elements matching: ${selector}`);
        
        // Get sample HTML
        const firstElement = page.locator(selector).first();
        const html = await firstElement.innerHTML().catch(() => 'N/A');
        console.log('📝 Sample HTML (first 500 chars):');
        console.log(html.substring(0, 500));
        break;
      }
    }
    
    // Check page content structure
    const bodyText = await page.textContent('body');
    console.log(`\n📊 Page has ${bodyText.length} characters of text`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

async function researchCameron() {
  console.log('\n🔍 Researching Cameron Real Estate...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    // Try the main page first
    console.log('📄 Navigating to Cameron homepage...');
    await page.goto('https://www.cameron.com.au/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('✅ Page loaded successfully');
    console.log('📍 URL:', page.url());
    console.log('📰 Title:', await page.title());
    
    // Check for API calls
    const requests = [];
    page.on('request', request => {
      if (request.url().includes('api') || request.url().includes('search') || request.url().includes('properties')) {
        requests.push({
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType()
        });
      }
    });
    
    await page.waitForTimeout(3000);
    
    if (requests.length > 0) {
      console.log('\n🌐 API Requests detected:');
      requests.forEach(req => {
        console.log(`  - ${req.method} ${req.url}`);
      });
    }
    
    // Look for search or properties links
    const links = await page.locator('a[href*="property"], a[href*="search"], a[href*="for-sale"], a[href*="for-lease"]').all();
    console.log(`\n🔗 Found ${links.length} property-related links`);
    
    if (links.length > 0) {
      for (let i = 0; i < Math.min(3, links.length); i++) {
        const href = await links[i].getAttribute('href');
        const text = await links[i].textContent();
        console.log(`  - ${text?.trim() || 'N/A'}: ${href}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║   Website Research Tool - Finding Real APIs and Selectors        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  
  try {
    await researchCBRE();
  } catch (error) {
    console.error('CBRE research failed:', error.message);
  }
  
  try {
    await researchCameron();
  } catch (error) {
    console.error('Cameron research failed:', error.message);
  }
  
  console.log('\n✅ Research complete!\n');
}

main().catch(console.error);
