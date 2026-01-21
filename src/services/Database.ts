import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = './data/mcp.db';
const dir = path.dirname(dbPath);

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Global DB Instance
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Helper to get connection (SQLite is synchronous, so just return db)
export function getConnection() {
  return db;
}
