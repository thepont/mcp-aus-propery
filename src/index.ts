#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ScoutManager } from './ScoutManager.js';
import { GnafService } from './services/GnafService.js';
import { CbreScout } from './scouts/CbreScout.js';
import { CameronScout } from './scouts/CameronScout.js';
import { SearchParams } from './types.js';

/**
 * Universal Industrial Property Scout MCP Server
 * Provides the find_industrial_deals tool for LLM-based property analysis
 */
class IndustrialPropertyMcpServer {
  private server: Server;
  private scoutManager: ScoutManager;
  private gnafService: GnafService;

  constructor() {
    this.server = new Server(
      {
        name: 'industrial-property-scout',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.scoutManager = new ScoutManager();
    this.gnafService = new GnafService();
    
    // Scouts are auto-registered from the scouts directory
    // Manual registration is also supported: this.scoutManager.registerScout(new CbreScout());

    this.setupHandlers();
    this.setupErrorHandling();
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'find_properties',
          description:
            'Search for properties across multiple Australian real estate agencies. ' +
            'Filter by property type (residential, commercial, industrial) and listing type (sale, rental). ' +
            'Returns detailed listings including address, zoning, full descriptions, and source URLs. ' +
            'Executes all registered scouts in parallel for comprehensive coverage.',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'Location: suburb or region (e.g., "Parramatta", "Western Sydney")',
              },
              lat: {
                type: 'number',
                description: 'Latitude for radius search (optional)',
              },
              lon: {
                type: 'number',
                description: 'Longitude for radius search (optional)',
              },
              radius: {
                type: 'number',
                description: 'Radius in kilometers (optional, defaults to 5km if lat/lon provided)',
              },
              propertyType: {
                type: 'string',
                enum: ['residential', 'commercial', 'industrial', 'land', 'rural'],
                description: 'Property type filter (optional). Options: residential, commercial, industrial, land, rural',
              },
              listingType: {
                type: 'string',
                enum: ['sale', 'rental'],
                description: 'Listing type filter (optional). Options: sale, rental',
              },
              minPrice: {
                type: 'number',
                description: 'Minimum price in AUD (optional)',
              },
              maxPrice: {
                type: 'number',
                description: 'Maximum price in AUD (optional)',
              },
              zoning: {
                type: 'array',
                items: { type: 'string' },
                description: 'Zoning codes (e.g., ["IN1Z", "IN2Z", "IN3Z"]) (optional)',
              },
              useCacheOnly: {
                type: 'boolean',
                description: 'If true, only return results already in the database without triggering fresh searches. (optional)',
              },
            },
            required: ['location'],
          },
        },
        {
          name: 'get_market_penetration',
          description: 'Calculate the percentage of G-NAF parcels in a suburb that are currently listed on Domain.',
          inputSchema: {
            type: 'object',
            properties: {
              suburb: {
                type: 'string',
                description: 'Suburb name to analyze (e.g., "Richmond", "Parramatta")',
              },
            },
            required: ['suburb'],
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments as any;

      if (request.params.name === 'find_properties') {
        if (!args.location || typeof args.location !== 'string') {
          throw new Error('Missing required parameter: location');
        }

        let searchParams: SearchParams = {
          location: args.location,
          lat: args.lat,
          lon: args.lon,
          radius: args.radius,
          propertyType: args.propertyType,
          listingType: args.listingType,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          zoning: args.zoning,
        };

        // 1. Enrichment Phase: Get Area Context from G-NAF if lat/lon missing
        if (!searchParams.lat || !searchParams.lon) {
          console.error(`[MCP Server] Looking up area context for: ${searchParams.location}`);
          const areaContext = await this.gnafService.getAreaContext(searchParams.location);
          if (areaContext) {
            console.error(`[MCP Server] Resolved ${searchParams.location} to:`, areaContext);
            searchParams.lat = areaContext.lat;
            searchParams.lon = areaContext.lon;
            searchParams.radius = areaContext.radius;
          }
        }

        console.error(`[MCP Server] Searching for properties with criteria:`, searchParams);

        // 2. Local Database Search (Immediate)
        let dbListings = await this.scoutManager.getExistingProperties(searchParams);
        console.error(`[MCP Server] Found ${dbListings.length} matching properties in local DB.`);

        // 3. On-Demand Scout Search (Refresh) - Only if not useCacheOnly
        let freshCount = 0;
        if (!args.useCacheOnly) {
          const freshListings = await this.scoutManager.findProperties(searchParams);
          freshCount = freshListings.length;
          console.error(`[Fresh Search] Scouts found ${freshCount} properties.`);
        }

        // 4. Final Results from DB (includes newly indexed)
        const finalResults = await this.scoutManager.getExistingProperties(searchParams);

        // Map results to ensure source is clearly visible
        const listingsWithSource = finalResults.map(l => ({
          address: l.address,
          source: l.source,
          price: l.priceDisplay || l.price,
          type: l.propertyType,
          listing: l.listingType,
          url: l.sourceUrl,
          description: l.description.substring(0, 200) + '...'
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary: {
                  total_results: finalResults.length,
                  freshly_discovered: freshCount,
                  cache_only: !!args.useCacheOnly,
                  area_resolved: searchParams.lat ? { lat: searchParams.lat, lon: searchParams.lon, radius: searchParams.radius } : null,
                  scouts_used: await this.scoutManager.getScoutNames(),
                },
                listings: listingsWithSource,
              }, null, 2),
            },
          ],
        };
      } 
      
      if (request.params.name === 'get_market_penetration') {
        if (!args.suburb || typeof args.suburb !== 'string') {
          throw new Error('Missing required parameter: suburb');
        }

        console.error(`[MCP Server] Calculating market penetration for: ${args.suburb}`);
        const result = await this.gnafService.getMarketPenetration(args.suburb);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Server] Error:', error);
    };

    process.on('SIGINT', async () => {
      console.error('[MCP Server] Shutting down...');
      await this.scoutManager.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('[MCP Server] Shutting down...');
      await this.scoutManager.cleanup();
      process.exit(0);
    });
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    // Initialize G-NAF service (Schema, FTS, Connection)
    await this.gnafService.init();
    
    // Attempt to ingest G-NAF data if available
    await this.gnafService.autoIngest();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('[MCP Server] Industrial Property Scout MCP Server running on stdio');
    
    // Trigger background sync ONLY if explicitly enabled
    if (process.env.ENABLE_BACKGROUND_SYNC === 'true') {
      this.triggerInitialSync();
    } else {
      console.error('[MCP Server] Background sync disabled by default. Set ENABLE_BACKGROUND_SYNC=true to enable.');
    }
  }

  private triggerInitialSync(): void {
    console.error('[MCP Server] Initializing background data synchronization...');
    
    // Fire and forget background sync
    this.scoutManager.findProperties({ location: 'Any' })
      .then(listings => {
        console.error(`[MCP Server] Initial background sync complete. Processed ${listings.length} listings.`);
      })
      .catch(err => {
        console.error('[MCP Server] Background sync error:', err);
      });
  }
}

// Start the server
const server = new IndustrialPropertyMcpServer();
server.start().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
