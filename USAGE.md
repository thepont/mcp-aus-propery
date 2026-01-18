# Usage Guide: Universal Industrial Property Scout MCP Server

## Quick Start

### 1. Local Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build the project
npm run build

# Run the MCP server
npm start
```

### 2. Testing the Server

Run the included test script to verify the server works:

```bash
node test-server.js
```

Expected output:
- ✅ Server initialization
- ✅ Tool registration (find_industrial_deals)
- ✅ Tool execution with search results

### 3. Using with MCP Client

The server communicates via stdio using the MCP protocol. Example JSON-RPC messages:

**Initialize:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "your-client",
      "version": "1.0.0"
    }
  }
}
```

**List Tools:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Call Tool:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "find_industrial_deals",
    "arguments": {
      "location": "Sydney",
      "maxPrice": 5000000,
      "zoning": ["IN1Z", "IN2Z"]
    }
  }
}
```

## Tool Reference

### `find_industrial_deals`

Search for industrial properties across Australian real estate agencies.

**Parameters:**
- `location` (required): Suburb or region (e.g., "Parramatta", "Western Sydney")
- `minPrice` (optional): Minimum price in AUD
- `maxPrice` (optional): Maximum price in AUD  
- `zoning` (optional): Array of zoning codes (e.g., ["IN1Z", "IN2Z", "IN3Z"])

**Returns:**
```json
{
  "summary": {
    "total_listings": 10,
    "scouts_used": ["CBRE Australia"],
    "search_criteria": {
      "location": "Sydney",
      "maxPrice": 5000000
    }
  },
  "listings": [
    {
      "address": "123 Industrial St, Sydney NSW",
      "zoning": "IN1Z",
      "description": "Modern warehouse facility...",
      "sourceUrl": "https://...",
      "price": 4500000,
      "priceDisplay": "$4,500,000",
      "area": 5000,
      "source": "CBRE Australia",
      "metadata": {}
    }
  ]
}
```

## Docker Usage

### Build the Image

```bash
docker build -t mcp-industrial-scout .
```

### Run the Container

```bash
# Interactive mode (stdin/stdout)
docker run -i mcp-industrial-scout

# With mounted volume for custom scouts
docker run -i -v $(pwd)/custom-scouts:/app/dist/scouts mcp-industrial-scout
```

### Docker Compose

```yaml
version: '3.8'
services:
  mcp-scout:
    image: mcp-industrial-scout
    stdin_open: true
    tty: false
```

## Adding Custom Scouts

1. Create a new scout file in `src/scouts/` directory:

```typescript
import { BaseScout, SearchParams, IndustrialListing } from '../types.js';
import axios from 'axios';

export class MyAgencyScout extends BaseScout {
  readonly name = 'My Real Estate Agency';

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    const listings: IndustrialListing[] = [];
    
    try {
      // Implement your search logic here
      // 1. Try API fetch first
      // 2. Fall back to Playwright if needed
      // 3. Extract JSON-LD if available
      
      const response = await axios.get(`https://api.myagency.com/search`, {
        params: {
          location: criteria.location,
          type: 'industrial'
        }
      });
      
      for (const prop of response.data.properties) {
        listings.push({
          address: prop.address,
          zoning: prop.zoning,
          description: prop.description,
          sourceUrl: prop.url,
          price: prop.price,
          area: prop.area,
          source: this.name
        });
      }
    } catch (error) {
      console.error(`[${this.name}] Search failed:`, error);
    }
    
    return listings;
  }
}
```

2. Rebuild the project:

```bash
npm run build
```

3. The ScoutManager will automatically discover and register your new scout!

## Configuration

### Environment Variables

- `NODE_ENV`: Set to `production` for production use
- No authentication tokens required by default (scouts use public data)

### Playwright Configuration

The server uses Playwright for browser automation fallback:
- Browser: Chromium (headless)
- Sandboxing: Disabled for Docker compatibility
- User Agent: Mozilla/5.0 (mimics real browser)

## Troubleshooting

### Playwright Browser Not Found

```bash
# Install browsers
npx playwright install chromium --with-deps
```

### Network/API Errors

- Check internet connectivity
- Verify agency websites are accessible
- Some agencies may block automated requests

### Memory Issues in Docker

Add memory limits to Docker:
```bash
docker run -i --memory="2g" mcp-industrial-scout
```

## Architecture Overview

```
┌─────────────────┐
│   MCP Client    │ (LLM/AI Assistant)
│   (stdio)       │
└────────┬────────┘
         │
         ├─JSON-RPC 2.0
         │
┌────────▼────────────┐
│   MCP Server        │
│   (index.ts)        │
└────────┬────────────┘
         │
         ├──────────────┐
         │              │
┌────────▼────┐  ┌──────▼──────┐
│ScoutManager │  │   Tools     │
│(orchestrate)│  │  Registry   │
└────────┬────┘  └─────────────┘
         │
    ┌────┴────┬────────┬───────┐
    │         │        │       │
┌───▼───┐ ┌──▼───┐ ┌──▼───┐ ┌─▼────┐
│ CBRE  │ │Scout2│ │Scout3│ │ ...  │
│Scout  │ │      │ │      │ │      │
└───┬───┘ └──────┘ └──────┘ └──────┘
    │
    ├──API Fetch
    ├──JSON-LD Extract
    └──Playwright (fallback)
```

## Performance Notes

- **Parallel Execution**: All scouts run simultaneously
- **Deduplication**: Results are deduplicated by normalized address
- **Caching**: No built-in caching (implement at client level if needed)
- **Rate Limiting**: Respects agency rate limits (built into scouts)

## License

MIT - See LICENSE file for details