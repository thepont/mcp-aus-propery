#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = join(__dirname, 'dist', 'index.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'development' }
});

let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  if (buffer.endsWith('\n')) buffer = ''; else buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 && msg.result) {
          console.log('\n✅ RESPONSE RECEIVED');
          const text = JSON.parse(msg.result.content[0].text);
          console.log(JSON.stringify(text.summary, null, 2));
          const sources = [...new Set(text.listings.map(l => l.source))];
          console.log(`📍 Sources found: ${sources.join(', ')}`);
          server.kill();
          process.exit(0);
      }
    } catch (e) {}
  }
});

server.stderr.on('data', (data) => {
    console.log(data.toString().trim());
});

function send(obj) {
    server.stdin.write(JSON.stringify(obj) + '\n');
}

setTimeout(() => {
    console.log('🚀 Starting Final Verification (Domain + Commercial)...');
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    setTimeout(() => {
        // Test Residential Ballarat
        send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_properties", arguments: { location: "Ballarat", listingType: "sale" } } });
    }, 1000);
}, 1000);

setTimeout(() => { console.error('❌ Timeout'); server.kill(); process.exit(1); }, 120000);
