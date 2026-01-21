const { spawn } = require('child_process');

async function test() {
  console.log('Testing MCP Server via Docker Exec...');
  
  const child = spawn('docker', ['exec', '-i', 'mcp-industrial-scout', 'node', 'dist/index.js']);

  child.stdout.on('data', (data) => {
    console.log(`[Server stdout]: ${data.toString()}`);
  });

  child.stderr.on('data', (data) => {
    console.log(`[Server stderr]: ${data.toString()}`);
  });

  // Send listTools request
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list"
  };

  console.log('Sending tools/list request...');
  child.stdin.write(JSON.stringify(request) + '\n');

  // Wait a bit then exit
  setTimeout(() => {
    child.kill();
    process.exit(0);
  }, 10000);
}

test();

