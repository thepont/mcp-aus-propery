# Connection Failure Analysis

## Why the Scouts Failed to Connect

The CBRE and Cameron scouts failed to connect for **multiple reasons**:

### 1. Speculative API Endpoints

The scouts attempt to fetch from API endpoints that **don't actually exist**:
- `https://www.cbre.com.au/api/search/properties` - **Not a real API**
- `https://www.cameron.com.au/api/properties` - **Not a real API**

Real estate websites typically **don't expose public APIs**. The current implementation:
1. First tries these non-existent API endpoints (fails with 404)
2. Falls back to Playwright browser automation
3. Attempts to scrape HTML

### 2. Network Restrictions in CI/CD

Even if the APIs existed, the CI/CD environment has limitations:
- **DNS Resolution**: Some external domains may fail to resolve
- **Firewall Rules**: Certain websites may be blocked
- **Rate Limiting**: Real estate sites often block automated requests

### 3. Error Messages Explained

**DNS Error (`ENOTFOUND`)**: 
```
[Cameron] API error: getaddrinfo ENOTFOUND www.cameron.com.au
[CBRE] API error: getaddrinfo ENOTFOUND www.cbre.com.au
```
This means the DNS lookup failed - the environment couldn't translate the domain name to an IP address.

**Playwright Error**:
```
browserType.launch: Executable doesn't exist
```
This occurs when Playwright browsers aren't installed or aren't found in the expected location.

### Root Cause

✅ **The domains ARE correct**:
- `www.cbre.com.au` - Correct CBRE Australia domain
- `www.cameron.com.au` - Correct Cameron (Melbourne) domain

❌ **The implementation has fundamental issues**:
1. Assumes API endpoints exist when they don't
2. Real estate sites require proper web scraping, not API calls
3. Playwright fallback needs actual browser navigation logic
4. No real scraping selectors implemented

### What Actually Works

In production environments with proper implementation:

**Option 1: Real Website Scraping**
- Navigate to actual search pages (e.g., `https://www.cbre.com.au/properties/industrial-warehouse`)
- Use real HTML selectors from the actual website structure
- Handle pagination and dynamic content loading

**Option 2: Third-Party APIs**
- Use aggregator APIs like Domain.com.au, realestate.com.au
- These require API keys and subscriptions
- More reliable than scraping individual agency sites

**Option 3: Mock/Demo Mode**
- Return sample data for testing
- Switch to real implementation only in production

### Why Tests Still Pass

The tests validate:
- ✅ Server starts correctly
- ✅ Scouts are registered  
- ✅ Parallel execution works
- ✅ Error handling is graceful (returns empty results, doesn't crash)
- ✅ MCP protocol compliance

They do NOT test:
- ❌ Actual data fetching (speculative APIs don't exist)
- ❌ Website scraping (requires real selectors and accessible sites)
- ❌ Real listing parsing (no real data available)

### Recommended Solution

For a working implementation:

1. **Remove speculative API calls** - They will never work
2. **Implement real web scraping**:
   - Research actual website structure
   - Use correct URLs (e.g., `https://www.cbre.com.au/properties?propertyType=Industrial`)
   - Identify real HTML/CSS selectors
   - Handle JavaScript-rendered content
3. **Add error handling** for rate limiting and blocking
4. **Consider using public property APIs** instead (Domain, REA)
5. **Add a demo/mock mode** for testing when real access isn't available

### Current Status

The application **does not work for real property searches** because:
- The API endpoints don't exist
- No real web scraping is implemented  
- Playwright navigation needs actual page-specific logic
- HTML selectors are generic placeholders

**The code structure is correct, but the implementation needs real website-specific logic.**
