const Database = require('better-sqlite3');
const path = require('path');

// On Railway: set DB_PATH env var to a persistent volume path e.g. /data/app.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data.db');

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!require('fs').existsSync(dbDir)) {
  require('fs').mkdirSync(dbDir, { recursive: true });
}
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
      old_sale_price REAL,
      new_sale_price REAL,
      old_cost_price REAL,
      new_cost_price REAL,
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
      old_sale_price REAL,
      old_cost_price REAL,
      old_quantity INTEGER,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
  `);

  // Backward-compatible migration for existing databases.
  ensureColumn('job_items', 'old_sale_price', 'REAL');
  ensureColumn('job_items', 'new_sale_price', 'REAL');
  ensureColumn('job_items', 'old_cost_price', 'REAL');
  ensureColumn('job_items', 'new_cost_price', 'REAL');
  ensureColumn('snapshots', 'old_sale_price', 'REAL');
  ensureColumn('snapshots', 'old_cost_price', 'REAL');

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

function ensureColumn(tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some(col => col.name === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

module.exports = { initDB, getDB };
