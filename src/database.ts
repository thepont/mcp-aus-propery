import Database from 'better-sqlite3';
import { IndustrialListing } from './types.js';
import path from 'path';
import fs from 'fs';

/**
 * SQLite database manager for storing scraped property listings
 * 
 * Features:
 * - Stores all scraped properties with full metadata
 * - Tracks lat/long coordinates for mapping
 * - Prevents duplicates by URL
 * - Maintains scrape history
 * - Supports queries by location, price, etc.
 */
export class PropertyDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string = './data/properties.db') {
    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.initializeDatabase();
    
    console.error(`[Database] Initialized at ${dbPath}`);
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    // Main properties table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url TEXT UNIQUE NOT NULL,
        source_name TEXT NOT NULL,
        address TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        zoning TEXT,
        description TEXT,
        price REAL,
        price_display TEXT,
        area REAL,
        metadata TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        scrape_count INTEGER DEFAULT 1
      )
    `);

    // Index for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_source_url ON properties(source_url);
      CREATE INDEX IF NOT EXISTS idx_source_name ON properties(source_name);
      CREATE INDEX IF NOT EXISTS idx_location ON properties(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_last_seen ON properties(last_seen_at);
    `);

    // Scrape history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scrape_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scout_name TEXT NOT NULL,
        scrape_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        properties_found INTEGER NOT NULL,
        search_criteria TEXT,
        duration_ms INTEGER
      )
    `);

    console.error('[Database] Schema initialized');
  }

  /**
   * Store a single property listing
   * Updates if already exists (by source_url)
   */
  saveProperty(listing: IndustrialListing): void {
    const stmt = this.db.prepare(`
      INSERT INTO properties (
        source_url, source_name, address, latitude, longitude,
        zoning, description, price, price_display, area, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_url) DO UPDATE SET
        last_seen_at = CURRENT_TIMESTAMP,
        scrape_count = scrape_count + 1,
        address = excluded.address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        zoning = excluded.zoning,
        description = excluded.description,
        price = excluded.price,
        price_display = excluded.price_display,
        area = excluded.area,
        metadata = excluded.metadata
    `);

    // Extract lat/long from metadata or parse from address
    let latitude = null;
    let longitude = null;

    if (listing.metadata) {
      // CBRE format
      if (listing.metadata['Common.Coordinate']) {
        latitude = listing.metadata['Common.Coordinate'].lat;
        longitude = listing.metadata['Common.Coordinate'].lon;
      }
      // EPL format (Cameron)
      else if (listing.metadata.meta?.property_address_coordinates) {
        const coords = listing.metadata.meta.property_address_coordinates.split(',');
        if (coords.length === 2) {
          latitude = parseFloat(coords[0]);
          longitude = parseFloat(coords[1]);
        }
      }
    }

    stmt.run(
      listing.sourceUrl,
      listing.source,
      listing.address,
      latitude,
      longitude,
      listing.zoning || null,
      listing.description,
      listing.price || null,
      listing.priceDisplay || null,
      listing.area || null,
      JSON.stringify(listing.metadata || {})
    );
  }

  /**
   * Store multiple properties in a transaction (faster)
   */
  saveProperties(listings: IndustrialListing[]): number {
    const insertStmt = this.db.prepare(`
      INSERT INTO properties (
        source_url, source_name, address, latitude, longitude,
        zoning, description, price, price_display, area, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_url) DO UPDATE SET
        last_seen_at = CURRENT_TIMESTAMP,
        scrape_count = scrape_count + 1,
        address = excluded.address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        zoning = excluded.zoning,
        description = excluded.description,
        price = excluded.price,
        price_display = excluded.price_display,
        area = excluded.area,
        metadata = excluded.metadata
    `);

    const insertMany = this.db.transaction((listings: IndustrialListing[]) => {
      for (const listing of listings) {
        let latitude = null;
        let longitude = null;

        if (listing.metadata) {
          // CBRE format
          if (listing.metadata['Common.Coordinate']) {
            latitude = listing.metadata['Common.Coordinate'].lat;
            longitude = listing.metadata['Common.Coordinate'].lon;
          }
          // EPL format (Cameron)
          else if (listing.metadata.meta?.property_address_coordinates) {
            const coords = listing.metadata.meta.property_address_coordinates.split(',');
            if (coords.length === 2) {
              latitude = parseFloat(coords[0]);
              longitude = parseFloat(coords[1]);
            }
          }
        }

        insertStmt.run(
          listing.sourceUrl,
          listing.source,
          listing.address,
          latitude,
          longitude,
          listing.zoning || null,
          listing.description,
          listing.price || null,
          listing.priceDisplay || null,
          listing.area || null,
          JSON.stringify(listing.metadata || {})
        );
      }
    });

    insertMany(listings);
    return listings.length;
  }

  /**
   * Record a scrape session
   */
  recordScrape(scoutName: string, propertiesFound: number, searchCriteria: any, durationMs: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO scrape_history (scout_name, properties_found, search_criteria, duration_ms)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(scoutName, propertiesFound, JSON.stringify(searchCriteria), durationMs);
  }

  /**
   * Get all properties
   */
  getAllProperties(): any[] {
    return this.db.prepare('SELECT * FROM properties ORDER BY last_seen_at DESC').all();
  }

  /**
   * Get properties by source
   */
  getPropertiesBySource(sourceName: string): any[] {
    return this.db.prepare('SELECT * FROM properties WHERE source_name = ? ORDER BY last_seen_at DESC')
      .all(sourceName);
  }

  /**
   * Get properties with coordinates (for mapping)
   */
  getPropertiesWithCoordinates(): any[] {
    return this.db.prepare(`
      SELECT * FROM properties 
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY last_seen_at DESC
    `).all();
  }

  /**
   * Search properties by address substring
   */
  searchByAddress(addressQuery: string): any[] {
    return this.db.prepare(`
      SELECT * FROM properties 
      WHERE address LIKE ? 
      ORDER BY last_seen_at DESC
    `).all(`%${addressQuery}%`);
  }

  /**
   * Get properties within a bounding box
   */
  getPropertiesInBoundingBox(minLat: number, maxLat: number, minLon: number, maxLon: number): any[] {
    return this.db.prepare(`
      SELECT * FROM properties 
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      ORDER BY last_seen_at DESC
    `).all(minLat, maxLat, minLon, maxLon);
  }

  /**
   * Get database statistics
   */
  getStats(): any {
    const totalProperties = this.db.prepare('SELECT COUNT(*) as count FROM properties').get() as { count: number };
    const withCoords = this.db.prepare('SELECT COUNT(*) as count FROM properties WHERE latitude IS NOT NULL').get() as { count: number };
    const bySources = this.db.prepare('SELECT source_name, COUNT(*) as count FROM properties GROUP BY source_name').all();
    const recentScrapes = this.db.prepare('SELECT * FROM scrape_history ORDER BY scrape_time DESC LIMIT 10').all();

    return {
      totalProperties: totalProperties.count,
      propertiesWithCoordinates: withCoords.count,
      coordinateCoverage: totalProperties.count > 0 
        ? ((withCoords.count / totalProperties.count) * 100).toFixed(1) + '%'
        : '0%',
      bySources,
      recentScrapes
    };
  }

  /**
   * Export properties to GeoJSON (for mapping)
   */
  exportToGeoJSON(): any {
    const properties = this.getPropertiesWithCoordinates();
    
    return {
      type: 'FeatureCollection',
      features: properties.map((prop: any) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [prop.longitude, prop.latitude]
        },
        properties: {
          id: prop.id,
          address: prop.address,
          source: prop.source_name,
          price: prop.price_display,
          area: prop.area,
          description: prop.description,
          url: prop.source_url,
          zoning: prop.zoning
        }
      }))
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    console.error('[Database] Connection closed');
  }
}
