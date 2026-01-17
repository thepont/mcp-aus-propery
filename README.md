# Universal Industrial Property Scout MCP Server

A Model Context Protocol (MCP) server that searches for industrial properties across multiple Australian real estate agencies. Built with TypeScript, it provides LLMs with comprehensive property data including full descriptions for technical analysis.

> **⚠️ IMPORTANT STATUS**: This is a **framework implementation**. The scouts attempt to connect to real websites but use speculative API endpoints that don't actually exist. For production use, real web scraping logic with actual HTML selectors and proper website navigation must be implemented. The domains are correct, but the API endpoints and scraping selectors are placeholders. See `CONNECTION_FAILURE_ANALYSIS.md` for complete details.

## Architecture

### Registry Pattern
- **ScoutManager**: Orchestrates all agency scouts, auto-discovers scouts from `/scouts` directory
- **BaseScout**: Abstract class defining the standard interface for all scouts
- **Modular Scouts**: Each agency implements a scout with hybrid fetch logic (API → JSON-LD → HTML scraping)

### Data Flow
1. LLM calls `find_industrial_deals` tool with search criteria
2. ScoutManager executes all registered scouts in parallel (`Promise.allSettled`)
3. Results are deduplicated by normalized address
4. Aggregate JSON is returned to LLM for analysis

## Features

- ✅ **Parallel Execution**: All scouts run concurrently for fast results
- ✅ **Hybrid Fetching**: Prioritizes APIs and JSON-LD over HTML scraping (framework ready)
- ✅ **Deduplication**: Normalizes addresses to prevent duplicate listings
- ✅ **Full Descriptions**: Returns complete property descriptions for LLM analysis
- ✅ **Extensible**: Easy to add new agency scouts
- ✅ **Dockerized**: Multi-stage build with Node.js 22 and Playwright
- ⚠️ **Production Ready**: Framework is complete, but needs real website-specific scraping logic

## Currently Supported Agencies

- **CBRE Australia** (cbre.com.au) 
  - Domain: ✅ Correct
  - Implementation: ⚠️ Framework only (speculative API endpoints)
  - Needs: Real HTML selectors and navigation logic
  
- **Cameron Real Estate** (cameron.com.au)
  - Domain: ✅ Correct (Melbourne commercial/industrial)
  - Implementation: ⚠️ Framework only (speculative API endpoints)
  - Needs: Real HTML selectors and navigation logic

## Installation

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run the server
npm start
```

### Docker

```bash
# Build the Docker image
docker build -t mcp-industrial-scout .

# Run the container (stdio communication)
docker run -i mcp-industrial-scout
```

## MCP Tool: `find_industrial_deals`

### Inputs
- `location` (required): Suburb or region (e.g., "Parramatta", "Western Sydney")
- `minPrice` (optional): Minimum price in AUD
- `maxPrice` (optional): Maximum price in AUD
- `zoning` (optional): Array of zoning codes (e.g., ["IN1Z", "IN2Z", "IN3Z"])

### Output
Returns a JSON object containing:
- `summary`: Search metadata (total listings, scouts used, criteria)
- `listings`: Array of industrial property listings

Each listing includes:
- `address`: Property address
- `zoning`: Zoning classification (if available)
- `description`: Full property description for LLM analysis
- `sourceUrl`: Link to the listing
- `price`/`priceDisplay`: Price information
- `area`: Property area in sqm
- `source`: Agency name

## Adding New Scouts

1. Create a new scout class in `src/scouts/` that extends `BaseScout`
2. Implement the `search(criteria: SearchParams)` method
3. Return an array of `IndustrialListing` objects
4. The ScoutManager will auto-register it on startup

Example:

```typescript
import { BaseScout, SearchParams, IndustrialListing } from '../types/index.js';

export class MyAgencyScout extends BaseScout {
  readonly name = 'My Agency';

  async search(criteria: SearchParams): Promise<IndustrialListing[]> {
    // Implement search logic
    return [];
  }
}
```

## Technical Stack

- **Runtime**: Node.js 22
- **Language**: TypeScript 5.3
- **MCP SDK**: @modelcontextprotocol/sdk
- **HTTP Client**: axios
- **Browser Automation**: Playwright (Chromium)
- **Container**: Docker (multi-stage build)

## License

MIT