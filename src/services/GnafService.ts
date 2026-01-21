import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { getConnection } from './Database.js';

export class GnafService {
  constructor() {
  }

  async init(): Promise<void> {
    const db = getConnection();
    
    // 1. Create Tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS gnaf_reference (
        id TEXT PRIMARY KEY,
        address_text TEXT,
        suburb TEXT,
        state TEXT,
        postcode TEXT,
        latitude REAL,
        longitude REAL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS market_listings (
        id TEXT PRIMARY KEY,
        is_listed INTEGER DEFAULT 1,
        sources TEXT, -- JSON array
        last_seen_domain TEXT,
        domain_url TEXT,
        price_text TEXT,
        last_scan_id TEXT,
        FOREIGN KEY (id) REFERENCES gnaf_reference(id)
      );
    `);

    // 2. Init FTS
    // Create virtual table for FTS if not exists
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS gnaf_fts USING fts5(
        id UNINDEXED, 
        address_text, 
        suburb, 
        postcode
      );
    `);
  }

  async autoIngest(): Promise<void> {
    const csvPath = path.resolve('./data/gnaf.csv');
    const db = getConnection();
    
    // Ensure migration for existing DB
    try {
        db.exec("ALTER TABLE market_listings ADD COLUMN last_scan_id TEXT");
    } catch (e) { /* ignore if column exists */ }

    const count = db.prepare('SELECT count(*) as count FROM gnaf_reference').get().count;

    if (count === 0) {
      if (fs.existsSync(csvPath)) {
        console.log('[GNAF] Starting auto-ingestion (SQLite)...');
        await this.ingestGnaf(csvPath);
        console.log('[GNAF] Auto-ingestion complete.');
      }
    } else {
      console.log(`[GNAF] Database initialized with ${count} records.`);
    }
  }

  async ingestGnaf(csvPath: string): Promise<void> {
    const db = getConnection();
    const stats = fs.statSync(csvPath);
    const totalBytes = stats.size;
    let bytesRead = 0;

    const insert = db.prepare(`
      INSERT INTO gnaf_reference (id, address_text, suburb, state, postcode, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertFts = db.prepare(`
      INSERT INTO gnaf_fts (id, address_text, suburb, postcode)
      VALUES (?, ?, ?, ?)
    `);

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(csvPath);
      const parser = readStream.pipe(parse({ columns: true, trim: true }));
      let count = 0;
      let lastLoggedPercent = -1;
      
      const transaction = db.transaction((rows) => {
        for (const row of rows) {
          insert.run(
            row.GNAF_PID, 
            row.ADDRESS_LABEL, 
            row.LOCALITY_NAME, 
            row.STATE, 
            row.POSTCODE, 
            row.LATITUDE, 
            row.LONGITUDE
          );
          insertFts.run(
            row.GNAF_PID, 
            row.ADDRESS_LABEL, 
            row.LOCALITY_NAME, 
            row.POSTCODE
          );
          count++;
        }
      });

      readStream.on('data', (chunk) => {
        bytesRead += chunk.length;
        const percent = Math.floor((bytesRead / totalBytes) * 100);
        if (percent % 5 === 0 && percent !== lastLoggedPercent) {
          console.log(`[GNAF] Indexing Progress: ${percent}% (${count} rows)...`);
          lastLoggedPercent = percent;
        }
      });

      let batch: any[] = [];
      const BATCH_SIZE = 1000;

      parser.on('data', (row) => {
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          transaction(batch);
          batch = [];
        }
      });

      parser.on('end', () => {
        if (batch.length > 0) transaction(batch);
        console.log(`[GNAF] Finished indexing ${count} rows (100%).`);
        resolve();
      });

      parser.on('error', reject);
    });
  }

  async resolveAddress(addressString: string): Promise<string | null> {
    const db = getConnection();
    // FTS5 MATCH query
    // Simple sanitization
    const cleanAddr = addressString.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (!cleanAddr) return null;

    // Use NEAR query or OR query? Simple OR for now.
    // "123 george st" -> "123 OR george OR st" (weak) or just pass string.
    // FTS5 is good with "123 george st" as a phrase or near.
    // Let's try standard MATCH.
    
    try {
      const stmt = db.prepare(`
        SELECT id FROM gnaf_fts 
        WHERE gnaf_fts MATCH ? 
        ORDER BY rank 
        LIMIT 1
      `);
      // Enclose in quotes for phrase search logic or just pass keywords
      // For address matching, standard FTS5 syntax on the whole string often works well.
      // E.g. '"1475 Pakenham Road"'
      
      const row = stmt.get(`"${cleanAddr}"`); // Exact phrase match attempt first?
      if (row) return row.id;
      
      // Fallback to AND match
      const andQuery = cleanAddr.split(' ').join(' AND ');
      const row2 = stmt.get(andQuery);
      if (row2) return row2.id;

    } catch (e) {
      console.error(`[GNAF] Address resolution error:`, e);
    }
    return null;
  }

  async updateListing(gnafPid: string, url: string, price?: string, scanId?: string): Promise<void> {
    const db = getConnection();
    const now = new Date().toISOString();
    
    // SQLite doesn't have arrays, so we store sources as JSON string
    const existing = db.prepare('SELECT sources FROM market_listings WHERE id = ?').get(gnafPid);
    let sources = ['domain'];
    if (existing) {
      const current = JSON.parse(existing.sources);
      if (!current.includes('domain')) sources = [...current, 'domain'];
      else sources = current;
    }

    const stmt = db.prepare(`
      INSERT INTO market_listings (id, is_listed, sources, last_seen_domain, domain_url, price_text, last_scan_id)
      VALUES (?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        is_listed = 1,
        last_seen_domain = excluded.last_seen_domain,
        domain_url = excluded.domain_url,
        price_text = COALESCE(excluded.price_text, market_listings.price_text),
        sources = excluded.sources,
        last_scan_id = excluded.last_scan_id
    `);

    stmt.run(gnafPid, JSON.stringify(sources), now, url, price || null, scanId || null);
  }

  async pruneListings(source: string, activeScanId: string): Promise<number> {
    const db = getConnection();
    console.log(`[GNAF] Pruning listings for source '${source}' that do not match scanId '${activeScanId}'...`);
    
    // Logic: If source is in sources list, AND last_scan_id != activeScanId, set is_listed = 0
    // Actually, simply: Update records where source matches and scan_id is old.
    // Since we only have 'domain' source logic really active, we can assume check on 'last_scan_id'.
    // A robust check would verify JSON sources contains 'domain', but strict check on last_scan_id is safer for this specific scout loop.
    
    const stmt = db.prepare(`
      UPDATE market_listings 
      SET is_listed = 0 
      WHERE last_scan_id != ? 
      AND sources LIKE ?
    `);
    
    const result = stmt.run(activeScanId, `%"${source}"%`);
    console.log(`[GNAF] Pruned ${result.changes} listings.`);
    return result.changes;
  }

  async getMarketPenetration(suburb: string): Promise<any> {
    const db = getConnection();
    const result = db.prepare(`
        SELECT 
          g.suburb,
          COUNT(g.id) as total_parcels,
          COUNT(m.id) as active_listings
        FROM gnaf_reference g
        LEFT JOIN market_listings m ON g.id = m.id AND m.is_listed = 1
        WHERE g.suburb LIKE ?
        GROUP BY g.suburb
    `).get(`${suburb}%`); // LIKE match

    if (result) {
      return {
        suburb: result.suburb,
        total_parcels: result.total_parcels,
        active_listings: result.active_listings,
        penetration_pct: (result.active_listings / result.total_parcels) * 100
      };
    }
    return { suburb, total_parcels: 0, active_listings: 0, penetration_pct: 0 };
  }

  /**
   * Get center coordinate and bounds for a suburb or postcode
   */
  async getAreaContext(location: string): Promise<{ lat: number, lon: number, radius: number } | null> {
    const db = getConnection();
    
    // Try suburb match first
    let row = db.prepare(`
      SELECT 
        AVG(latitude) as lat, 
        AVG(longitude) as lon,
        (MAX(latitude) - MIN(latitude)) as lat_diff,
        (MAX(longitude) - MIN(longitude)) as lon_diff
      FROM gnaf_reference 
      WHERE suburb LIKE ?
    `).get(`${location}%`);

    // Try postcode if no suburb match or poor match
    if (!row || !row.lat) {
      row = db.prepare(`
        SELECT 
          AVG(latitude) as lat, 
          AVG(longitude) as lon,
          (MAX(latitude) - MIN(latitude)) as lat_diff,
          (MAX(longitude) - MIN(longitude)) as lon_diff
        FROM gnaf_reference 
        WHERE postcode = ?
      `).get(location);
    }

    if (row && row.lat) {
      // Calculate a rough radius in km based on bounds (1 degree ~ 111km)
      const latRadius = (row.lat_diff * 111) / 2;
      const lonRadius = (row.lon_diff * 111 * Math.cos(row.lat * Math.PI / 180)) / 2;
      const radius = Math.max(latRadius, lonRadius, 5); // Minimum 5km radius

      return {
        lat: row.lat,
        lon: row.lon,
        radius: Math.ceil(radius)
      };
    }

    return null;
  }

  /**
   * Resolve a G-NAF record by ID
   */
  async getGnafRecord(id: string): Promise<any> {
    const db = getConnection();
    return db.prepare('SELECT * FROM gnaf_reference WHERE id = ?').get(id);
  }
}