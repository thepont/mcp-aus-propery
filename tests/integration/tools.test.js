#!/usr/bin/env node

/**
 * System Integration Tests
 * Runs real MCP tool calls against the built server.
 * REQUIRES NETWORK ACCESS.
 */

import { spawn } from 'child_process';
import { strict as assert } from 'assert';

console.log('🔗 Running System Integration Tests (Real Tool Execution)\n');

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

function runToolCall(toolName, args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const server = spawn('node', ['dist/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const request = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: args
            }
        };

        let stdoutBuffer = '';
        let result = null;
        let logs = [];

        const timer = setTimeout(() => {
            server.kill();
            reject(new Error(`Timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        server.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            let newlineIndex;
            while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
                const line = stdoutBuffer.substring(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
                if (!line) continue;

                try {
                    const json = JSON.parse(line);
                    if (json.result) {
                        result = json;
                        server.kill(); // We got our answer
                    }
                } catch (e) { } // Ignore JSON parse errors
            }
        });

        server.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) logs.push(line.trim());
            }
        });

        server.on('close', (code) => {
            clearTimeout(timer);
            if (result) {
                resolve({ result: result.result, logs });
            } else {
                reject(new Error(`Server exited with code ${code} without returning result. Logs:\n${logs.slice(-5).join('\n')}`));
            }
        });

        server.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        // Send request
        server.stdin.write(JSON.stringify(request) + '\n');
        server.stdin.end();
    });
}

// Test 1: get_property_estimate
await test('get_property_estimate returns valid data with sources', async () => {
    const { result, logs } = await runToolCall('get_property_estimate', { 
        address: '9 Goulburn Street Nagambie VIC 3608' 
    });

    // Parse inner JSON content
    const contentText = result.content[0].text;
    const data = JSON.parse(contentText);

    // Assertions
    assert(data.address.includes('Nagambie'), 'Address should match');
    assert(data.estimate, 'Should have estimate');
    assert(data.sources, 'Should have sources array');
    assert(Array.isArray(data.sources), 'Sources should be an array');
    assert(data.sources.length > 0, 'Should have at least one source');
    assert(data.sources[0].name, 'Source should have a name');
    assert(data.sources[0].url, 'Source should have a url');
    
    console.log(`   ✓ Retrieved estimate: ${data.estimate.range}`);
    console.log(`   ✓ Source: ${data.sources[0].name}`);
});

// Test 2: get_suburb_trends
await test('get_suburb_trends returns combined data with sources', async () => {
    const { result } = await runToolCall('get_suburb_trends', { 
        suburb: 'Nagambie' 
    });

    const contentText = result.content[0].text;
    const data = JSON.parse(contentText);

    assert(Array.isArray(data), 'Result should be an array of trend objects');
    assert(data.length >= 1, 'Should have at least one trend result');

    let sourcesFound = 0;
    for (const item of data) {
        assert(item.suburb, 'Item should have suburb');
        assert(item.sources, 'Item should have sources');
        if (item.sources.length > 0) sourcesFound++;
        
        console.log(`   ✓ Found data from: ${item.source}`);
        if (item.coreLogicMetrics) {
            console.log(`     - Has CoreLogic Metrics`);
        }
        if (item.metrics) {
            console.log(`     - Has Extracted Metrics: Median Price ${item.metrics.medianValue}`);
        }
    }

    assert(sourcesFound > 0, 'Should have sources in at least one item');
});

// Summary
console.log('\n' + '='.repeat(60));
console.log(`Integration Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);
process.exit(0);
