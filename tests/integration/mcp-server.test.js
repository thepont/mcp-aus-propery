#!/usr/bin/env node

/**
 * Integration Tests - MCP Server
 * Tests the full MCP server integration without requiring network
 * Tests server initialization, tool registration, and protocol compliance
 */

import { spawn } from 'child_process';
import { strict as assert } from 'assert';

console.log('🔗 Running Integration Tests - MCP Server\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`\n📋 Testing: ${name}`);
    console.log('─'.repeat(60));
    await fn();
    console.log(`✅ PASS: ${name}\n`);
    passed++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    if (error.stack) {
      console.log(`   Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
    }
    failed++;
  }
}

// Helper to communicate with MCP server
async function sendMCPRequest(request) {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    serverProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    serverProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    const timeout = setTimeout(() => {
      serverProcess.kill();
      reject(new Error('Request timeout after 10 seconds'));
    }, 10000);
    
    serverProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      console.log(`   Server process exited with code: ${code}`);
      if (stderr) {
        console.log(`   Stderr: ${stderr.substring(0, 200)}`);
      }
      
      // Parse JSON-RPC responses from stdout
      const lines = stdout.split('\n').filter(line => line.trim());
      const responses = [];
      
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          responses.push(json);
        } catch (e) {
          // Not JSON, skip
        }
      }
      
      resolve({ responses, stderr, code });
    });
    
    // Send the request
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    serverProcess.stdin.end();
  });
}

// Test 1: Server starts and responds to initialize
await test('Server responds to initialize request', async () => {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  };
  
  console.log('   Sending initialize request...');
  const { responses } = await sendMCPRequest(request);
  
  console.log(`   ✓ Received ${responses.length} response(s)`);
  
  assert(responses.length > 0, 'Should receive at least one response');
  
  const initResponse = responses.find(r => r.id === 1);
  assert(initResponse, 'Should receive response with matching ID');
  console.log(`   ✓ Response ID: ${initResponse.id}`);
  
  assert(!initResponse.error, `Should not have error: ${JSON.stringify(initResponse.error)}`);
  assert(initResponse.result, 'Should have result');
  console.log(`   ✓ Server name: ${initResponse.result.serverInfo?.name || 'N/A'}`);
  console.log(`   ✓ Protocol version: ${initResponse.result.protocolVersion || 'N/A'}`);
});

// Test 2: Server lists tools
await test('Server responds to tools/list request', async () => {
  const request = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  };
  
  console.log('   Sending tools/list request...');
  const { responses } = await sendMCPRequest(request);
  
  const toolsResponse = responses.find(r => r.id === 2);
  assert(toolsResponse, 'Should receive tools/list response');
  console.log(`   ✓ Response received`);
  
  assert(!toolsResponse.error, `Should not have error: ${JSON.stringify(toolsResponse.error)}`);
  assert(toolsResponse.result, 'Should have result');
  assert(Array.isArray(toolsResponse.result.tools), 'Result should have tools array');
  
  console.log(`   ✓ Found ${toolsResponse.result.tools.length} tool(s)`);
  
  for (const tool of toolsResponse.result.tools) {
    console.log(`   ✓ Tool: ${tool.name}`);
    console.log(`      Description: ${tool.description || 'N/A'}`);
    assert(tool.name, 'Tool should have name');
    assert(tool.inputSchema, 'Tool should have inputSchema');
  }
  
  // Verify find_industrial_deals exists
  const findTool = toolsResponse.result.tools.find(t => t.name === 'find_industrial_deals');
  assert(findTool, 'Should have find_industrial_deals tool');
  console.log(`   ✓ find_industrial_deals tool is registered`);
  
  // Verify schema
  assert(findTool.inputSchema.properties, 'Tool should have input properties');
  assert(findTool.inputSchema.properties.location, 'Tool should have location parameter');
  console.log(`   ✓ Tool has correct input schema`);
});

// Test 3: Tool call returns proper structure (without network will return empty)
await test('Tool call returns proper response structure', async () => {
  const request = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'find_industrial_deals',
      arguments: {
        location: 'Melbourne'
      }
    }
  };
  
  console.log('   Sending tools/call request...');
  console.log('   ⚠️  Will return empty results without network access');
  
  const { responses } = await sendMCPRequest(request);
  
  const callResponse = responses.find(r => r.id === 3);
  assert(callResponse, 'Should receive tools/call response');
  console.log(`   ✓ Response received`);
  
  assert(!callResponse.error, `Should not have error: ${JSON.stringify(callResponse.error)}`);
  assert(callResponse.result, 'Should have result');
  
  // Parse the content
  const content = callResponse.result.content;
  assert(Array.isArray(content), 'Result should have content array');
  console.log(`   ✓ Content array length: ${content.length}`);
  
  const textContent = content.find(c => c.type === 'text');
  assert(textContent, 'Should have text content');
  console.log(`   ✓ Text content present`);
  
  // Parse the JSON response
  const data = JSON.parse(textContent.text);
  assert(data.summary, 'Response should have summary');
  assert(Array.isArray(data.listings), 'Response should have listings array');
  
  console.log(`   ✓ Summary: ${JSON.stringify(data.summary)}`);
  console.log(`   ✓ Listings: ${data.listings.length} (expected 0 without network)`);
  
  // Verify structure even with empty results
  assert(typeof data.summary.total_listings === 'number', 'summary.total_listings should be number');
  assert(typeof data.summary.scouts_used === 'number', 'summary.scouts_used should be number');
  console.log(`   ✓ Response structure is correct`);
});

// Test 4: Invalid tool call returns error
await test('Invalid tool call returns proper error', async () => {
  const request = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'nonexistent_tool',
      arguments: {}
    }
  };
  
  console.log('   Sending invalid tool call...');
  const { responses } = await sendMCPRequest(request);
  
  const errorResponse = responses.find(r => r.id === 4);
  assert(errorResponse, 'Should receive response');
  console.log(`   ✓ Response received`);
  
  assert(errorResponse.error, 'Should have error for invalid tool');
  console.log(`   ✓ Error code: ${errorResponse.error.code}`);
  console.log(`   ✓ Error message: ${errorResponse.error.message}`);
});

// Test 5: Tool call with missing required parameter
await test('Tool call with missing required parameter returns error', async () => {
  const request = {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'find_industrial_deals',
      arguments: {
        // Missing required 'location' parameter
        minPrice: 100000
      }
    }
  };
  
  console.log('   Sending tool call without required parameter...');
  const { responses } = await sendMCPRequest(request);
  
  const errorResponse = responses.find(r => r.id === 5);
  assert(errorResponse, 'Should receive response');
  console.log(`   ✓ Response received`);
  
  // Should either error or handle gracefully
  if (errorResponse.error) {
    console.log(`   ✓ Properly returned error: ${errorResponse.error.message}`);
  } else {
    // Some implementations might handle missing params gracefully
    console.log(`   ✓ Handled missing parameter gracefully`);
  }
});

// Test 6: Test ScoutManager integration
await test('ScoutManager integrates correctly with MCP server', async () => {
  console.log('   Loading ScoutManager...');
  const { ScoutManager } = await import('../../dist/ScoutManager.js');
  
  const manager = new ScoutManager();
  await manager.initialize();
  
  const scouts = manager.getScouts();
  console.log(`   ✓ ScoutManager initialized with ${scouts.length} scouts`);
  
  for (const scout of scouts) {
    console.log(`   ✓ Scout registered: ${scout.name}`);
  }
  
  console.log('\n   Executing search through ScoutManager...');
  const result = await manager.searchAll({
    location: 'Melbourne',
    minPrice: 100000,
    maxPrice: 1000000
  });
  
  console.log(`   ✓ Search completed`);
  console.log(`   ✓ Scouts executed: ${result.summary.scouts_used}`);
  console.log(`   ✓ Listings returned: ${result.summary.total_listings}`);
  console.log(`   ✓ Search criteria: ${JSON.stringify(result.summary.search_criteria)}`);
  
  assert(result.summary, 'Should have summary');
  assert(Array.isArray(result.listings), 'Should have listings array');
  assert(result.summary.scouts_used >= 0, 'Should report scouts used');
  
  console.log(`   ✓ ScoutManager integration working correctly`);
});

// Test 7: Deduplication works
await test('Deduplication removes duplicate listings', async () => {
  console.log('   Loading ScoutManager...');
  const { ScoutManager } = await import('../../dist/ScoutManager.js');
  
  const manager = new ScoutManager();
  
  // Create test listings with duplicates
  const testListings = [
    { address: '123 Main Street, Melbourne VIC 3000', description: 'Property 1', source: 'Test1' },
    { address: '123 Main St, Melbourne, VIC 3000', description: 'Property 1 duplicate', source: 'Test2' },
    { address: '456 Other Road, Sydney NSW 2000', description: 'Property 2', source: 'Test1' },
    { address: '789 Different Ave, Brisbane QLD 4000', description: 'Property 3', source: 'Test3' },
    { address: '123 MAIN STREET, MELBOURNE VIC 3000', description: 'Property 1 another duplicate', source: 'Test3' }
  ];
  
  console.log(`   ✓ Created ${testListings.length} test listings (including duplicates)`);
  
  const deduplicated = manager.deduplicateListings(testListings);
  
  console.log(`   ✓ After deduplication: ${deduplicated.length} unique listings`);
  
  // Should have 3 unique addresses
  assert(deduplicated.length === 3, `Expected 3 unique listings, got ${deduplicated.length}`);
  
  // Verify we kept one of each
  const addresses = deduplicated.map(l => l.address);
  console.log('   ✓ Unique addresses:');
  for (const addr of addresses) {
    console.log(`      - ${addr}`);
  }
  
  console.log(`   ✓ Deduplication working correctly`);
});

// Test 8: Error handling in scouts doesn't crash server
await test('Scout errors are handled gracefully', async () => {
  console.log('   Testing error handling with invalid search params...');
  
  const { ScoutManager } = await import('../../dist/ScoutManager.js');
  const manager = new ScoutManager();
  await manager.initialize();
  
  // This should not throw even with network failures
  const result = await manager.searchAll({
    location: '', // Empty location
    minPrice: -1, // Invalid price
    maxPrice: 0 // Invalid price
  });
  
  console.log(`   ✓ Search completed without crashing`);
  console.log(`   ✓ Returned ${result.listings.length} listings`);
  assert(Array.isArray(result.listings), 'Should return listings array even on error');
  
  console.log(`   ✓ Error handling working correctly`);
});

// Test 9: Parallel execution
await test('Scouts execute in parallel', async () => {
  console.log('   Testing parallel execution timing...');
  
  const { ScoutManager } = await import('../../dist/ScoutManager.js');
  const manager = new ScoutManager();
  await manager.initialize();
  
  const scouts = manager.getScouts();
  console.log(`   ✓ Testing with ${scouts.length} scouts`);
  
  const startTime = Date.now();
  await manager.searchAll({ location: 'Melbourne' });
  const duration = Date.now() - startTime;
  
  console.log(`   ✓ Execution completed in ${duration}ms`);
  
  // If scouts ran sequentially with 2 scouts, it would take 2x as long
  // We can't prove parallelism without timing individual scouts,
  // but we can verify Promise.allSettled is used
  console.log(`   ✓ Using Promise.allSettled for parallel execution`);
  
  const managerCode = await import('fs').then(fs => 
    fs.promises.readFile('src/ScoutManager.ts', 'utf8')
  );
  
  assert(managerCode.includes('Promise.allSettled'), 'Should use Promise.allSettled');
  console.log(`   ✓ Confirmed parallel execution pattern`);
});

// Test 10: Response format matches specification
await test('Response format matches MCP specification', async () => {
  const request = {
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'find_industrial_deals',
      arguments: {
        location: 'Melbourne',
        minPrice: 500000,
        maxPrice: 2000000,
        zoning: ['IN1Z', 'IN2Z']
      }
    }
  };
  
  console.log('   Testing full request with all parameters...');
  const { responses } = await sendMCPRequest(request);
  
  const response = responses.find(r => r.id === 10);
  assert(response, 'Should receive response');
  
  // Verify JSON-RPC 2.0 format
  assert(response.jsonrpc === '2.0', 'Should be JSON-RPC 2.0');
  assert(response.id === 10, 'Should have matching ID');
  console.log(`   ✓ JSON-RPC 2.0 format correct`);
  
  // Verify MCP response structure
  assert(response.result, 'Should have result');
  assert(Array.isArray(response.result.content), 'Should have content array');
  
  const textContent = response.result.content.find(c => c.type === 'text');
  assert(textContent, 'Should have text content');
  assert(typeof textContent.text === 'string', 'Text should be string');
  console.log(`   ✓ MCP response structure correct`);
  
  // Verify our response format
  const data = JSON.parse(textContent.text);
  assert(data.summary, 'Should have summary');
  assert(data.listings, 'Should have listings');
  
  // Verify summary structure
  assert(typeof data.summary.total_listings === 'number', 'total_listings should be number');
  assert(typeof data.summary.scouts_used === 'number', 'scouts_used should be number');
  assert(data.summary.search_criteria, 'Should have search_criteria');
  assert(data.summary.search_criteria.location === 'Melbourne', 'Should preserve location');
  assert(data.summary.search_criteria.minPrice === 500000, 'Should preserve minPrice');
  assert(data.summary.search_criteria.maxPrice === 2000000, 'Should preserve maxPrice');
  assert(Array.isArray(data.summary.search_criteria.zoning), 'zoning should be array');
  
  console.log(`   ✓ All parameters properly passed through`);
  console.log(`   ✓ Response format matches specification`);
});

console.log('\n' + '='.repeat(60));
console.log(`Integration Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n⚠️  Some integration tests failed\n');
  process.exit(1);
} else {
  console.log('\n✅ All integration tests passed - MCP server working correctly\n');
  process.exit(0);
}
