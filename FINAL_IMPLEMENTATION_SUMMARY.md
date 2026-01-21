# Property Intelligence Engine - Final Summary

## Architecture Overview

This project has been refactored into a robust **Property Intelligence Engine** powered by **SQLite** (via `better-sqlite3`). It serves as a Model Context Protocol (MCP) server that aggregates property data from multiple sources, standardizes addresses against the **G-NAF** (Geocoded National Address File) reference, and provides market analytics.

### Key Components

1.  **Storage Engine (`src/services/DuckDBService.ts` & `src/services/GnafService.ts`)**
    *   **`mcp.db`**: A single SQLite database (WAL mode) storing both "Canonical" G-NAF reference data and "Transient" market listings.
    *   **Full-Text Search (FTS5)**: Addresses are indexed using SQLite's FTS5 extension for fuzzy matching and resolution.

2.  **Scout Swarm (`src/scouts/*`)**
    *   **`PRDScout`**: Robust sitemap-based crawler. Discovers offices via the corporate sitemap, builds a persistent URL queue, and deeply scrapes listings using Adfenix tags and JSON-LD.
    *   **`FirstNationalScout`**: Similar sitemap-based crawler. Iterates numbered sitemaps to discover listings and parses detailed JSON-LD.
    *   **`DomainScout`**: "Synchronizer" scout. Fetches Domain.com.au sitemaps and links discovered listings to G-NAF PIDs in `mcp.db`, tracking market presence over time.

3.  **Address Resolution & Analytics**
    *   **Resolution**: Matches scraping results to unique G-NAF PIDs using FTS5 `MATCH` queries.
    *   **Market Penetration**: Calculates the % of properties in a suburb currently listed on Domain.

## Setup & Usage

### 1. Prerequisites
*   Docker & Docker Compose
*   A copy of the **G-NAF Core CSV** file.

### 2. Ingesting G-NAF Data
The system is designed to auto-ingest G-NAF data on first startup.

1.  Place your G-NAF CSV file at `mcp-aus-propery/data/gnaf.csv`.
2.  Start the container:
    ```bash
    docker-compose up -d --build
    ```
3.  The server will detect the empty database and the CSV file, then automatically ingest ~14M records into SQLite and build the FTS5 index. This is performant and reliable.

### 3. Running Scrapers
The scouts are triggered via the MCP tool `find_properties`. You can trigger this via your MCP client (e.g., Claude Desktop, Cursor) or by running a script.

*   **Incremental Crawling**: Scouts like PRD and First National run in "incremental batches" (e.g., 5-10 listings per run) to avoid rate limits. Repeated calls will continue deeper into the sitemaps.
*   **State Persistence**: Scraper progress is saved to `data/*.json` files, ensuring they resume where they left off after restarts.

### 4. Available MCP Tools

*   **`find_properties(location, ...)`**: Triggers the scout swarm.
    *   **Geo-Spatial Search**: Supports `lat`, `lon`, and `radius` parameters to find properties within X km of a point. Uses SQLite custom `haversine_distance` function.
    *   **Full Text Search**: Uses FTS5 for `location` keyword matching (e.g. "warehouse in Sydney").
*   **`get_market_penetration(suburb)`**: Returns analytics for a specific suburb (Total Parcels vs. Active Domain Listings).

## File Structure

*   `src/services/GnafService.ts`: Core G-NAF logic (Ingest, Resolve, Analytics) using SQLite + FTS5.
*   `src/services/Database.ts`: Singleton SQLite connection manager.
*   `src/DuckDBService.ts`: Legacy name, handles Listing storage/search via SQLite.
*   `src/scouts/DomainScout.ts`: Domain synchronization logic.
*   `src/scouts/PRDScout.ts` & `src/scouts/FirstNationalScout.ts`: Agent scrapers.
*   `ingest-gnaf.js`: Utility script for manual ingestion.

## Troubleshooting

*   **Docker Platform**: The system uses `node:20-bookworm-slim` which is stable on both ARM64 and AMD64.
*   **Rate Limits**: Scouts are configured with ~6s delays. Adjust `RATE_LIMIT_MS` in the scout files if needed.