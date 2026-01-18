# Test Suite Documentation

## Overview

This test suite is organized into three tiers, designed to validate the MCP Industrial Property Scout implementation at different levels.

**CRITICAL**: Since we haven't been able to view the actual websites we're scraping, the **Integration Tests (Network)** are THE MOST IMPORTANT tests. They validate ALL assumptions we've made about website structure, URLs, and selectors.

## Test Structure

```
tests/
├── unit/                           # No network required
│   └── framework.test.js          # Framework validation
├── integration/                    # MCP + Network tests
│   ├── mcp-server.test.js         # MCP protocol (no network)
│   └── website-assumptions.test.js # CRITICAL: Validates ALL website assumptions
└── network/                        # Network discovery tests
    ├── api-discovery.test.js      # Discovers real API endpoints
    └── scout-implementation.test.js # Validates scout functionality
```

## Test Tiers

### Tier 1: Unit Tests (No Network)

**Purpose**: Validate framework components work correctly in isolation

**Files**:
- `tests/unit/framework.test.js`

**Tests**:
1. TypeScript compilation succeeds
2. All expected files are generated
3. Dependencies are correctly installed
4. Modules can be imported
5. ScoutManager initializes
6. Scouts register correctly
7. Scout interface compliance
8. Deduplication logic works
9. Error handling doesn't crash
10. MCP server module loads

**Run**:
```bash
npm run test:unit
```

**Expected Result**: ✅ All 10 tests pass
**Failure Means**: Framework is broken, fix before proceeding

---

### Tier 2: Integration Tests - MCP Server (No Network)

**Purpose**: Validate MCP protocol compliance and server integration

**Files**:
- `tests/integration/mcp-server.test.js`

**Tests**:
1. Server responds to initialize request
2. Server lists tools correctly
3. Tool call returns proper structure
4. Invalid tool calls return errors
5. Missing parameters handled gracefully
6. ScoutManager integrates with MCP server
7. Deduplication works end-to-end
8. Scout errors don't crash server
9. Parallel execution works
10. Response format matches MCP specification

**Run**:
```bash
npm run test:integration
```

**Expected Result**: ✅ All 10 tests pass (will return 0 listings without network)
**Failure Means**: MCP server implementation is broken

---

### Tier 3: Integration Tests - Website Validation (REQUIRES NETWORK) ⚠️

**Purpose**: Validate EVERY assumption about websites since we haven't seen them

**Files**:
- `tests/integration/website-assumptions.test.js`

**Tests** (12 critical assumptions):

#### CBRE Assumptions:
1. ✅ Domain `www.cbre.com.au` exists and resolves
2. ✅ URL `https://www.cbre.com.au/properties/industrial-warehouse` loads successfully
3. ✅ Page contains property listings (keywords present)
4. ✅ Selector `.property-card` exists and matches elements
5. ✅ Property cards contain extractable data (address, price, etc.)
6. ✅ Page has JSON-LD structured data (optional)

#### Cameron Assumptions:
7. ✅ Domain `www.cameron.com.au` exists and resolves
8. ✅ URL `https://www.cameron.com.au/commercial/` loads successfully
9. ✅ Page contains property listings
10. ✅ Selector `.property-card` or `.listing-item` exists
11. ✅ CBRE Scout returns real listings with required fields
12. ✅ Cameron Scout returns real listings with required fields

**Run**:
```bash
npm run test:network
```

**Expected in CI**: ✅ All tests pass
**Expected Locally** (restricted network): ❌ All tests fail with DNS errors

**What This Tells Us**:
- ✅ **If tests pass**: Websites accessible, URLs correct, selectors work, implementation verified
- ❌ **If tests fail in CI**: Implementation is NOT verified, cannot trust it

**Failure Scenarios**:
- `Domain does not resolve`: DNS blocked OR domain is wrong
- `URL returns 404`: Path is incorrect
- `Selector not found`: HTML structure doesn't match our assumptions
- `Scout returns 0 listings`: Implementation broken or selectors wrong
- `Missing required field`: Data extraction logic broken

---

### Tier 4: Network Tests - API Discovery (Optional)

**Purpose**: Discover real API endpoints used by websites

**Files**:
- `tests/network/api-discovery.test.js`
- `tests/network/scout-implementation.test.js`

**Tests**:
1. Test multiple speculative API endpoints
2. Intercept network requests with Playwright
3. Log all XHR/Fetch calls
4. Identify working APIs
5. Save discoveries to JSON

**Run**:
```bash
node tests/network/api-discovery.test.js
```

**Expected Result**: May find real APIs or confirm none exist

---

## Running Tests

### Locally (Limited Network)

```bash
# Run what we can (no network)
npm run test:unit           # ✅ Should pass
npm run test:integration    # ✅ Should pass (0 listings)

# These will fail locally due to DNS
npm run test:network        # ❌ Expected to fail
```

### In GitHub CI (With Network)

```bash
# Run full test suite
npm test                    # Runs all tiers

# Or individual suites
npm run test:unit
npm run test:integration
npm run test:network        # CRITICAL - must pass in CI
```

### GitHub Actions

The CI workflow runs:

1. **Unit Tests** (Node 20.x, 22.x)
   - Must pass or workflow fails
   
