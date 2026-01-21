import { IndustrialListing, SearchParams } from '../types.js';
import { getConnection } from './Database.js';

export class PropertyService {
  constructor() {
  }

  async init(): Promise<void> {
    const db = getConnection();
    
    // Register Distance Function
    db.function('haversine_distance', (lat1: number, lon1: number, lat2: number, lon2: number) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return null;
      
      const R = 6371; // Radius of the earth in km
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2); 
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
      const d = R * c; // Distance in km
      return d;
    });

    db.exec(`
      CREATE TABLE IF NOT EXISTS properties (
        source_url TEXT PRIMARY KEY,
        source TEXT,
        address TEXT,
        description TEXT,
        price REAL,
        price_display TEXT,
        area TEXT,
        property_type TEXT,
        listing_type TEXT,
        zoning TEXT,
        lat REAL,
        lon REAL,
        metadata TEXT,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS properties_fts USING fts5(
        source_url UNINDEXED, 
        address, 
        description, 
        zoning, 
        property_type
      );
    `);
  }

  async indexProperty(listing: IndustrialListing): Promise<void> {
    const db = getConnection();

    // Normalize Lat/Long
    let lat = null;
    let lon = null;
    
    if (listing.metadata?.['Common.Coordinate']) {
      lat = listing.metadata['Common.Coordinate'].lat;
      lon = listing.metadata['Common.Coordinate'].lon;
    } else if (listing.metadata?.lat && listing.metadata?.lon) {
      lat = listing.metadata.lat;
      lon = listing.metadata.lon;
    }

    const transaction = db.transaction(() => {
      // 1. Update Main Table
      const stmt = db.prepare(`
        INSERT INTO properties (
          source_url, source, address, description, price, price_display, 
          area, property_type, listing_type, zoning, lat, lon, metadata, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_url) DO UPDATE SET
          source = excluded.source,
          address = excluded.address,
          description = excluded.description,
          price = excluded.price,
          price_display = excluded.price_display,
          area = excluded.area,
          property_type = excluded.property_type,
          listing_type = excluded.listing_type,
          zoning = excluded.zoning,
          lat = excluded.lat,
          lon = excluded.lon,
          metadata = excluded.metadata,
          last_updated = excluded.last_updated
      `);

      stmt.run(
        listing.sourceUrl,
        listing.source,
        listing.address,
        listing.description,
        listing.price || null,
        listing.priceDisplay || null,
        listing.area ? listing.area.toString() : null,
        listing.propertyType || null,
        listing.listingType || null,
        listing.zoning || null,
        lat,
        lon,
        JSON.stringify(listing.metadata || {}),
        new Date().toISOString()
      );

      // 2. Update FTS Table
      db.prepare('DELETE FROM properties_fts WHERE source_url = ?').run(listing.sourceUrl);
      
      db.prepare(`
        INSERT INTO properties_fts (source_url, address, description, zoning, property_type)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        listing.sourceUrl,
        listing.address,
        listing.description,
        listing.zoning || '',
        listing.propertyType || ''
      );
    });

    transaction();
  }

  async search(params: SearchParams): Promise<IndustrialListing[]> {
    const db = getConnection();
    const args: any[] = [];
    let sql = "";
    let isGeoSearch = false;

    // FTS Query Base
    if (params.location && params.location !== 'Any') {
      const cleanQuery = params.location.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      
      if (cleanQuery) {
        sql = `
          SELECT p.*, 1 as rank 
          FROM properties p
          WHERE (p.address LIKE ? OR p.description LIKE ? OR p.metadata LIKE ?)
        `;
        args.push(`%${cleanQuery}%`);
        args.push(`%${cleanQuery}%`);
        args.push(`%${cleanQuery}%`);
      } else {
        sql = "SELECT * FROM properties p WHERE 1=1";
      }
    } else {
      sql = "SELECT * FROM properties p WHERE 1=1";
    }

    // Geo-Search Filter
    if (params.lat !== undefined && params.lon !== undefined) {
        isGeoSearch = true;
        const radius = params.radius || 10; // Default 10km
        
        sql += ` AND haversine_distance(p.lat, p.lon, ?, ?) <= ?`;
        args.push(params.lat);
        args.push(params.lon);
        args.push(radius);
    }

    // Append Filters
    if (params.propertyType) {
      // Robust property type matching
      sql += " AND (p.property_type LIKE ? OR p.description LIKE ?)";
      args.push(`%${params.propertyType}%`);
      args.push(`%${params.propertyType}%`);
    }

    if (params.listingType) {
      sql += " AND (p.listing_type LIKE ? OR p.description LIKE ?)";
      args.push(`%${params.listingType}%`);
      args.push(`%${params.listingType}%`);
    }

    if (params.minPrice !== undefined) {
      sql += " AND (p.price >= ? OR p.price IS NULL)";
      args.push(params.minPrice);
    }

    if (params.maxPrice !== undefined) {
      sql += " AND (p.price <= ? OR p.price IS NULL)";
      args.push(params.maxPrice);
    }

    // Ordering
    if (isGeoSearch && params.lat !== undefined && params.lon !== undefined) {
        sql += ` ORDER BY haversine_distance(p.lat, p.lon, ?, ?) ASC`;
        args.push(params.lat);
        args.push(params.lon);
    } else {
        sql += " ORDER BY p.last_updated DESC";
    }
    
    sql += " LIMIT 100";

    const rows = db.prepare(sql).all(...args);

    return rows.map((row: any) => ({
      address: row.address,
      source: row.source,
      sourceUrl: row.source_url,
      description: row.description,
      price: row.price,
      priceDisplay: row.price_display,
      area: row.area ? parseFloat(row.area) : undefined,
      propertyType: row.property_type,
      listingType: row.listing_type,
      zoning: row.zoning,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    }));
  }
}
