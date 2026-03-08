const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data.db');
let db;

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      merchant_id TEXT,
      filename TEXT,
      total_rows INTEGER,
      matched INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      not_found INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      sku TEXT,
      product_id TEXT,
      product_name TEXT,
      old_price REAL,
      new_price REAL,
      old_quantity INTEGER,
      new_quantity INTEGER,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      sku TEXT,
      product_id TEXT,
      old_price REAL,
      old_quantity INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
  `);

  console.log('Database initialized');
  return db;
}

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

module.exports = { initDB, getDB };
