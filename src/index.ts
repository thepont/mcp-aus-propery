#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ScoutManager } from './ScoutManager.js';
import { CbreScout } from './scouts/CbreScout.js';
import { SearchParams } from './types.js';

/**
 * Universal Industrial Property Scout MCP Server
 * Provides the find_industrial_deals tool for LLM-based property analysis
 */
class IndustrialPropertyMcpServer {
  private server: Server;
  private scoutManager: ScoutManager;

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
    
    // Manually register CBRE scout (auto-registration also works)
    this.scoutManager.registerScout(new CbreScout());

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
          name: 'find_industrial_deals',
          description: 
            'Search for industrial properties across multiple Australian real estate agencies. ' +
            'Returns detailed listings including address, zoning, full descriptions, and source URLs. ' +
            'Executes all registered scouts in parallel for comprehensive coverage.',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'Location: suburb or region (e.g., "Parramatta", "Western Sydney")',
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
            },
            required: ['location'],
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'find_industrial_deals') {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      const args = request.params.arguments as any;
      
      if (!args.location || typeof args.location !== 'string') {
        throw new Error('Missing required parameter: location');
      }

      const searchParams: SearchParams = {
        location: args.location,
        minPrice: args.minPrice,
        maxPrice: args.maxPrice,
        zoning: args.zoning,
      };

      console.error(`[MCP Server] Executing find_industrial_deals with params:`, searchParams);

      const listings = await this.scoutManager.findIndustrialDeals(searchParams);

      console.error(`[MCP Server] Returning ${listings.length} listings to LLM`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: {
                total_listings: listings.length,
                scouts_used: this.scoutManager.getScoutNames(),
                search_criteria: searchParams,
              },
              listings: listings,
            }, null, 2),
          },
        ],
      };
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Server] Industrial Property Scout MCP Server running on stdio');
    console.error(`[MCP Server] Registered scouts: ${this.scoutManager.getScoutNames().join(', ')}`);
  }
}

// Start the server
const server = new IndustrialPropertyMcpServer();
server.start().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
