#!/usr/bin/env node

/**
 * Test script for the Industrial Property Scout MCP Server
 * Simulates MCP client requests to test the server functionality
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Start the MCP server
const serverPath = join(__dirname, 'dist', 'index.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'development' }
});

let responseBuffer = '';
let requestId = 1;

// Setup response handler
server.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  
  // Try to parse complete JSON-RPC messages
  const lines = responseBuffer.split('\n');
  responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log('\n📩 Received response:');
        console.log(JSON.stringify(response, null, 2));
        
        // Exit after getting search results
        if (response.result && response.result.content) {
          console.log('\n✅ MCP Server test completed successfully!');
          server.kill();
          process.exit(0);
        }
      } catch (e) {
        // Ignore parse errors for partial messages
      }
    }
  }
});

server.stderr.on('data', (data) => {
  console.log('📝 Server log:', data.toString().trim());
});

server.on('close', (code) => {
  console.log(`\n🏁 Server exited with code ${code}`);
});

// Send initialization request
function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params
  };
  
  console.log('\n📤 Sending request:');
  console.log(JSON.stringify(request, null, 2));
  
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Wait for server to start, then send requests
setTimeout(() => {
  console.log('\n🚀 Testing MCP Server...\n');
  
  // 1. Initialize
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  });
  
  setTimeout(() => {
    // 2. List tools
    sendRequest('tools/list');
    
    setTimeout(() => {
      // 3. Call find_industrial_deals tool
      sendRequest('tools/call', {
        name: 'find_industrial_deals',
        arguments: {
          location: 'Sydney',
          maxPrice: 5000000
        }
      });
    }, 1000);
  }, 1000);
}, 2000);

// Timeout after 60 seconds
setTimeout(() => {
  console.error('\n❌ Test timed out after 60 seconds');
  server.kill();
  process.exit(1);
}, 60000);
