#!/usr/bin/env node
// Simple test to verify the MCP server can start and respond
import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js']);
let serverPid = server.pid;

server.stderr.on('data', (data) => {
  const log = data.toString();
  console.log('Server:', log.trim());
  
  if (log.includes('running on stdio')) {
    console.log('\n✅ SERVER STARTED SUCCESSFULLY!');
    process.kill(serverPid, 'SIGTERM');
    process.exit(0);
  }
});

server.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error('❌ Server failed to start');
    process.exit(1);
  }
});

setTimeout(() => {
  console.error('❌ Server startup timeout');
  process.kill(serverPid, 'SIGTERM');
  process.exit(1);
}, 5000);
