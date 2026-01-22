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
      -- Force reset for schema migration
      -- DROP TABLE IF EXISTS properties; 
      -- DROP TABLE IF EXISTS properties_fts;

      CREATE TABLE IF NOT EXISTS properties (
        id TEXT PRIMARY KEY, -- GNAF_PID or stable address hash
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
        source TEXT, -- Principal source
        source_url TEXT, -- Principal URL
        all_sources TEXT, -- JSON array of { source, url, price, agent, scout_first_seen, scout_last_seen, date_listed }
        date_listed TEXT, -- Best known listing date
        metadata TEXT,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS properties_fts USING fts5(
        id UNINDEXED, 
        address, 
        description, 
        zoning, 
        property_type
      );
    `);
  }

  async indexProperty(listing: IndustrialListing): Promise<void> {
    const db = getConnection();

    // 1. Determine Stable ID
    let id = listing.metadata?.gnafPid;
    if (!id) {
        // Fallback: Create a stable ID from normalized address
        id = listing.address.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // Normalize Lat/Long
    let lat = listing.metadata?.lat || listing.metadata?.latitude;
    let lon = listing.metadata?.lon || listing.metadata?.longitude;
    
    if (listing.metadata?.['Common.Coordinate']) {
      lat = listing.metadata['Common.Coordinate'].lat;
      lon = listing.metadata['Common.Coordinate'].lon;
    }

    const transaction = db.transaction(() => {
      // 2. Manage Sources (Merge duplicates and track history)
      const existing = db.prepare('SELECT all_sources FROM properties WHERE id = ?').get(id);
      let allSources = [];
      if (existing && existing.all_sources) {
          try { allSources = JSON.parse(existing.all_sources); } catch (e) {}
      }
      
      const now = new Date().toISOString();
      
      // Update or Add source
      const existingIndex = allSources.findIndex((s: any) => s.source === listing.source);
      
      const agent = listing.metadata?.agencyName || listing.metadata?.agentName || listing.source;

      const sourceInfo: any = { 
          source: listing.source, 
          url: listing.sourceUrl, 
          price: listing.priceDisplay || listing.price,
          agent: agent,
          scout_last_seen: now,
          date_listed: listing.dateListed || null
      };

      if (existingIndex >= 0) {
          sourceInfo.scout_first_seen = allSources[existingIndex].scout_first_seen || allSources[existingIndex].scout_last_seen || now;
          // Keep the earliest date_listed if multiple found for same source
          sourceInfo.date_listed = listing.dateListed || allSources[existingIndex].date_listed;
          allSources[existingIndex] = sourceInfo;
      } else {
          sourceInfo.scout_first_seen = now;
          allSources.push(sourceInfo);
      }

      // 3. Update Main Table
      const stmt = db.prepare(`
        INSERT INTO properties (
          id, address, description, price, price_display, 
          area, property_type, listing_type, zoning, lat, lon, 
          source, source_url, all_sources, date_listed, metadata, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          address = excluded.address,
          description = excluded.description,
          price = COALESCE(excluded.price, properties.price),
          price_display = COALESCE(excluded.price_display, properties.price_display),
          area = COALESCE(excluded.area, properties.area),
          property_type = COALESCE(excluded.property_type, properties.property_type),
          listing_type = COALESCE(excluded.listing_type, properties.listing_type),
          zoning = COALESCE(excluded.zoning, properties.zoning),
          lat = COALESCE(excluded.lat, properties.lat),
          lon = COALESCE(excluded.lon, properties.lon),
          source = excluded.source,
          source_url = excluded.source_url,
          all_sources = excluded.all_sources,
          date_listed = COALESCE(excluded.date_listed, properties.date_listed),
          metadata = excluded.metadata,
          last_updated = excluded.last_updated
      `);

      stmt.run(
        id,
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
        listing.source,
        listing.sourceUrl,
        JSON.stringify(allSources),
        listing.dateListed || null,
        JSON.stringify(listing.metadata || {}),
        new Date().toISOString()
      );

      // 4. Update FTS Table
      db.prepare('DELETE FROM properties_fts WHERE id = ?').run(id);
      
      db.prepare(`
        INSERT INTO properties_fts (id, address, description, zoning, property_type)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
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

    // Location Filter
    if (params.location && params.location !== 'Any') {
      const keywords = params.location
        .replace(/,/g, ' ')
        .split(/\s+/)
        .map(k => k.trim())
        .filter(k => k.length > 1);
      
      if (keywords.length > 0) {
        sql = "SELECT p.*, 1 as rank FROM properties p WHERE 1=1";
        for (const k of keywords) {
            sql += ` AND (p.address LIKE ? OR p.description LIKE ? OR p.metadata LIKE ?)`;
            args.push(`%${k}%`, `%${k}%`, `%${k}%`);
        }
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
      id: row.id,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
      source: row.source,
      sourceUrl: row.source_url,
      all_sources: typeof row.all_sources === 'string' ? JSON.parse(row.all_sources) : row.all_sources,
      description: row.description,
      price: row.price,
      priceDisplay: row.price_display,
      area: row.area ? parseFloat(row.area) : undefined,
      propertyType: row.property_type,
      listingType: row.listing_type,
      dateListed: row.date_listed,
      zoning: row.zoning,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    }));
  }
}