2. **Integration Tests - MCP** (Node 20.x, 22.x)
   - Must pass or workflow fails
   
3. **Integration Tests - Network** (Node 22.x only)
   - Tests network connectivity
   - Validates ALL website assumptions
   - Uploads results as artifacts
   - Comments on PR with results
   - **If this fails, implementation is NOT verified**

---

## Test Results Interpretation

### Scenario 1: All Tests Pass ✅

```
✅ Unit Tests: 10/10 passed
✅ Integration Tests (MCP): 10/10 passed
✅ Integration Tests (Network): 12/12 passed
```

**Meaning**: 
- Framework works
- MCP server works
- Websites accessible
- URLs correct
- Selectors match
- Data extraction works
- **Implementation is VERIFIED and production-ready** 🎉

---

### Scenario 2: Network Tests Fail in Local Environment ⚠️

```
✅ Unit Tests: 10/10 passed
✅ Integration Tests (MCP): 10/10 passed
❌ Integration Tests (Network): 0/12 passed (DNS errors)
```

**Meaning**:
- Framework works
- MCP server works
- Cannot verify website functionality (DNS blocked)
- **Implementation is UNVERIFIED** - must test in CI

**Action**: Push to GitHub and check CI results

---

### Scenario 3: Network Tests Fail in GitHub CI ❌

```
✅ Unit Tests: 10/10 passed
✅ Integration Tests (MCP): 10/10 passed
❌ Integration Tests (Network): 0/12 passed
```

**Meaning**: **CRITICAL FAILURE**
- Framework works BUT
- Websites not accessible OR
- URLs are wrong OR
- Selectors don't match OR
- Implementation is broken

**Action**: 
1. Check test artifacts for details
2. Fix issues identified
3. Re-run tests

---

### Scenario 4: Some Network Tests Pass, Some Fail ⚠️

```
✅ Unit Tests: 10/10 passed
✅ Integration Tests (MCP): 10/10 passed
⚠️  Integration Tests (Network): 6/12 passed
```

**Meaning**: Partial success
- Framework works
- One website works, one doesn't OR
- URLs load but selectors don't match OR
- Data extraction partially working

**Action**: Review which tests failed and fix specific issues

---

## Critical Assumptions Being Tested

### What We CANNOT Verify Locally

❌ URLs are correct
❌ Pages load successfully
❌ Selectors match actual HTML
❌ Data extraction works
❌ Scouts return real listings
❌ JSON-LD exists on pages
❌ APIs exist or don't exist

### What We CAN Verify Locally

✅ TypeScript compiles
✅ Modules load correctly
✅ Framework logic works
✅ MCP protocol compliance
✅ Error handling works
✅ Deduplication logic correct
✅ Parallel execution pattern

---

## Adding New Tests

### Unit Test Template

```javascript
test('Test name', async () => {
  // Arrange
  const component = new Component();
  
  // Act
  const result = await component.method();
  
  // Assert
  assert(result === expected, 'Error message');
  console.log(`   ✓ Verification message`);
});
```

### Integration Test Template

```javascript
test('ASSUMPTION: Description of assumption', async () => {
  console.log('   Testing assumption...');
  
  // Test the assumption
  // Throw error with details if fails
  
  console.log(`   ✓ Assumption validated`);
  
  // Record result
  results.push({ assumption: 'name', validated: true });
});
```

---

## Debugging Failed Tests

### Unit Test Failures

1. Check TypeScript compilation: `npm run build`
2. Verify dependencies: `npm install`
3. Check file paths in test
4. Review error message and stack trace

### Integration Test (MCP) Failures

1. Run server manually: `npm start`
2. Check server logs for errors
3. Test with simple JSON-RPC request
4. Verify tool registration

### Network Test Failures

1. Check DNS resolution: `curl -I https://www.cbre.com.au`
2. Test Playwright navigation manually
3. Inspect page HTML: `npx playwright screenshot --url https://www.cbre.com.au/properties`
4. Check test artifacts for detailed results

---

## Continuous Integration

### GitHub Actions Workflow

Located: `.github/workflows/integration-tests.yml`

**Jobs**:
1. `unit-tests` - Runs on Node 20.x and 22.x
2. `integration-tests-mcp` - Runs on Node 20.x and 22.x
3. `integration-tests-network` - Runs on Node 22.x with Playwright

**Artifacts Uploaded**:
- `unit-test-results-node-{version}` - Build output
- `network-test-results` - Website validation results and API discoveries

**PR Comments**:
- Automatic comment with network test results
- Shows which assumptions passed/failed
- Links to artifacts

---

## Summary

**Priority Order**:
1. ✅ Unit Tests (must pass always)
2. ✅ Integration Tests - MCP (must pass always)
3. ⚠️ **Integration Tests - Network (CRITICAL - validates all assumptions)**
4. ℹ️ Network Tests - API Discovery (optional, informational)

**Bottom Line**:
- Without passing network integration tests, we **cannot trust** the implementation
- These tests are the ONLY way to verify our assumptions about websites
- They MUST pass in GitHub CI to consider implementation complete

---

## Contact / Questions

If tests fail in unexpected ways:
1. Check test artifacts in GitHub Actions
2. Review `website-validation-results.json` for details
3. Check `api-discoveries.json` for API findings
4. Review CI logs for network connectivity issues
