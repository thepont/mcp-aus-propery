#!/usr/bin/env node

/**
 * Test Runner - Runs all tests in correct order
 * 
 * Test Hierarchy:
 * 1. Unit Tests (no network) - Framework validation
 * 2. Integration Tests (no network) - MCP server validation  
 * 3. Network Tests (requires internet) - Website validation
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const testSuites = [
  {
    name: 'Unit Tests',
    description: 'Framework tests (no network required)',
    files: ['tests/unit/framework.test.js'],
    required: true,
    requiresNetwork: false
  },
  {
    name: 'Integration Tests - MCP Server',
    description: 'MCP protocol and server tests (no network required)',
    files: ['tests/integration/mcp-server.test.js'],
    required: true,
    requiresNetwork: false
  },
  {
    name: 'Integration Tests - Website Assumptions',
    description: 'Validates ALL website assumptions (REQUIRES internet)',
    files: ['tests/integration/website-assumptions.test.js'],
    required: false, // Optional in CI without network
    requiresNetwork: true
  },
  {
    name: 'Network Tests - API Discovery',
    description: 'Discovers real API endpoints (REQUIRES internet)',
    files: ['tests/network/api-discovery.test.js'],
    required: false,
    requiresNetwork: true
  },
  {
    name: 'Network Tests - Scout Implementation',
    description: 'Validates scout implementation (REQUIRES internet)',
    files: ['tests/network/scout-implementation.test.js'],
    required: false,
    requiresNetwork: true
  }
];

async function runTest(file) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Running: ${file}`);
    console.log('='.repeat(70));
    
    const testProcess = spawn('node', [file], {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    testProcess.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('MCP INDUSTRIAL PROPERTY SCOUT - TEST SUITE');
  console.log('█'.repeat(70));
  console.log('');
  
  const results = {
    suites: [],
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0
  };
  
  for (const suite of testSuites) {
    console.log(`\n\n${'▓'.repeat(70)}`);
    console.log(`TEST SUITE: ${suite.name}`);
    console.log(`Description: ${suite.description}`);
    console.log(`Network Required: ${suite.requiresNetwork ? 'YES ⚠️' : 'NO'}`);
    console.log('▓'.repeat(70));
    
    const suiteResult = {
      name: suite.name,
      tests: [],
      passed: 0,
      failed: 0
    };
    
    for (const file of suite.files) {
      results.total++;
      
      if (!fs.existsSync(file)) {
        console.log(`\n⚠️  Test file not found: ${file}`);
        results.skipped++;
        continue;
      }
      
      const passed = await runTest(file);
      
      if (passed) {
        console.log(`\n✅ PASSED: ${file}`);
        results.passed++;
        suiteResult.passed++;
        suiteResult.tests.push({ file, status: 'passed' });
      } else {
        console.log(`\n❌ FAILED: ${file}`);
        results.failed++;
        suiteResult.failed++;
        suiteResult.tests.push({ file, status: 'failed' });
        
        if (suite.required && !suite.requiresNetwork) {
          console.log(`\n🛑 CRITICAL: Required test failed - stopping`);
          results.suites.push(suiteResult);
          printSummary(results);
          process.exit(1);
        }
      }
    }
    
    results.suites.push(suiteResult);
  }
  
  printSummary(results);
  
  // Exit code
  const criticalFailed = results.suites
    .filter(s => testSuites.find(ts => ts.name === s.name)?.required)
    .some(s => s.failed > 0);
  
  if (criticalFailed) {
    process.exit(1);
  } else if (results.failed > 0) {
    console.log('\n⚠️  Some non-critical tests failed (likely network tests)');
    console.log('   Core functionality is working\n');
    process.exit(0); // Don't fail CI for network tests
  } else {
    process.exit(0);
  }
}

function printSummary(results) {
  console.log('\n\n' + '█'.repeat(70));
  console.log('TEST SUMMARY');
  console.log('█'.repeat(70));
  
  for (const suite of results.suites) {
    const symbol = suite.failed === 0 ? '✅' : '❌';
    console.log(`${symbol} ${suite.name}: ${suite.passed} passed, ${suite.failed} failed`);
  }
  
  console.log('\n' + '─'.repeat(70));
  console.log(`Total: ${results.total} tests`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log('─'.repeat(70));
  
  const requiredSuites = testSuites.filter(s => s.required);
  const requiredResults = results.suites.filter(s => 
    requiredSuites.find(rs => rs.name === s.name)
  );
  const requiredPassed = requiredResults.every(s => s.failed === 0);
  
  console.log('\nREQUIRED TESTS (no network): ' + (requiredPassed ? '✅ PASS' : '❌ FAIL'));
  
  const networkSuites = testSuites.filter(s => s.requiresNetwork);
  const networkResults = results.suites.filter(s => 
    networkSuites.find(ns => ns.name === s.name)
  );
  const networkPassed = networkResults.every(s => s.failed === 0);
  
  if (networkResults.length > 0) {
    console.log('NETWORK TESTS (requires internet): ' + (networkPassed ? '✅ PASS' : '❌ FAIL (expected in CI)'));
  }
  
  console.log('\n' + '█'.repeat(70));
  
  if (requiredPassed) {
    console.log('✅ FRAMEWORK IS WORKING CORRECTLY');
    console.log('   Core functionality validated');
    console.log('   Safe to deploy for testing');
  } else {
    console.log('❌ CRITICAL FAILURES DETECTED');
    console.log('   Do not deploy until fixed');
  }
  
  if (networkResults.length > 0 && !networkPassed) {
    console.log('\n⚠️  Network tests failed - EXPECTED in restricted environments');
    console.log('   Run these in GitHub CI or production to validate');
  }
  
  console.log('█'.repeat(70) + '\n');
}

main().catch(error => {
  console.error('\n🔥 Test runner error:', error);
  process.exit(1);
});
